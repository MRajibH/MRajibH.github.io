---
title: "How this site is built: a static Next.js blog with Markdown"
description: "The design of this site: Next.js static export, Markdown articles rendered at build time, a flash-free theme switch and build checks for thin pages."
date: 2026-11-15
tags: [web]
draft: true
---

This site has no server, no database and no content management system. Every page is an HTML file produced once, at build time, and served as a static file. This article walks through how that works: where the articles live, how Markdown becomes a page, how the light and dark themes switch without a flash, and how the build refuses to publish pages that are not ready.

The code samples are taken from the site's own source, shortened where the full version adds nothing.

## Why a static site

A blog is read far more often than it is written. That makes it a good fit for doing all the work up front: render every page when an article is added, then let a file host serve the result.

Three things follow from that choice:

- **Nothing to keep running.** There is no application process to monitor, patch or restart. If the host is up, the site is up.
- **Speed without tuning.** A request is answered with a file from a content delivery network. There is no query to optimise and no cache to warm.
- **A small attack surface.** With no server-side code handling requests, whole classes of vulnerability have nowhere to live.

The cost is that anything dynamic has to happen either at build time or in the browser. For a blog that is an easy trade. The one interactive feature, the contact form, posts to an external mail service.

Next.js produces this kind of site with one setting:

```js
// next.config.mjs
const nextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
};
```

`output: "export"` writes the whole site to an `out/` folder. `trailingSlash: true` makes `/about/` come out as `out/about/index.html`, a layout every static host understands. Image optimisation is switched off because the built-in optimiser needs a running server.

## Articles are Markdown files

Each article is one Markdown file in `content/blog/`. The file name becomes the address, and a block of front matter at the top carries the details the site needs:

```markdown
---
title: "How this site is built: a static Next.js blog with Markdown"
description: "One or two sentences shown in search results."
date: 2026-11-15
tags: [web]
draft: true
---

The article starts here.
```

Keeping articles as files in the repository has practical benefits. Every change is in version control, so there is a history and a way back. Writing happens in whatever editor is already open. And there is no login page to defend, because there is no admin interface at all.

A small module reads the folder, parses the front matter with `gray-matter`, and returns the articles newest first:

```ts
const posts = files
  .map((file) => {
    const { data, content } = matter(fs.readFileSync(path.join(DIR, file), "utf8"));
    return { slug: file.replace(/\.md$/, ""), title: data.title, content /* ... */ };
  })
  .filter((p) => showDrafts || !p.draft)
  .sort((a, b) => (a.date < b.date ? 1 : -1));
```

The `filter` line matters more than it looks. An article marked `draft: true` appears while developing locally but is left out of a production build entirely, so a half-written piece cannot be published by accident.

## Turning Markdown into a page

Markdown is converted to HTML during the build by a `unified` pipeline. Each step is a plugin with one job:

```ts
const file = await unified()
  .use(remarkParse)      // Markdown text to a syntax tree
  .use(remarkGfm)        // tables, task lists, strikethrough
  .use(remarkRehype)     // Markdown tree to an HTML tree
  .use(rehypeSlug)       // add an id to every heading
  .use(rehypeHighlight)  // syntax-highlight code blocks
  .use(rehypeStringify)  // HTML tree to a string
  .process(markdown);
```

Because highlighting happens here, the browser receives code that is already coloured. No highlighting script is shipped to readers.

The heading ids added by `rehypeSlug` do double duty. They make every section linkable, and the article page collects them to build the "On this page" list in the sidebar.

Next.js needs to know which article pages exist before it can export them. That is the job of `generateStaticParams`, which returns one entry per article:

```ts
export function generateStaticParams() {
  return getAllPosts().map((p) => ({ slug: p.slug }));
}
```

## A theme switch without a flash

The site follows the visitor's system preference for light or dark, and remembers a manual choice. The colours are CSS variables, set once for dark and overridden for light:

```css
:root { --bg: 11 22 38; --text: 230 237 247; }
:root[data-theme="light"] { --bg: 251 252 254; --text: 15 27 45; }
```

The difficulty with a static site is timing. The HTML is the same for everyone, so the page cannot know the visitor's choice until JavaScript runs. If that happens after the first paint, a visitor who chose the light theme sees a dark page flash before it corrects itself.

The fix is a few lines of inline script in the document head. It runs before anything is drawn, reads the saved choice or falls back to the system setting, and sets the `data-theme` attribute:

```js
var t = localStorage.getItem("theme");
if (t !== "light" && t !== "dark") {
  t = matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}
document.documentElement.setAttribute("data-theme", t);
```

By the time the browser paints, the right variables are already in effect.

## Keeping unfinished pages out of search

A site made of generated pages can easily publish pages with nothing on them: a topic with no articles, an index before the first post. Search engines treat these as thin content, and they count against the whole site.

The build handles this in three places:

- **Topic pages** are generated only for topics that have at least one article. A topic with fewer than three is marked `noindex` and left out of the sitemap until it fills up.
- **The sitemap** is built from the same list of published articles as the pages, so the two cannot disagree.
- **A content check** runs before every build. It fails the build if a published article is too short, has too few sections, lacks a description or still contains placeholder text.

The last one is a plain Node script wired in as `prebuild` in `package.json`, so it cannot be skipped by forgetting to run it.

## Trade-offs

This design is not free. Publishing an article means a commit and a rebuild rather than pressing a button, and there is no way to schedule a post without extra tooling. Search within the site would need a separate index built at build time. Comments would need a third-party service.

For a personal engineering blog those are acceptable costs. The site is fast, it is cheap to host, there is very little that can break, and the whole thing, content included, lives in one repository.
