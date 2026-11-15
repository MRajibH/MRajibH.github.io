import type { MetadataRoute } from "next";
import { MIN_POSTS_FOR_INDEXED_TOPIC, site } from "@/lib/site";
import { getActiveTopics, getAllPosts } from "@/lib/posts";

// Lists only pages that are meant to be indexed: no drafts, no empty blog
// index, no thin topic pages.
export default function sitemap(): MetadataRoute.Sitemap {
  const posts = getAllPosts().filter((p) => !p.draft);
  const url = (path: string) => `${site.url}${path}`;
  return [
    { url: url("/") },
    { url: url("/about/") },
    { url: url("/contact/") },
    { url: url("/privacy/") },
    { url: url("/terms/") },
    ...(posts.length > 0 ? [{ url: url("/blog/"), lastModified: posts[0].updated ?? posts[0].date }] : []),
    ...posts.map((p) => ({ url: url(`/blog/${p.slug}/`), lastModified: p.updated ?? p.date })),
    ...getActiveTopics()
      .filter((t) => t.count >= MIN_POSTS_FOR_INDEXED_TOPIC)
      .map((t) => ({ url: url(`/topics/${t.slug}/`) })),
  ];
}
