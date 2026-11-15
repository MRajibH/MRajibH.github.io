import topicsData from "../../content/topics.json";

export const site = {
  url: "https://rajib.uk",
  name: "rajib.uk",
  author: "Muhammad Rajib Hawlader",
  title: "rajib.uk | Engineering notes on self-hosted AI and Linux systems",
  description:
    "Practical write-ups on self-hosted LLMs, RAG, AI agents, custom Linux ISO builds and DevSecOps by Senior Software Engineer Muhammad Rajib Hawlader.",
};

export type Topic = { slug: string; name: string; description: string };
export const topics: Topic[] = topicsData;

/**
 * AdSense is off until these are set at build time. With no client id the site
 * ships no AdSense script and no ad markup at all, so a reviewer never sees an
 * empty ad box. Each slot id comes from an ad unit created in the AdSense
 * dashboard; a slot with no id renders nothing.
 */
export const adsense = {
  client: process.env.NEXT_PUBLIC_ADSENSE_CLIENT ?? "",
  slots: {
    articleMid: process.env.NEXT_PUBLIC_ADSENSE_SLOT_ARTICLE_MID ?? "",
    articleEnd: process.env.NEXT_PUBLIC_ADSENSE_SLOT_ARTICLE_END ?? "",
    sidebar: process.env.NEXT_PUBLIC_ADSENSE_SLOT_SIDEBAR ?? "",
    blogIndex: process.env.NEXT_PUBLIC_ADSENSE_SLOT_BLOG_INDEX ?? "",
  },
};

/** A topic page with fewer articles than this is a thin list: keep it out of search. */
export const MIN_POSTS_FOR_INDEXED_TOPIC = 3;

export function formatDate(iso: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(iso));
}
