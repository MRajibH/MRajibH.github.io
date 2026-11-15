# Handoff: 30 draft guides for rajib.uk

Written 2026-11-15. Read this to continue the work in a new session if the usage limit
interrupts it. Background and policy: `docs/ADSENSE_SITE_PLAN.md`.

## Goal

Write 30 long, accurate, in-niche technical guides as **drafts** in `content/blog/`. Rajib
reviews each, adds his own experience, and publishes a few per week. Decisions already made:
in-niche evergreen guides (not general trending topics), all saved as `draft: true`.

## State

- Site is built and committed. Share buttons and generated social preview images are done.
- To see which guides exist and whether they pass:

  ```bash
  node scripts/check-content.mjs --include-drafts
  ```

  Any file in the list below that is missing from that output still has to be written.

## The 30 guides (file -> title -> tags)

Self-hosted LLMs
1. `run-llm-locally-with-ollama.md` -> How to run an LLM locally with Ollama: a complete setup guide -> self-hosted-llms
2. `ollama-vs-llama-cpp-vs-vllm.md` -> Ollama vs llama.cpp vs vLLM: which should you self-host with? -> self-hosted-llms
3. `open-webui-self-hosted-chatgpt.md` -> Self-host a private ChatGPT with Open WebUI and Ollama -> self-hosted-llms
4. `hardware-for-local-llms.md` -> Hardware for local LLMs: GPU, VRAM and RAM explained -> self-hosted-llms
5. `gguf-quantization-explained.md` -> GGUF and quantization explained: choosing Q4, Q5 or Q8 -> self-hosted-llms
6. `vllm-production-deployment.md` -> Serving LLMs in production with vLLM: a practical guide -> self-hosted-llms
7. `litellm-gateway-self-hosted.md` -> One API for every model: setting up a LiteLLM gateway -> self-hosted-llms
8. `secure-self-hosted-llm-api.md` -> Securing a self-hosted LLM API: auth, TLS and rate limits -> self-hosted-llms, devsecops

RAG and agents
9. `build-rag-pipeline-from-scratch.md` -> Build a RAG pipeline from scratch in Python, step by step -> rag-and-agents
10. `rag-chunking-strategies.md` -> RAG chunking strategies: how to split documents that retrieve well -> rag-and-agents
11. `choosing-a-vector-database.md` -> pgvector vs Qdrant vs Chroma: choosing a vector database -> rag-and-agents
12. `evaluate-rag-system.md` -> How to evaluate a RAG system: metrics, test sets and tooling -> rag-and-agents
13. `hybrid-search-and-reranking.md` -> Hybrid search and reranking: better retrieval for RAG -> rag-and-agents
14. `build-ai-agent-with-tool-calling.md` -> Build an AI agent with tool calling from first principles -> rag-and-agents
15. `model-context-protocol-explained.md` -> Model Context Protocol (MCP) explained with a working server -> rag-and-agents
16. `prompt-injection-defence.md` -> Prompt injection: how it works and how to defend your app -> rag-and-agents, devsecops

Linux
17. `linux-server-hardening-checklist.md` -> Linux server hardening: a practical checklist with commands -> linux, devsecops
18. `ssh-hardening-guide.md` -> SSH hardening: keys, sshd_config and fail2ban done properly -> linux, devsecops
19. `build-custom-debian-iso.md` -> How to build a custom Debian ISO with live-build -> linux
20. `systemd-service-units-guide.md` -> Writing systemd services: unit files, restarts and sandboxing -> linux
21. `nftables-firewall-guide.md` -> nftables for beginners: a practical Linux firewall guide -> linux, devsecops
22. `linux-performance-troubleshooting.md` -> Linux performance troubleshooting: what to check first -> linux

DevSecOps
23. `docker-security-best-practices.md` -> Docker security best practices: hardening containers properly -> devsecops
24. `dockerfile-best-practices-small-images.md` -> Dockerfile best practices: smaller, faster, safer images -> devsecops
25. `devsecops-pipeline-github-actions.md` -> A DevSecOps pipeline in GitHub Actions: test, scan, deploy -> devsecops
26. `secrets-management-guide.md` -> Secrets management for small teams: from .env files to a vault -> devsecops
27. `container-image-scanning-trivy.md` -> Container image scanning with Trivy: find and fix vulnerabilities -> devsecops
28. `docker-compose-in-production.md` -> Docker Compose in production: what to change before you deploy -> devsecops

Web
29. `rest-api-design-best-practices.md` -> REST API design best practices: naming, errors and versioning -> web
30. `deploy-nextjs-static-site-cloudflare-pages.md` -> Deploy a static Next.js site to Cloudflare Pages, step by step -> web

## Rules for every guide

Front matter: `title` (exact, 15-70 chars), `description` (50-160 chars), `date: 2026-11-15`,
`tags`, `draft: true`. Format reference: `content/blog/_template.md`.

- 1,800-2,500 words of prose (code blocks not counted), at least 6 `## ` sections, no `# `
  heading. Most useful material in the first three sections.
- Real commands and config in fenced blocks with a language tag; explain why, not only how;
  a comparison table where it helps; a "Common mistakes" section; a final "Frequently asked
  questions" section with 3-5 `###` questions.
- Accuracy first: check commands, flags and defaults against official docs. No invented
  benchmarks, prices, versions or statistics. Leave out what cannot be verified.
- No invented first-person experience and no mention of an employer. Neutral "you" voice.
- Original wording and code. Plain, direct tone: no hype, filler or emoji.
- Security content is defensive only.
- No placeholder text (TODO, TBD, "[your ...]"). No images.
- Cross-link 2-3 related guides as `[text](/blog/<slug>/)` using the slugs above.

## To continue in a new session

Tell Claude:

> Read docs/HANDOFF.md. Run the draft check, then write the guides from the list that are
> still missing, following the rules there. Save each file as soon as it is finished.

Writing five or six guides at a time in parallel used a full 5-hour usage window in one go.
Two or three at a time is slower but less likely to be cut off.

## After all 30 exist

1. `node scripts/check-content.mjs --include-drafts` passes for every file.
2. Spot-review for accuracy and overlap between guides.
3. Preview build: `INCLUDE_DRAFTS=1 npm run build`, then check a few articles in the browser.
4. Commit. Rajib then reviews, removes `draft: true` and sets the real `date` on each guide
   as he publishes it.
