import Link from "next/link";
import type { Post } from "@/lib/posts";
import { topicName } from "@/lib/posts";
import { formatDate } from "@/lib/site";

export function PostMeta({ post }: { post: Post }) {
  return (
    <span className="text-[13px] text-slate">
      {post.tags[0] && <span className="font-mono text-accent">{topicName(post.tags[0])}</span>}
      {post.tags[0] && " · "}
      <time dateTime={post.date}>{formatDate(post.date)}</time> · {post.minutes} min read
      {post.draft && <span className="ml-2 px-2 py-0.5 rounded bg-accent2/20 text-accent2">Draft</span>}
    </span>
  );
}

/** Row used on the blog index and topic pages. */
export function PostRow({ post }: { post: Post }) {
  return (
    <Link
      href={`/blog/${post.slug}/`}
      className="group flex flex-col gap-2 py-7 border-t border-line"
    >
      <PostMeta post={post} />
      <span className="font-display text-2xl font-semibold leading-snug text-slate-light group-hover:text-accent transition-colors">
        {post.title}
      </span>
      <span className="text-slate">{post.description}</span>
    </Link>
  );
}

/** Card used on the home page and under articles. */
export function PostCard({ post }: { post: Post }) {
  return (
    <Link
      href={`/blog/${post.slug}/`}
      className="card-lift flex flex-col gap-3 p-7 rounded-2xl border border-line bg-navy-light"
    >
      <PostMeta post={post} />
      <span className="font-display text-xl font-semibold leading-snug text-slate-light">{post.title}</span>
      <span className="text-slate text-[15px]">{post.description}</span>
    </Link>
  );
}
