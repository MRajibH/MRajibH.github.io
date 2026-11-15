import type { Metadata } from "next";
import Link from "next/link";
import { adsense } from "@/lib/site";
import { getActiveTopics, getAllPosts } from "@/lib/posts";
import { PostRow } from "@/components/PostList";
import { AdSlot } from "@/components/AdSlot";

const hasPosts = getAllPosts().length > 0;

export const metadata: Metadata = {
  title: "Blog",
  description:
    "Practical write-ups on self-hosted AI, Linux systems and DevSecOps, from work on real products.",
  alternates: { canonical: "/blog/" },
  // An index with nothing in it is a thin page: keep it out of search until there are articles.
  robots: hasPosts ? undefined : { index: false, follow: true },
};

// The index carries an ad only when there is enough content around it.
const MIN_POSTS_FOR_INDEX_AD = 5;

export default function BlogIndex() {
  const posts = getAllPosts();
  const activeTopics = getActiveTopics();
  const showAd = posts.length >= MIN_POSTS_FOR_INDEX_AD;

  return (
    <div className="max-w-3xl mx-auto px-6 py-16">
      <h1 className="font-display text-4xl md:text-5xl font-bold tracking-tight text-slate-light mb-3">Blog</h1>
      <p className="text-slate text-lg max-w-xl mb-7">
        Practical write-ups on self-hosted AI, Linux systems and DevSecOps, from work on real products.
      </p>

      {activeTopics.length > 1 && (
        <ul className="flex flex-wrap gap-2.5 mb-10" aria-label="Topics">
          {activeTopics.map((t) => (
            <li key={t.slug}>
              <Link
                href={`/topics/${t.slug}/`}
                className="inline-block px-4 py-2.5 rounded-full border border-line text-sm text-slate-light hover:border-accent hover:text-accent transition-colors"
              >
                {t.name}
              </Link>
            </li>
          ))}
        </ul>
      )}

      {posts.length === 0 ? (
        <p className="text-slate border-t border-line pt-8">The first articles are being written.</p>
      ) : (
        <div>
          {posts.slice(0, 3).map((post) => (
            <PostRow key={post.slug} post={post} />
          ))}
          {showAd && <AdSlot slot={adsense.slots.blogIndex} minHeight={250} />}
          {posts.slice(3).map((post) => (
            <PostRow key={post.slug} post={post} />
          ))}
        </div>
      )}
    </div>
  );
}
