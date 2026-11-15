---
title: "Deploy a static Next.js site to Cloudflare Pages, step by step"
description: "Connect a Git repository to Cloudflare Pages, set the build for a Next.js static export, add a custom domain, headers and redirects, and fix failed builds."
date: 2026-11-15
tags: [web]
art:
  kind: flow
  caption: "A push to the repository becomes a live site with no manual steps."
  items: ["git push", "Cloudflare builds the site", "Static files deployed", "Served worldwide"]
draft: true
---

A statically exported Next.js site is a folder of HTML, CSS and JavaScript files, and it needs a host that serves that folder quickly and rebuilds it whenever the repository changes. Cloudflare Pages does both. This guide takes a working static export from a Git repository to a live site on your own domain, with security headers, redirects, preview deployments for every branch, and a list of the failures you are most likely to meet on the way.

It covers deployment only. How the site itself is put together (the export setting, Markdown rendering, the content checks) is described in [How this site is built](/blog/static-nextjs-blog-with-markdown/).

## What you need before you start

Three things have to be true before Pages can build the project.

**The project builds as a static export.** `next.config.mjs` (or `.js`) must contain `output: "export"`. With that setting, `next build` writes the finished site to an `out/` folder. The separate `next export` command no longer exists; it was removed in Next.js 14, so any tutorial that tells you to run it is out of date.

**The build succeeds on a clean checkout.** Pages starts from a fresh clone every time, so anything that only exists on your machine (an untracked file, a globally installed tool, a local `.env`) will be missing. Test it the way Pages will run it:

```bash
git clone https://github.com/example-user/example-site.git /tmp/clean-build
cd /tmp/clean-build
npm ci
npm run build
ls out/index.html out/404.html
```

If both files are listed, the export works. `404.html` matters more than it looks, for a reason covered in the troubleshooting section.

**The lockfile is committed.** `package-lock.json` (or the pnpm or Yarn equivalent) pins the exact dependency versions. Without it, a build next month can pull different packages from the build you tested today.

A static export also rules out some Next.js features, because there is no server to run them: rewrites, redirects and headers defined in `next.config`, cookies, Server Actions, Incremental Static Regeneration, Draft Mode, and image optimisation with the default loader. Redirects and headers are not lost, though. Pages has its own files for both, described below.

## Connect the repository and create the project

Push the project to GitHub or GitLab, then create the Pages project:

1. In the Cloudflare dashboard, open **Workers & Pages**.
2. Select **Create application**, then the **Pages** tab.
3. Select **Import an existing Git repository**.
4. Authorise Cloudflare for your Git account. When asked, grant access to the one repository you are deploying rather than every repository in the account. That keeps the integration's reach as small as the job requires.
5. Choose the repository and select **Begin setup**.

There is a second way to deploy, called Direct Upload, where you build the site yourself and push the output folder with Wrangler, Cloudflare's command-line tool:

```bash
npm run build
npx wrangler pages project create
npx wrangler pages deploy out
```

This is useful when the build must run in your own continuous integration (CI) pipeline, for example because it needs a private network. Choose deliberately, because the two modes are not interchangeable: a project created with Direct Upload cannot be switched to Git integration later, and a Git-integrated project cannot be switched to Direct Upload. The rest of this guide assumes Git integration.

## Build settings that work for a static export

The setup screen asks for four values. These are the ones that matter:

| Setting | Value | Why |
| --- | --- | --- |
| Production branch | `main` | Commits to this branch go to the live site |
| Framework preset | Next.js (Static HTML Export) | Fills in the two fields below |
| Build command | `npx next build` | Produces the export |
| Build output directory | `out` | The folder Pages uploads |

There are other Next.js-related options in the preset list. Pick the one with "Static HTML Export" in its name; the others assume a server-rendered application and will fail or deploy nothing useful.

### Use your own build script if you have build hooks

The preset's command, `npx next build`, runs Next.js directly. It does not go through `package.json` scripts, which means `prebuild` and `postbuild` hooks are skipped. If your project relies on them (a content check before the build, a sitemap or search index generated after it), change the build command to:

```bash
npm run build
```

npm then runs `prebuild`, `build` and `postbuild` in order, exactly as on your machine. If a `prebuild` check fails, the deployment fails and the previous version stays live, which is the behaviour you want from a quality gate.

### Pin the Node.js version

The build image has a default Node.js version, and that default changes when Cloudflare updates the image. Pin the version so a platform update cannot change your build. Either add a file named `.nvmrc` or `.node-version` to the repository root:

```bash
echo "22" > .nvmrc
git add .nvmrc
git commit -m "Pin Node.js version for builds"
```

or set an environment variable named `NODE_VERSION` in the project settings. The file is the better choice because it travels with the code and is also read by local version managers. The current build image does not read the `engines` field in `package.json`, so setting the version there has no effect on Pages.

### Verify the first deployment

Select **Save and Deploy**. The build log streams in the dashboard. When it finishes, the project is live at `https://<project>.pages.dev`. Check it from a terminal:

```bash
curl -I https://example-site.pages.dev/
curl -s -o /dev/null -w "%{http_code}\n" https://example-site.pages.dev/no-such-page/
```

The first command should return `200`. The second should print `404`. If it prints `200`, read the troubleshooting section before going further.

## Environment variables and build-time values

A static site has no runtime environment. Every value is either baked into the files during the build or it does not exist. That has two consequences.

First, in Next.js only variables whose names start with `NEXT_PUBLIC_` are included in the browser bundle, and they are included as plain text. Anything with that prefix is public the moment you deploy. Analytics identifiers and public API base URLs are fine. API keys with write access, tokens and passwords are not, and no host setting can make them private once they are in a JavaScript file. If the site needs to call something with a secret, that call belongs in a separate backend, not in the export. [Secrets management for small teams](/blog/secrets-management-guide/) covers where such values should live instead.

Second, changing a variable does nothing until the next build. Variables are set under **Settings** > **Environment variables** in the Pages project, and Pages keeps separate values for the production environment and the preview environment. After a change, trigger a new deployment.

Pages also injects a few variables into every build, which are useful for build-time decisions:

| Variable | Contains |
| --- | --- |
| `CF_PAGES` | `1`, so a script can tell it is running on Pages |
| `CF_PAGES_BRANCH` | The branch being built |
| `CF_PAGES_COMMIT_SHA` | The commit being built |
| `CF_PAGES_URL` | The address this deployment will be published at |

A common use is showing the commit in the page footer, or switching behaviour for previews:

```js
// next.config.mjs
const isPreview = process.env.CF_PAGES === "1" && process.env.CF_PAGES_BRANCH !== "main";

const nextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  env: {
    NEXT_PUBLIC_COMMIT: (process.env.CF_PAGES_COMMIT_SHA ?? "local").slice(0, 7),
    NEXT_PUBLIC_IS_PREVIEW: String(isPreview),
  },
};

export default nextConfig;
```

To confirm a value made it into the build, search the output locally with the same variables set:

```bash
CF_PAGES=1 CF_PAGES_BRANCH=main CF_PAGES_COMMIT_SHA=abc1234def npm run build
grep -rl "abc1234" out/ | head -n 3
```

## Add a custom domain

The `pages.dev` address works, but a site that is meant to be found, linked to and monetised needs its own domain.

1. In **Workers & Pages**, select the project, then **Custom domains**.
2. Select **Set up a domain**.
3. Enter the domain and select **Continue**.

What happens next depends on the kind of name:

- **An apex domain** such as `example.com` must be a zone on Cloudflare, which means the domain's nameservers point to Cloudflare. Once they do, Cloudflare creates the DNS record for you.
- **A subdomain** such as `www.example.com` or `blog.example.com` can stay with another DNS provider. Add a `CNAME` record there that points the subdomain to `<project>.pages.dev`.

Do the steps in that order. If you create the `CNAME` yourself without first adding the domain in the Pages dashboard, the name will not resolve to your site and visitors get a 522 error. The dashboard step is what tells Pages to accept requests for that hostname and to issue a certificate for it.

If the domain has CAA records (DNS records that restrict which certificate authorities may issue for it), make sure they allow the authorities Cloudflare uses; the [custom domains documentation](https://developers.cloudflare.com/pages/configuration/custom-domains/) lists the records to add. A restrictive CAA record is a frequent cause of a domain that stays in a pending state.

Verify with:

```bash
dig +short www.example.com CNAME
curl -sI https://www.example.com/ | head -n 1
```

### Decide what happens to the pages.dev address

After the custom domain is active, the same site is reachable at two addresses. Search engines may treat that as duplicate content. Two measures deal with it: a canonical link tag in every page pointing at the custom domain (a job for the site's own code), and a `noindex` header on the `pages.dev` hostname, shown in the next section. If you want the `pages.dev` address to redirect to the custom domain outright, that needs Cloudflare's account-level Bulk Redirects feature, because the `_redirects` file cannot match on hostnames.

## Headers and redirects with plain text files

Because a static export ignores `headers()` and `redirects()` in `next.config`, Pages reads two plain text files from the build output instead. Put both in the `public/` folder of the Next.js project; the build copies everything in `public/` to the root of `out/`, which is where Pages looks. Neither file is served to visitors.

### The _headers file

Each rule is a URL pattern on its own line followed by indented header lines:

```txt
# public/_headers

/*
  X-Frame-Options: DENY
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  Strict-Transport-Security: max-age=31536000

/_next/static/*
  Cache-Control: public, max-age=31536000, immutable

https://:project.pages.dev/*
  X-Robots-Tag: noindex
```

The reasoning for each block:

- **Security headers on every path.** `X-Frame-Options: DENY` stops other sites from embedding your pages in a frame, which blocks clickjacking. `Permissions-Policy` switches off browser features the site never uses. `Strict-Transport-Security` tells browsers to use HTTPS only for the next year; add it only when every subdomain you care about already works over HTTPS. Pages already sends `X-Content-Type-Options: nosniff` and a `Referrer-Policy` by default, so there is no need to repeat them.
- **Long caching for hashed assets.** Files under `/_next/static/` have a content hash in their names, so a changed file always gets a new address. They are safe to cache for a year. HTML should keep the default, which makes browsers revalidate on each visit so readers see new articles immediately.
- **No indexing of the pages.dev address.** `:project` is a placeholder that matches the project name in the hostname.

The file allows at most 100 rules, and each line can be at most 2,000 characters. If two matching rules set the same header, the values are joined with a comma rather than replaced.

### The _redirects file

One redirect per line: source, destination, and an optional status code.

```txt
# public/_redirects

/feed            /rss.xml           301
/articles/*      /blog/:splat       301
/tag/:name       /topics/:name/     301
```

The default status is 302 (temporary). Write `301` explicitly for permanent moves, because that is the code that tells search engines to transfer the old address's standing to the new one. `*` matches everything after that point and is reused as `:splat`; `:name` matches one path segment. Put specific rules above general ones, since the first match wins.

The file supports 2,000 static and 100 dynamic redirects (those using a splat or placeholder). It cannot match on query strings or hostnames.

Verify both files after deploying:

```bash
curl -sI https://www.example.com/ | grep -iE "x-frame-options|strict-transport|permissions-policy"
ASSET=$(curl -s https://www.example.com/ | grep -o '/_next/static/[^"]*\.js' | head -n 1)
curl -sI "https://www.example.com$ASSET" | grep -i cache-control
curl -sI https://www.example.com/feed | grep -iE "^HTTP|^location"
curl -sI https://example-site.pages.dev/ | grep -i x-robots-tag
```

## Preview deployments

Every push to a branch other than the production branch gets its own deployment. That gives you a real, hosted copy of a change before it is merged.

Each preview has two addresses:

- `https://<hash>.<project>.pages.dev`, which is fixed to that one commit.
- `https://<branch>.<project>.pages.dev`, which always shows the latest commit on the branch. The branch name is lowercased and other characters become hyphens, so `fix/nav-menu` is served at `fix-nav-menu.<project>.pages.dev`.

Two properties are worth knowing. Previews are sent with an `X-Robots-Tag: noindex` header by default, so unfinished pages stay out of search results. But previews are public: anyone with the link can open them. For a blog that is usually acceptable. If drafts must stay private, go to **Settings** > **General** in the project and select **Enable access policy**, which puts preview deployments behind a Cloudflare Access login.

You can also limit which branches are built. Under **Settings** > **Builds & deployments**, the preview branch setting offers **All non-Production branches** (the default), **None**, or **Custom branches** with include and exclude patterns. Excluding `dependabot/*` is a reasonable way to stop automated dependency branches from consuming your monthly builds.

## Limits to keep in mind

At the time of writing, the Free plan allows 500 builds a month, one build at a time, 20 minutes per build, 20,000 files per site and 25 MiB per file. Check the [limits page](https://developers.cloudflare.com/pages/platform/limits/) before relying on these numbers, since they are revised from time to time. For a blog, the file count is the one to watch as the site grows, and large media belongs in object storage rather than in the repository.

## Common mistakes and troubleshooting

**The build fails with "output directory not found".** The build finished but no `out/` folder exists. Either `output: "export"` is missing from the Next.js configuration, or the output directory field is set to `.next` or `build`. If the project lives in a subfolder of the repository, set the **Root directory** in the build settings so the command runs in the right place.

**The build passes locally and fails on Pages.** Compare Node.js versions first; pin one as described above. Then check for files that exist locally but are not committed, and for file names whose letter case differs from the import. `import Header from "./header"` finds `Header.tsx` on macOS and Windows, but the Linux build machine is case-sensitive.

**Unknown addresses show the home page instead of a 404.** When the output has no top-level `404.html`, Pages assumes the project is a single-page application and serves the root page for every unknown path, with a `200` status. Search engines then see endless duplicate pages. Make sure the build produces `out/404.html` (in the App Router, add `app/not-found.tsx`), and verify with the `curl` status check from earlier.

**A dynamic route is missing or the build errors on it.** In a static export, every dynamic route such as `app/blog/[slug]/page.tsx` must export `generateStaticParams()` so the build knows which pages to write. Pages that are not listed there do not exist.

**Headers or redirects are ignored.** Confirm the files reached the output: `ls out/_headers out/_redirects`. They must be at the root of the output folder, named without an extension, and the header lines must be indented under their URL line.

**The custom domain shows a 522 error or stays pending.** The `CNAME` was probably created before the domain was added in the dashboard, or a CAA record blocks certificate issuing. Remove the domain, add it again through **Custom domains**, and let the dashboard guide the DNS step.

**The site shows old content after a deployment.** Pages clears its own cache on each deployment. If the custom domain's zone has a Cache Rule or Page Rule that caches HTML, that cache sits in front of Pages and is not cleared. Remove or narrow the rule, then purge the affected addresses.

## Frequently asked questions

### Can I use Next.js API routes or Server Actions on a static export?

No. A static export has no server, so anything that runs per request is unavailable. Route Handlers work only when they respond to `GET` and can be rendered to a file at build time. For form submissions or other dynamic behaviour, call an external service from the browser or host a small separate backend.

### How do I undo a bad deployment?

The fastest safe route is Git: revert the commit and push, and Pages builds and publishes the previous state. The dashboard's deployment list also keeps earlier production deployments, and you can roll back to one of them from there without a new build.

### Will preview deployments hurt my search ranking?

Not by default. Preview addresses are served with `X-Robots-Tag: noindex`, which asks search engines to leave them out. The production `pages.dev` address does not get that header automatically, which is why the `_headers` rule in this guide adds it once a custom domain is in place.

### Does changing an environment variable update the live site?

Not on its own. Values are compiled into the static files during the build, so the live site keeps the old value until a new deployment is built. Push a commit or retry the latest deployment after changing a variable.
