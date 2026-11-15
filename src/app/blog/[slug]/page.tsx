import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { adsense, formatDate, site } from "@/lib/site";
import {
  getAllPosts,
  getPost,
  orPlaceholder,
  renderMarkdown,
  splitAfterThirdSection,
  topicName,
} from "@/lib/posts";
import { PostCard } from "@/components/PostList";
import { AdSlot } from "@/components/AdSlot";

type Props = { params: { slug: string } };

export const dynamicParams = false;

export function generateStaticParams() {
  return orPlaceholder(
    "slug",
    getAllPosts().map((p) => p.slug),
  );
}

export function generateMetadata({ params }: Props): Metadata {
  const post = getPost(params.slug);
  if (!post) return {};
  const url = `/blog/${post.slug}/`;
  return {
    title: post.title,
    description: post.description,
    alternates: { canonical: url },
    robots: post.draft ? { index: false, follow: false } : undefined,
    openGraph: {
      type: "article",
      url,
      title: post.title,
      description: post.description,
      publishedTime: post.date,
      modifiedTime: post.updated ?? post.date,
      authors: [site.author],
    },
  };
}

export default async function ArticlePage({ params }: Props) {
  const post = getPost(params.slug);
  if (!post) notFound();

  const { html, headings } = await renderMarkdown(post.content);
  const [firstPart, secondPart] = splitAfterThirdSection(html);
  // Only articles long enough to be split carry the mid-article and sidebar ads.
  const isLong = secondPart !== "";

  const related = getAllPosts()
    .filter((p) => p.slug !== post.slug)
    .sort(
      (a, b) =>
        b.tags.filter((t) => post.tags.includes(t)).length -
        a.tags.filter((t) => post.tags.includes(t)).length,
    )
    .slice(0, 2);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.description,
    datePublished: post.date,
    dateModified: post.updated ?? post.date,
    author: { "@type": "Person", name: site.author, url: `${site.url}/about/` },
    mainEntityOfPage: `${site.url}/blog/${post.slug}/`,
  };

  return (
    <div className="max-w-5xl mx-auto px-6 py-14 flex flex-wrap gap-x-16 gap-y-10">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <article className="flex-[999_1_520px] min-w-0 max-w-[720px]">
        <Link href="/blog/" className="inline-block py-2 text-sm text-slate hover:text-accent">
          Back to blog
        </Link>
        <p className="mt-3 mb-3 text-sm text-slate">
          {post.tags[0] && <span className="font-mono text-accent">{topicName(post.tags[0])}</span>}
          {post.tags[0] && " · "}
          <time dateTime={post.date}>{formatDate(post.date)}</time> · {post.minutes} min read
          {post.draft && <span className="ml-2 px-2 py-0.5 rounded bg-accent2/20 text-accent2">Draft</span>}
        </p>
        <h1 className="font-display font-bold text-4xl md:text-[2.9rem] leading-[1.1] tracking-tight text-slate-light mb-5">
          {post.title}
        </h1>
        <p className="text-xl text-slate mb-7">{post.description}</p>
        <p className="pb-8 mb-9 border-b border-line text-sm">
          By{" "}
          <Link href="/about/" className="font-semibold text-slate-light hover:text-accent">
            {site.author}
          </Link>
          {post.updated && post.updated !== post.date && (
            <span className="text-slate"> · Updated {formatDate(post.updated)}</span>
          )}
        </p>

        <div className="prose-article text-slate-light" dangerouslySetInnerHTML={{ __html: firstPart }} />
        {isLong && (
          <>
            <AdSlot slot={adsense.slots.articleMid} />
            <div className="prose-article text-slate-light" dangerouslySetInnerHTML={{ __html: secondPart }} />
          </>
        )}

        <ul className="flex flex-wrap gap-2.5 mt-10 pt-7 border-t border-line" aria-label="Topics">
          {post.tags.map((tag) => (
            <li key={tag}>
              <Link
                href={`/topics/${tag}/`}
                className="inline-block px-4 py-2.5 rounded-full border border-line text-sm hover:border-accent hover:text-accent transition-colors"
              >
                {topicName(tag)}
              </Link>
            </li>
          ))}
        </ul>

        <AdSlot slot={adsense.slots.articleEnd} minHeight={250} />

        {related.length > 0 && (
          <section className="mt-10">
            <h2 className="font-display text-2xl font-semibold text-slate-light mb-5">Keep reading</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {related.map((p) => (
                <PostCard key={p.slug} post={p} />
              ))}
            </div>
          </section>
        )}
      </article>

      {headings.length > 1 && (
        <aside className="hidden lg:block flex-[1_1_240px] max-w-[280px] pt-[4.5rem]">
          <nav aria-label="On this page">
            <p className="mb-3 text-xs uppercase tracking-[0.12em] text-slate">On this page</p>
            <ul className="border-l border-line text-[15px] text-slate">
              {headings.map((h) => (
                <li key={h.id}>
                  <a href={`#${h.id}`} className="block px-4 py-2 hover:text-accent transition-colors">
                    {h.text}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          {isLong && <AdSlot slot={adsense.slots.sidebar} minHeight={600} />}
        </aside>
      )}
    </div>
  );
}
