# rajib.uk — AdSense-ready engineering blog + portfolio

Plan for rebuilding rajib.uk from a one-page portfolio into a content site that Google AdSense
can approve, hosted as a static site on Cloudflare Pages.

Status: **plan approved, build not started.** Written 2026-11-15.

## 1. Goal and honest expectations

- A single résumé page will not pass AdSense review ("low value content") and has no traffic
  to monetise. Ads need articles, and articles need readers.
- The site becomes a focused technical blog. The portfolio stays, as the About page.
- The blog's main value is professional: it brings in job and freelance leads. Ad income is a
  bonus. Rough expectation for technical content is a few dollars per thousand page views
  (a general range, not a looked-up figure), and search traffic usually takes 6–12 months of
  regular writing to build.

Decisions made:

| Question | Decision |
|---|---|
| Design process | Visual mockup first, approved by Rajib, then built in code |
| Who writes articles | Rajib writes; the build supplies the blog system and outlines |
| Topic focus | AI + Linux engineering: self-hosted LLMs, RAG, AI agents, custom ISO builds, DevSecOps |
| Hosting | Static export on Cloudflare Pages (set up later by Rajib) |

## 2. AdSense policy checklist

Re-read Google's current **AdSense Program policies** and **Google Publisher Policies** before
applying; wording changes. This checklist is what the design is built around.

**Content**
- [ ] Original, first-hand articles. No copied text, no bulk AI-generated posts.
- [ ] Enough content before applying: roughly 20–30 solid articles and a few months of history
      (rule of thumb, not a Google figure).
- [ ] Clear topic focus and working navigation on every page.
- [ ] Security articles stay defensive (hardening, lab notes, how attacks are detected).
      Content that enables unauthorised access is ad-restricted.
- [ ] No empty, placeholder or "coming soon" pages are published.

**Required pages**
- [ ] About (who writes the site)
- [ ] Contact
- [ ] Privacy Policy: cookies, Google advertising cookies and how to opt out, contact-form data
- [ ] Terms: content licence, no-warranty disclaimer

**Ad placement**
- [ ] Ads only on pages with real publisher content: articles and the blog index.
- [ ] Never on home, about, contact, privacy, terms or 404.
- [ ] Content always outweighs ads on every page.
- [ ] Every slot is labelled "Advertisement" and sits clear of navigation, buttons and links.
- [ ] No text that asks or encourages visitors to click ads.
- [ ] No pop-ups, overlays or sticky units covering content.
- [ ] Slots reserve their height so the page does not jump when an ad loads.

**Technical**
- [ ] `ads.txt` at the site root with the publisher ID.
- [ ] Consent message for UK/EEA/Swiss visitors through AdSense "Privacy & messaging"
      (Google-certified), not a home-made banner.
- [ ] `sitemap.xml`, `robots.txt`, canonical URLs; site submitted to Google Search Console.
- [ ] Fast and usable on phones.

## 3. Site map

| Route | Purpose | Ads |
|---|---|---|
| `/` | Short intro, latest articles, topics, compact portfolio summary | none |
| `/blog` | Article index | one slot |
| `/blog/[slug]` | Article | up to three slots |
| `/topics/[tag]` | Articles by topic | none at first |
| `/about` | Full portfolio (today's page content) | none |
| `/contact` | Contact form | none |
| `/privacy`, `/terms` | Policy pages | none |
| 404 | Not found | none |

Also generated: `/sitemap.xml`, `/robots.txt`, `/feed.xml` (RSS), `/ads.txt`.

## 4. Design direction

- **Reading first.** Article column of about 70 characters, larger body type, proper code
  blocks with syntax highlighting, table of contents on desktop.
- **Calmer.** Navy and cyan stay as the brand accent. The particle canvas, floating icons and
  typing effect go, except a restrained home hero.
- **Light and dark themes** with a toggle, following the visitor's system setting by default.
- **Home** leads with writing, not the résumé: intro, latest articles, topics, then a short
  portfolio summary linking to About.
- A mockup of home, blog index and article (desktop and phone) is approved before any build.

## 5. Ad placement rules (as built)

- Component: `src/components/AdSlot.tsx`.
- Article page: one slot after the third section, one at the end of the article, one in the
  sidebar on desktop only. Nothing above the title.
- Blog index: one slot after the first few entries.
- **Off until approved:** slots and the AdSense script render nothing unless the environment
  variable `NEXT_PUBLIC_ADSENSE_CLIENT` is set, so reviewers never see empty ad boxes.

## 6. Build phases

1. **Mockup** — publish the design, get approval.
2. **Structure** — shared layout (header, footer, theme toggle); move today's portfolio to
   `/about`; contact form to `/contact`; new home page.
   Reuses `src/data/resume.ts`, `Nav.tsx`, `ContactForm.tsx`, `AnimateIn`, `SkillIcon`,
   `ProjectIcon`, `ProfileSocialIcon`.
3. **Blog** — Markdown files in `content/blog/*.md` with front matter (title, description,
   date, updated, tags, draft); loader in `src/lib/posts.ts`; article, index and topic pages.
4. **SEO** — per-page metadata, canonical URLs, Article structured data, sitemap, robots, RSS.
5. **Ads and policy pages** — `AdSlot`, privacy, terms, `ads.txt` placeholder instructions.
6. **Cloudflare Pages** — keep `output: "export"`; build command `npm run build`, output
   directory `out`; `public/_headers` and `public/_redirects`. The `gh-pages` deploy script and
   `CNAME` are removed only when hosting actually moves.
7. **Verify** — type check, lint, production build, browser check at desktop and phone width,
   ad slots absent without the environment variable and present only on blog pages with it.

Not verifiable before launch: AdSense approval, the consent message, real ad rendering.

## 7. Content calendar — first 10 articles

Rajib writes these from real experience. Each should be 1,200+ words with commands, config and
the mistakes made along the way. Never publish client-confidential detail from Brotecs
products.

1. **Building a custom Linux ISO from scratch** — why a custom ISO; base distro choice;
   package selection; preseed/kickstart; build pipeline; testing on hardware; lessons.
2. **Self-hosting an LLM on your own server** — hardware sizing; choosing a runtime; model
   and quantisation choice; serving an API; measured speed and memory; when it is not worth it.
3. **A RAG pipeline that actually answers correctly** — chunking; embeddings; vector store;
   retrieval tuning; evaluating answers; failure cases.
4. **Designing an AI agent with tools** — what an agent is; tool definitions; loop and stop
   conditions; guarding against bad actions; logging; a worked example.
5. **Adding an AI assistant to an existing product** — where it helps; API integration;
   prompts as code; cost and latency; rollout.
6. **DevSecOps for a small team** — CI/CD stages; dependency and image scanning; secrets;
   what to automate first.
7. **Upgrading the OS under a shipping product** — planning; compatibility audit; staged
   rollout; rollback; what broke.
8. **Hardening a Linux server: a practical checklist** — SSH; firewall; updates; users and
   sudo; auditing; verifying the result.
9. **What the Cisco Ethical Hacker course teaches (and what it doesn't)** — syllabus; labs;
   time taken; who it suits; how it changed day-to-day engineering. Defensive framing.
10. **Docker in production: lessons from real deployments** — image size; health checks;
    logging; resource limits; common failures.

Suggested pace: one article a week.

## 8. Launch and apply checklist

- [ ] Site live on Cloudflare Pages at rajib.uk with HTTPS
- [ ] Search Console verified, sitemap submitted
- [ ] 20–30 articles published, each indexed
- [ ] Policy checklist in section 2 fully ticked
- [ ] Create AdSense account, add site, set `NEXT_PUBLIC_ADSENSE_CLIENT`, add `ads.txt`
- [ ] Turn on the consent message in AdSense "Privacy & messaging"
- [ ] After approval: confirm ads appear only on blog pages

## Out of scope for the build

Writing the articles, creating the AdSense account, and setting up Cloudflare Pages.
