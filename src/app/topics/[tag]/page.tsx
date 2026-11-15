import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MIN_POSTS_FOR_INDEXED_TOPIC, topics } from "@/lib/site";
import { getActiveTopics, getPostsByTopic, orPlaceholder } from "@/lib/posts";
import { PostRow } from "@/components/PostList";

type Props = { params: { tag: string } };

export const dynamicParams = false;

// Only topics that already have articles get a page.
export function generateStaticParams() {
  return orPlaceholder(
    "tag",
    getActiveTopics().map((t) => t.slug),
  );
}

export function generateMetadata({ params }: Props): Metadata {
  const topic = topics.find((t) => t.slug === params.tag);
  if (!topic) return {};
  const count = getPostsByTopic(topic.slug).length;
  return {
    title: topic.name,
    description: `Articles about ${topic.name.toLowerCase()}: ${topic.description.toLowerCase()}.`,
    alternates: { canonical: `/topics/${topic.slug}/` },
    // A topic with only one or two articles is a thin list page.
    robots: count >= MIN_POSTS_FOR_INDEXED_TOPIC ? undefined : { index: false, follow: true },
  };
}

export default function TopicPage({ params }: Props) {
  const topic = topics.find((t) => t.slug === params.tag);
  const posts = topic ? getPostsByTopic(topic.slug) : [];
  if (!topic || posts.length === 0) notFound();

  return (
    <div className="max-w-3xl mx-auto px-6 py-16">
      <Link href="/blog/" className="inline-block py-2 text-sm text-slate hover:text-accent">
        All articles
      </Link>
      <h1 className="font-display text-4xl md:text-5xl font-bold tracking-tight text-slate-light mt-3 mb-3">
        {topic.name}
      </h1>
      <p className="text-slate text-lg mb-8">{topic.description}</p>
      <div>
        {posts.map((post) => (
          <PostRow key={post.slug} post={post} />
        ))}
      </div>
    </div>
  );
}
