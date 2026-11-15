import Image from "next/image";
import Link from "next/link";
import { summary } from "@/data/resume";
import { site, topics } from "@/lib/site";
import { getActiveTopics, getAllPosts } from "@/lib/posts";
import { PostCard } from "@/components/PostList";
import profileImg from "./profile.jpg";

function Hero({ hasPosts }: { hasPosts: boolean }) {
  return (
    <section className="hero section-padding pt-20 pb-16 flex flex-wrap items-center gap-14">
      <div className="flex-[999_1_460px] min-w-0">
        <p className="rise flex items-center gap-2.5 font-mono text-sm text-accent mb-4">
          <span aria-hidden className="pulse-dot w-2 h-2 rounded-full bg-accent flex-shrink-0" />
          Engineering notes by {site.author}
        </p>
        <h1 className="rise rise-1 font-display font-bold text-4xl md:text-[3.5rem] leading-[1.08] tracking-tight text-slate-light mb-5">
          <span className="shine">Self-hosted AI</span> and Linux systems, built for production.
        </h1>
        <p className="rise rise-2 text-lg md:text-[19px] text-slate max-w-xl mb-8">
          I&apos;m a Senior Software Engineer writing about what I build at work: custom Linux ISOs,
          self-hosted LLMs, RAG pipelines, AI agents and DevSecOps.
        </p>
        <div className="rise rise-3 flex flex-wrap gap-3.5">
          {hasPosts && (
            <Link
              href="/blog/"
              className="px-6 py-3 rounded-lg bg-accent text-navy font-semibold hover:shadow-glow transition-shadow"
            >
              Read the blog
            </Link>
          )}
          <Link
            href="/about/"
            className={
              hasPosts
                ? "px-6 py-3 rounded-lg border border-line text-slate-light font-semibold hover:border-accent hover:text-accent transition-colors"
                : "px-6 py-3 rounded-lg bg-accent text-navy font-semibold hover:shadow-glow transition-shadow"
            }
          >
            About me
          </Link>
          {!hasPosts && (
            <Link
              href="/contact/"
              className="px-6 py-3 rounded-lg border border-line text-slate-light font-semibold hover:border-accent hover:text-accent transition-colors"
            >
              Contact
            </Link>
          )}
        </div>
      </div>

      <div className="rise rise-4 flex-[1_1_300px] max-w-sm flex flex-col gap-5">
        <div className="ring-spin relative w-32 h-32 rounded-full p-[3px] overflow-hidden">
          <div className="relative w-full h-full rounded-full overflow-hidden bg-navy-light">
            <Image src={profileImg} alt={site.author} fill className="object-cover" sizes="128px" priority />
          </div>
        </div>
        {/* Decorative: the same information is in the paragraph beside it. */}
        <div
          aria-hidden
          className="rounded-2xl border border-line bg-navy-light overflow-hidden"
          style={{ boxShadow: "0 30px 70px -40px rgb(var(--accent))" }}
        >
          <div className="flex items-center gap-2.5 px-4 py-3 border-b border-line font-mono text-xs text-slate">
            <span className="pulse-dot w-2 h-2 rounded-full bg-accent" />
            local model · self-hosted
          </div>
          <div className="p-4 flex flex-col gap-3.5 font-mono text-sm leading-relaxed">
            <div className="text-slate">
              <span className="text-accent">&gt;</span> What is this site about?
            </div>
            <div className="text-slate-light">
              <span className="type-line type-1">Self-hosted LLMs and RAG,</span>
              <span className="type-line type-2">AI agents, custom Linux</span>
              <span className="type-line type-3">
                ISOs and DevSecOps.<span className="caret text-accent"> ▍</span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function Home() {
  const posts = getAllPosts();
  const activeTopics = getActiveTopics();
  const activeSlugs = new Set(activeTopics.map((t) => t.slug));
  const hasPosts = posts.length > 0;

  return (
    <>
      <Hero hasPosts={hasPosts} />

      {hasPosts && (
        <section className="section-padding border-t border-line">
          <div className="flex flex-wrap items-baseline justify-between gap-3 mb-8">
            <h2 className="font-display text-3xl font-semibold text-slate-light">Latest articles</h2>
            <Link href="/blog/" className="py-2 text-accent font-medium hover:underline">
              All articles
            </Link>
          </div>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {posts.slice(0, 3).map((post) => (
              <PostCard key={post.slug} post={post} />
            ))}
          </div>
        </section>
      )}

      <section className="section-padding border-t border-line">
        <h2 className="font-display text-3xl font-semibold text-slate-light mb-7">What I work on</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {topics.map((topic) => {
            const body = (
              <>
                <span className="font-semibold text-lg text-slate-light">{topic.name}</span>
                <span className="text-slate text-sm">{topic.description}</span>
              </>
            );
            // A topic only becomes a link once it has articles, so there are no empty topic pages.
            return activeSlugs.has(topic.slug) ? (
              <Link
                key={topic.slug}
                href={`/topics/${topic.slug}/`}
                className="card-lift flex flex-col gap-1.5 px-6 py-5 rounded-xl border border-line"
              >
                {body}
              </Link>
            ) : (
              <div key={topic.slug} className="flex flex-col gap-1.5 px-6 py-5 rounded-xl border border-line">
                {body}
              </div>
            );
          })}
        </div>
      </section>

      <section className="section-padding border-t border-line pb-20">
        <h2 className="font-display text-3xl font-semibold text-slate-light mb-5">About the author</h2>
        <div className="space-y-4 max-w-3xl text-slate leading-relaxed">
          {summary.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>
        <Link href="/about/" className="inline-block mt-4 py-2 text-accent font-medium hover:underline">
          Experience, projects and resume
        </Link>
      </section>
    </>
  );
}
