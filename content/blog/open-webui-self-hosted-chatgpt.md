---
title: "Self-host a private ChatGPT with Open WebUI and Ollama"
description: "Deploy Open WebUI with Ollama using Docker Compose, set up accounts, add documents, put it behind HTTPS and keep it backed up and updated."
date: 2026-11-15
tags: [self-hosted-llms]
draft: true
---

A local model in a terminal is useful for one person who likes terminals. To give a household or a team something they will actually use, you need a browser chat interface with accounts, conversation history and file uploads, and you need the conversations to stay on your own server. Open WebUI provides that interface, and Ollama runs the models behind it. This guide builds the pair with Docker Compose, then covers the parts that tutorials tend to skip: who can sign up, how the two services reach each other, HTTPS, backups and updates.

You need a Linux host with Docker and the Compose plugin installed. A GPU is optional but makes a large difference to response speed; [Hardware for local LLMs](/blog/hardware-for-local-llms/) covers what to expect from different machines.

## How the pieces fit together

There are two services with separate jobs:

- **Ollama** loads model weights and generates text. It exposes an HTTP API on port 11434 and has no concept of users or logins.
- **Open WebUI** is a web application. It stores users, chats and settings in its own database, and forwards each prompt to a model backend. Inside its container it listens on port 8080.

The browser only ever talks to Open WebUI. Open WebUI talks to Ollama on the server side. That detail drives the main security decision in this guide: Ollama never needs to be reachable from outside, so it will not be published on any host port. Access control lives in Open WebUI, and nothing can go around it.

Open WebUI is not tied to Ollama. It can also connect to any OpenAI-compatible endpoint, so the same interface can sit in front of llama.cpp or vLLM later. [Ollama vs llama.cpp vs vLLM](/blog/ollama-vs-llama-cpp-vs-vllm/) explains when you would switch.

## Deploy both services with Docker Compose

Create a directory for the deployment and generate a secret key. Open WebUI uses this key to sign login tokens and to encrypt some stored secrets. If you do not set one, the container generates a key and stores it inside the container's own filesystem, so recreating the container during an update logs every user out. Setting it once avoids that:

```bash
mkdir -p ~/open-webui && cd ~/open-webui
printf 'WEBUI_SECRET_KEY=%s\n' "$(openssl rand -hex 32)" > .env
chmod 600 .env
```

Now write `compose.yaml` in the same directory:

```yaml
services:
  ollama:
    image: ollama/ollama
    restart: unless-stopped
    volumes:
      - ollama:/root/.ollama
    # No "ports" entry: Ollama is reachable only from the Compose network.
    # Remove the "deploy" block below on a machine without an NVIDIA GPU.
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: all
              capabilities: [gpu]

  open-webui:
    image: ghcr.io/open-webui/open-webui:main
    restart: unless-stopped
    depends_on:
      - ollama
    ports:
      - "127.0.0.1:3000:8080"
    environment:
      OLLAMA_BASE_URL: http://ollama:11434
      WEBUI_SECRET_KEY: ${WEBUI_SECRET_KEY}
    volumes:
      - open-webui:/app/backend/data

volumes:
  ollama:
  open-webui:
```

The reasoning behind each choice:

- **Two named volumes.** `ollama` holds downloaded models. `open-webui` holds the database, uploaded files and the document index. Without the second volume, every chat and account disappears when the container is replaced.
- **`OLLAMA_BASE_URL: http://ollama:11434`.** Compose puts both services on a private network where each is reachable by its service name. This is simpler and safer than pointing the container at the host.
- **`127.0.0.1:3000:8080`.** The interface is published on the loopback address only. Docker publishes ports on every interface by default and inserts its own firewall rules, which can bypass the host firewall you rely on. Binding to loopback means the only way in from outside is the reverse proxy added later.
- **The `deploy` block** hands the NVIDIA GPU to Ollama. It needs the NVIDIA Container Toolkit on the host. Open WebUI itself does not need the GPU for chat.

Start the stack and pull a model:

```bash
docker compose up -d
docker compose exec ollama ollama pull llama3.2
docker compose exec ollama ollama ps
```

The interface is now at `http://localhost:3000` on the server. If the server is remote, reach it for the moment through an SSH tunnel rather than opening the port:

```bash
ssh -L 3000:127.0.0.1:3000 user@server.example.com
```

### If Ollama already runs on the host

You may have installed Ollama as a system service, as in [How to run an LLM locally with Ollama](/blog/run-llm-locally-with-ollama/). In that case drop the `ollama` service from the file and let the container reach the host:

```yaml
  open-webui:
    image: ghcr.io/open-webui/open-webui:main
    restart: unless-stopped
    ports:
      - "127.0.0.1:3000:8080"
    extra_hosts:
      - "host.docker.internal:host-gateway"
    environment:
      OLLAMA_BASE_URL: http://host.docker.internal:11434
      WEBUI_SECRET_KEY: ${WEBUI_SECRET_KEY}
    volumes:
      - open-webui:/app/backend/data
```

There is a catch on Linux. Ollama listens on `127.0.0.1` by default, and a connection from a container arrives on the Docker bridge interface, not on loopback, so it is refused. You have to set `OLLAMA_HOST` on the Ollama service so that it listens on an address the container can reach, and then make sure a firewall keeps port 11434 closed to everything else. The all-in-Compose layout above avoids this problem, which is why it is the recommended one.

## Create the admin account and control sign-ups

Open the interface and create the first account. This step matters more than it looks: **the first account created becomes the administrator**. Do it immediately after starting the container, before the address is reachable by anyone else.

After that, the defaults are sensible. New sign-ups are disabled once the admin exists. If you enable them in the admin settings, new accounts are created with the `pending` role and cannot use anything until an administrator approves them.

The relevant settings, from the [environment variable reference](https://docs.openwebui.com/reference/env-configuration):

| Variable | Default | Effect |
| --- | --- | --- |
| `WEBUI_AUTH` | `True` | Turns login on or off for the whole instance |
| `ENABLE_SIGNUP` | `True` | Allows the sign-up form to create accounts |
| `DEFAULT_USER_ROLE` | `pending` | Role given to new accounts: `pending`, `user` or `admin` |
| `ENABLE_ADMIN_CHAT_ACCESS` | `True` | Lets administrators open other users' chats |
| `ENABLE_PERSISTENT_CONFIG` | `True` | Saved settings in the database take priority over environment variables |

Three points deserve attention.

**Do not disable authentication on a shared server.** `WEBUI_AUTH=False` gives a single-user mode with no login. It is only meant for a personal machine, it can only be set on a fresh installation with no users, and you cannot switch between the two modes afterwards.

**Leave the default role as `pending`.** Setting it to `user` means anyone who finds the sign-up page gets immediate access to your models and your GPU.

**Tell users what administrators can see.** By default an administrator can open other users' conversations. If the promise of the deployment is privacy between colleagues, set `ENABLE_ADMIN_CHAT_ACCESS=False` and say so. Remember that whoever has shell access to the server can read the database regardless.

## Models, system prompts and documents

Models pulled into Ollama appear in the model selector at the top of a chat. Pull more from the command line at any time:

```bash
docker compose exec ollama ollama pull nomic-embed-text
docker compose exec ollama ollama ls
```

Three features are worth setting up early.

**Custom model presets.** In the workspace area you can wrap a base model with a system prompt, parameters and attached knowledge, and give it a name. This is how you offer users a "policy assistant" or a "code reviewer" without asking them to paste a prompt each time. Presets can be restricted to particular users or groups.

**Context length.** Ollama's default context window is small on most hardware, and Open WebUI can override it per model through the `num_ctx` advanced parameter. When that parameter is set in the interface, it is sent with each request and takes priority over the `OLLAMA_CONTEXT_LENGTH` value on the Ollama server. If long conversations or documents seem to be forgotten, check this value first, and remember that a larger window uses more GPU memory.

**Documents.** You can upload files into a chat or collect them into a knowledge base that a model preset uses. Open WebUI splits the text into chunks, turns each chunk into an embedding (a list of numbers that represents its meaning), and retrieves the most relevant chunks for each question. This technique is called retrieval-augmented generation, or RAG. Out of the box the embeddings are computed inside the Open WebUI container by a small SentenceTransformers model, and stored in a Chroma vector database on the data volume. That works without configuration, but the first use downloads the embedding model from Hugging Face, so a server with no outbound internet access needs it supplied in advance or needs embeddings pointed at Ollama in the document settings.

Built-in document handling is convenient for small collections. For larger ones, results depend heavily on how text is chunked and retrieved, which is the subject of [RAG chunking strategies](/blog/rag-chunking-strategies/).

## Put it behind HTTPS

Logins and conversations should not cross a network unencrypted, and browsers refuse features such as microphone access on plain HTTP pages. Put a reverse proxy in front that terminates TLS and forwards to the loopback port.

Open WebUI streams responses and uses WebSocket connections, so the proxy must pass those through. Caddy handles both by default and also obtains and renews certificates automatically, which makes its configuration short. A `Caddyfile` for a server with a public DNS name:

```caddyfile
chat.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

If you use nginx instead, the equivalent needs the upgrade headers set explicitly, and buffering turned off so that tokens appear as they are generated:

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
    proxy_read_timeout 300s;
    client_max_body_size 50m;
}
```

Once the site is served over HTTPS, tighten two settings in the Compose file. `WEBUI_URL` tells the application its public address, and `CORS_ALLOW_ORIGIN` defaults to `*`, which the documentation says should be replaced with your real origin:

```yaml
    environment:
      WEBUI_URL: https://chat.example.com
      CORS_ALLOW_ORIGIN: https://chat.example.com
      WEBUI_SESSION_COOKIE_SECURE: "true"
```

A chat interface for a team does not need to be on the public internet at all. Keeping it reachable only over a VPN or the office network removes a whole category of risk. If it must be public, the host itself needs attention too; the [Linux server hardening checklist](/blog/linux-server-hardening-checklist/) is a good starting point.

## Back up and update

Everything that matters is in the `open-webui` volume: the SQLite database with users and chats, uploaded files, and the vector index. The `ollama` volume holds only models, which can be downloaded again.

A simple backup stops the application briefly so the database is not copied mid-write, archives the volume, and starts it again. Compose prefixes volume names with the project name, which is the directory name by default, so confirm the real name first:

```bash
docker volume ls | grep open-webui

docker compose stop open-webui
docker run --rm \
  -v open-webui_open-webui:/data:ro \
  -v "$PWD/backups:/backup" \
  alpine tar czf "/backup/open-webui-$(date +%F).tar.gz" -C /data .
docker compose start open-webui
```

Keep the `.env` file with the backups. A restored database without the original `WEBUI_SECRET_KEY` cannot decrypt the secrets stored in it. Copy the archives to another machine, and test a restore into a scratch volume once so that you know it works.

Updating is two commands, because all state lives in volumes:

```bash
docker compose pull
docker compose up -d
```

The `:main` tag follows the latest release. Open WebUI moves quickly and releases sometimes change the database schema, so take a backup before updating, and consider pinning the image to a specific version tag on a server other people depend on. Then update on your schedule rather than whenever the container happens to be recreated.

## Common mistakes and troubleshooting

**No models in the selector.** Open WebUI cannot reach Ollama, or no model has been pulled. Check the connection from inside the network and look at the logs:

```bash
docker compose exec ollama ollama ls
docker compose logs --tail 50 open-webui
```

In the host-Ollama layout, the usual cause is Ollama listening only on `127.0.0.1`, as described earlier.

**A changed environment variable has no effect.** Many settings are stored in the database the first time the application starts, and from then on the saved value wins over the environment variable. Change those settings in the admin interface. Setting `ENABLE_PERSISTENT_CONFIG=False` makes environment variables authoritative, at the cost of losing changes made in the interface on restart.

**Everyone is logged out after an update.** The secret key was not fixed, so a new one was generated with the new container. Set `WEBUI_SECRET_KEY` as shown above.

**Responses appear all at once, or the page shows connection errors behind the proxy.** The proxy is buffering the stream or not forwarding WebSocket upgrades. Use the nginx settings above, and set `CORS_ALLOW_ORIGIN` to the site's real origin.

**Chats vanished after recreating the container.** The data volume was not mounted at `/app/backend/data`. Nothing can recover data that was only ever in the container's writable layer, so verify the mount with `docker inspect` before trusting a new deployment.

**Answers are slow for everyone at once.** A single Ollama instance processes a limited number of requests in parallel. For more than a handful of simultaneous users, look at Ollama's `OLLAMA_NUM_PARALLEL` setting or a backend built for concurrency.

**The model ignores the start of a long chat.** The conversation has outgrown the context window. Raise `num_ctx` for that model.

## Frequently asked questions

### Does Open WebUI send my chats to an external service?

Not when it is connected only to a local backend such as Ollama: prompts go from the browser to your server and stop there. The application does make some outbound requests of its own, such as update checks and downloading the default embedding model. Setting `OFFLINE_MODE=True` disables those network connections. Features you add yourself, such as web search or a hosted API connection, send data to those services by design.

### Can I use Open WebUI without Ollama?

Yes. It accepts any OpenAI-compatible API as a connection, configured in the admin settings or with the `OPENAI_API_BASE_URL` and `OPENAI_API_KEY` variables. That covers llama.cpp's server, vLLM and hosted providers.

### How many users can one server handle?

Open WebUI itself is light; the model backend is the limit. A single GPU running Ollama serves a small team comfortably when people take turns, and slows down as simultaneous requests queue up. Measure with your own model and usage pattern before promising capacity.

### Is the default SQLite database enough?

For a single server and a modest number of users, yes. The documentation describes PostgreSQL support through the `DATABASE_URL` variable for larger or multi-replica deployments.

### How do I reset a forgotten admin password?

The Open WebUI documentation describes recovery procedures that involve updating the password hash in the database from the server. Because this needs shell access to the host, it is another reason to treat that access as equivalent to full control of the application.
