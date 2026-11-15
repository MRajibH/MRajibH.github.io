import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeSlug from "rehype-slug";
import rehypeHighlight from "rehype-highlight";
import rehypeStringify from "rehype-stringify";
import { topics, type Topic } from "./site";

export type Post = {
  slug: string;
  title: string;
  description: string;
  date: string;
  updated?: string;
  tags: string[];
  draft: boolean;
  content: string;
  minutes: number;
};

const DIR = path.join(process.cwd(), "content", "blog");

/**
 * Drafts never reach a production build, so an unfinished article cannot be
 * published by accident. `npm run dev` shows them; INCLUDE_DRAFTS=1 forces
 * them into a build for previewing.
 */
const showDrafts = process.env.NODE_ENV !== "production" || process.env.INCLUDE_DRAFTS === "1";

let cache: Post[] | null = null;

const toIso = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? ""));

export function getAllPosts(): Post[] {
  if (cache) return cache;
  const files = fs.existsSync(DIR)
    ? fs.readdirSync(DIR).filter((f) => f.endsWith(".md") && !f.startsWith("_"))
    : [];
  const posts = files
    .map((file): Post => {
      const { data, content } = matter(fs.readFileSync(path.join(DIR, file), "utf8"));
      const words = content.split(/\s+/).filter(Boolean).length;
      return {
        slug: file.replace(/\.md$/, ""),
        title: String(data.title ?? ""),
        description: String(data.description ?? ""),
        date: toIso(data.date),
        updated: data.updated ? toIso(data.updated) : undefined,
        tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
        draft: data.draft === true,
        content,
        minutes: Math.max(1, Math.round(words / 220)),
      };
    })
    .filter((p) => showDrafts || !p.draft)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  cache = posts;
  return posts;
}

export function getPost(slug: string) {
  return getAllPosts().find((p) => p.slug === slug);
}

export function getPostsByTopic(slug: string) {
  return getAllPosts().filter((p) => p.tags.includes(slug));
}

/** Topics that have at least one published article. */
export function getActiveTopics(): (Topic & { count: number })[] {
  return topics
    .map((t) => ({ ...t, count: getPostsByTopic(t.slug).length }))
    .filter((t) => t.count > 0);
}

export function topicName(slug: string) {
  return topics.find((t) => t.slug === slug)?.name ?? slug;
}

/**
 * Next.js 14 refuses to export a dynamic route whose generateStaticParams()
 * returns an empty list, which is the case before the first article is
 * published. In that case the route gets this single placeholder entry; the
 * page answers it with notFound() and scripts/clean-export.mjs deletes the
 * resulting file from out/ after the build, so it is never deployed.
 */
export const EMPTY_PLACEHOLDER = "__empty";

export function orPlaceholder<T extends string>(key: T, values: string[]): Record<T, string>[] {
  const list = values.length > 0 ? values : [EMPTY_PLACEHOLDER];
  return list.map((value) => ({ [key]: value }) as Record<T, string>);
}

export type Heading = { id: string; text: string };

export async function renderMarkdown(md: string): Promise<{ html: string; headings: Heading[] }> {
  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype)
    .use(rehypeSlug)
    .use(rehypeHighlight, { detect: false })
    .use(rehypeStringify)
    .process(md);
  const html = String(file)
    .replace(/<table>/g, '<div class="table-wrap"><table>')
    .replace(/<\/table>/g, "</table></div>");
  const headings: Heading[] = [];
  const re = /<h2 id="([^"]+)">([\s\S]*?)<\/h2>/g;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    headings.push({ id: m[1], text: m[2].replace(/<[^>]+>/g, "") });
  }
  return { html, headings };
}

/**
 * Split an article after its third section, which is where the in-article ad
 * goes. Short articles (fewer than four sections) are not split, so they carry
 * no mid-article ad and content always outweighs ads.
 */
export function splitAfterThirdSection(html: string): [string, string] {
  let index = -1;
  for (let i = 0; i < 4; i++) {
    index = html.indexOf("<h2", index + 1);
    if (index === -1) return [html, ""];
  }
  return [html.slice(0, index), html.slice(index)];
}
