// Guards against publishing low-value content. Runs before every build
// (`prebuild`) and on demand with `npm run check:content`.
//
// Every article that is not marked `draft: true` must pass these checks or the
// build fails. Drafts are skipped: they are never part of a production build.
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";

const ROOT = process.cwd();
const DIR = path.join(ROOT, "content", "blog");
const topics = JSON.parse(fs.readFileSync(path.join(ROOT, "content", "topics.json"), "utf8")).map((t) => t.slug);

// `--include-drafts` checks drafts too, to see whether they are ready to publish.
const includeDrafts = process.argv.includes("--include-drafts");
// `--only=a.md,b.md` limits the check to those files.
const only = (process.argv.find((a) => a.startsWith("--only=")) ?? "").slice(7).split(",").filter(Boolean);

const MIN_WORDS = 800;
const MIN_SECTIONS = 3;
const DESCRIPTION_RANGE = [50, 160];
const TITLE_RANGE = [15, 70];
// Leftover template text, unfinished notes and filler.
const PLACEHOLDER = /\[(your|todo|tbd|placeholder)\b[^\]]*\]|\bTODO\b|\bTBD\b|lorem ipsum/i;

const files = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter((f) => f.endsWith(".md") && !f.startsWith("_")) : [];
const problems = [];
const seenTitles = new Map();
let published = 0;
let drafts = 0;

for (const file of files) {
  const { data, content } = matter(fs.readFileSync(path.join(DIR, file), "utf8"));
  if (only.length > 0 && !only.includes(file)) continue;
  if (data.draft === true) {
    drafts++;
    if (!includeDrafts) continue;
  } else {
    published++;
  }
  const fail = (msg) => problems.push(`${file}: ${msg}`);
  const title = String(data.title ?? "");
  const description = String(data.description ?? "");
  // Count prose only: code blocks do not make a thin article substantial.
  const prose = content.replace(/```[\s\S]*?```/g, " ");
  const words = prose.split(/\s+/).filter(Boolean).length;
  const sections = (content.match(/^## /gm) ?? []).length;
  if (includeDrafts) console.log(`  ${file}: ${words} words, ${sections} sections`);

  if (!/^[a-z0-9]+(-[a-z0-9]+)*\.md$/.test(file)) fail("file name must be lowercase words joined by hyphens");
  if (title.length < TITLE_RANGE[0] || title.length > TITLE_RANGE[1])
    fail(`title is ${title.length} characters; use ${TITLE_RANGE[0]}-${TITLE_RANGE[1]}`);
  if (description.length < DESCRIPTION_RANGE[0] || description.length > DESCRIPTION_RANGE[1])
    fail(`description is ${description.length} characters; use ${DESCRIPTION_RANGE[0]}-${DESCRIPTION_RANGE[1]}`);
  if (!data.date || Number.isNaN(new Date(data.date).getTime())) fail("date is missing or invalid (use YYYY-MM-DD)");
  else if (new Date(data.date).getTime() > Date.now()) fail("date is in the future");
  const tags = Array.isArray(data.tags) ? data.tags : [];
  if (tags.length === 0) fail("needs at least one tag");
  for (const tag of tags) if (!topics.includes(tag)) fail(`unknown tag "${tag}" (see content/topics.json)`);
  if (words < MIN_WORDS) fail(`only ${words} words of prose; write at least ${MIN_WORDS}`);
  if (sections < MIN_SECTIONS) fail(`only ${sections} "## " sections; use at least ${MIN_SECTIONS}`);
  const leftover = (title + "\n" + description + "\n" + prose).match(PLACEHOLDER);
  if (leftover) fail(`contains placeholder text: "${leftover[0]}"`);
  if (/^# /m.test(prose)) fail('do not use a "# " heading in the body; the title is the page heading');
  const key = title.trim().toLowerCase();
  if (seenTitles.has(key)) fail(`same title as ${seenTitles.get(key)}`);
  seenTitles.set(key, file);
}

console.log(`Content check: ${published} published article(s), ${drafts} draft(s).`);
if (problems.length > 0) {
  console.error("\nThese published articles are not ready. Fix them or set `draft: true`:\n");
  for (const p of problems) console.error("  - " + p);
  console.error("");
  process.exit(1);
}
if (published < 20 && !includeDrafts) {
  console.log(
    `Note: AdSense reviewers expect a site with substantial content. ${published} article(s) published; aim for 20 or more before applying.`,
  );
}
