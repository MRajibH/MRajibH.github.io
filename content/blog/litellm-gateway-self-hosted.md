---
title: "One API for every model: setting up a LiteLLM gateway"
description: "Set up a LiteLLM proxy in front of vLLM, Ollama and hosted models: config file, virtual keys, per-key limits, load balancing and fallbacks."
date: 2026-11-15
tags: [self-hosted-llms]
art:
  kind: flow
  caption: "One gateway gives every application the same API for every model."
  items: ["Your applications", "LiteLLM gateway", "Local and cloud models"]
draft: true
---

Once you run more than one model, every application ends up with its own list of base URLs, API keys and model names, and changing any of them means touching every application. A gateway fixes that by giving all clients one address and one API, and keeping the knowledge of which model lives where in a single config file. This guide sets up LiteLLM as that gateway: by the end you will have one OpenAI-compatible endpoint that routes to self-hosted and hosted models, issues separate keys per application with their own limits, and fails over when a backend is down.

## What a gateway gives you

LiteLLM is an open-source project with two parts: a Python library that translates between the request formats of many model providers, and a proxy server built on it. The proxy is the gateway. Clients send it requests in the OpenAI format; it picks a backend, translates the request if the backend speaks a different dialect, and returns the response in the OpenAI format.

Running it between applications and models buys you several things:

- **One integration.** Every application uses the same client library, base URL and request shape, whether the model behind it is a local vLLM server or a hosted API.
- **Names you control.** Clients ask for a name such as `chat-default`. Which model actually answers is a line in the gateway config, so you can swap models without redeploying clients.
- **Keys per application.** Real backend credentials stay on the gateway. Each application gets its own key, which you can limit, expire or block without affecting anyone else.
- **Routing.** Several backends can sit behind one name, with load balancing between them and fallbacks when one fails.
- **One place to look.** Usage, errors and spend are recorded centrally instead of in each application's logs.

The cost is one more service to run and keep patched, and one more hop in the request path. If you have a single model and a single client, you do not need a gateway yet.

| | Clients call backends directly | Clients call a gateway |
| --- | --- | --- |
| Changing a model | Edit and redeploy each client | Edit one config file |
| Backend credentials | Copied into every client | Stored once, on the gateway |
| Revoking one application's access | Rotate the shared key for everyone | Block that application's key |
| Failover | Each client implements it | Configured once |
| Extra moving parts | None | The proxy, and a database for keys |

## Write the config file

The proxy reads a YAML file. Its core is `model_list`: each entry maps a public name (`model_name`) to the details of one backend (`litellm_params`). This file exposes three models: one served by vLLM, one by Ollama and one hosted.

```yaml
# litellm_config.yaml
model_list:
  - model_name: chat-default
    litellm_params:
      model: hosted_vllm/Qwen/Qwen2.5-7B-Instruct
      api_base: http://vllm:8000/v1
      api_key: os.environ/VLLM_API_KEY

  - model_name: chat-small
    litellm_params:
      model: ollama_chat/llama3.1
      api_base: http://ollama:11434

  - model_name: chat-hosted
    litellm_params:
      model: openai/gpt-4o-mini
      api_key: os.environ/OPENAI_API_KEY

general_settings:
  master_key: os.environ/LITELLM_MASTER_KEY
```

How to read it:

- The part of `model` before the first slash is the **provider prefix**. It tells LiteLLM which dialect to speak. `hosted_vllm/` is the prefix for a vLLM server, `ollama_chat/` for Ollama's chat endpoint, and `openai/` for OpenAI itself or any other OpenAI-compatible server.
- The rest of `model` is the name the backend knows. For vLLM that is the name the server was started with, which is the Hugging Face repository name unless you set a served name. See [Serving LLMs in production with vLLM](/blog/vllm-production-deployment/) for how that name is chosen.
- `api_base` is where the backend listens. The host names `vllm` and `ollama` here are container names on a shared Docker network; use whatever address the gateway can reach. If a vLLM backend answers with "not found" errors, check that the base URL ends in `/v1`.
- `os.environ/NAME` tells LiteLLM to read the value from an environment variable, so secrets never sit in the file.
- The LiteLLM documentation recommends `ollama_chat/` over the older `ollama/` prefix, because it uses Ollama's chat endpoint rather than the plain generate endpoint.
- Hosted model identifiers change over time. Use one that your provider currently lists.

`master_key` is the administrator key for the proxy. It must start with `sk-`, it authorises every management call, and it is also the default password for the admin interface. Treat it like a root password: generate it randomly and give it to no application.

## Start the proxy

For a first run you need only the config and a master key. The proxy listens on port 4000.

```bash
export LITELLM_MASTER_KEY="sk-$(openssl rand -hex 32)"
export VLLM_API_KEY="the key your vLLM server expects"
export OPENAI_API_KEY="your provider key"

docker run --rm \
  -v "$PWD/litellm_config.yaml:/app/config.yaml:ro" \
  -e LITELLM_MASTER_KEY -e VLLM_API_KEY -e OPENAI_API_KEY \
  -p 127.0.0.1:4000:4000 \
  ghcr.io/berriai/litellm:main-stable \
  --config /app/config.yaml
```

The config is mounted read-only and the port is published on loopback only. Add `--network` with the name of the Docker network your model servers are on, so the names in `api_base` resolve. Remember that inside a container `localhost` means the container itself, not the host, which is the most common reason a first request fails with a connection error.

Check that the process is up, list the models, and send a request:

```bash
curl -s http://127.0.0.1:4000/health/liveliness

curl -s http://127.0.0.1:4000/v1/models \
  -H "Authorization: Bearer $LITELLM_MASTER_KEY"

curl -s http://127.0.0.1:4000/v1/chat/completions \
  -H "Authorization: Bearer $LITELLM_MASTER_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model": "chat-default", "messages": [{"role": "user", "content": "Say hello."}]}'
```

Clients need no LiteLLM-specific code. Anything that speaks the OpenAI API works once the base URL points at the gateway:

```python
from openai import OpenAI

client = OpenAI(base_url="http://127.0.0.1:4000/v1", api_key="sk-a-key-issued-by-the-gateway")

reply = client.chat.completions.create(
    model="chat-small",
    messages=[{"role": "user", "content": "Summarise what a gateway does in one sentence."}],
)
print(reply.choices[0].message.content)
```

Changing `model` to `chat-hosted` sends the same request to the hosted provider. That is the whole point: the application code does not change.

## Add a database for keys and limits

So far the only credential is the master key, and handing that to applications defeats the purpose. **Virtual keys** are keys the gateway issues itself. They exist only in the gateway, map to rules you define, and never reveal the real backend credentials.

Virtual keys need PostgreSQL. Without a database the proxy still routes requests, but requests that present a virtual key fail, and budgets are not enforced. This Compose file runs the two together:

```yaml
services:
  db:
    image: postgres:16
    restart: unless-stopped
    environment:
      POSTGRES_DB: litellm
      POSTGRES_USER: litellm
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U litellm -d litellm"]
      interval: 5s
      retries: 10

  litellm:
    image: ghcr.io/berriai/litellm:main-stable
    restart: unless-stopped
    depends_on:
      db:
        condition: service_healthy
    ports:
      - "127.0.0.1:4000:4000"
    volumes:
      - ./litellm_config.yaml:/app/config.yaml:ro
    environment:
      DATABASE_URL: postgresql://litellm:${POSTGRES_PASSWORD}@db:5432/litellm
      LITELLM_MASTER_KEY: ${LITELLM_MASTER_KEY}
      LITELLM_SALT_KEY: ${LITELLM_SALT_KEY}
      VLLM_API_KEY: ${VLLM_API_KEY}
      OPENAI_API_KEY: ${OPENAI_API_KEY}
    command: ["--config", "/app/config.yaml"]

volumes:
  pgdata:
```

Create the secrets once and keep the `.env` file out of version control:

```bash
{
  echo "LITELLM_MASTER_KEY=sk-$(openssl rand -hex 32)"
  echo "LITELLM_SALT_KEY=sk-$(openssl rand -hex 32)"
  echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)"
} >> .env
chmod 600 .env
docker compose up -d
```

`LITELLM_SALT_KEY` encrypts provider credentials that you add through the admin interface and store in the database. Set it before adding anything and then leave it alone: it cannot be rotated in place, and changing it makes the stored credentials unreadable until you enter them again. Back it up with the same care as the database.

The database is not published on any host port. Only the proxy needs to reach it, and it does so over the Compose network.

## Issue keys with limits

With the database running, create a key for each application by calling the management API with the master key:

```bash
curl -s http://127.0.0.1:4000/key/generate \
  -H "Authorization: Bearer $LITELLM_MASTER_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "key_alias": "support-bot",
    "models": ["chat-default", "chat-small"],
    "duration": "30d",
    "rpm_limit": 60,
    "tpm_limit": 100000,
    "max_budget": 25
  }'
```

The response contains the new key, which starts with `sk-`. Store it in the application's secret store straight away. The fields decide what the key may do:

| Field | Effect |
| --- | --- |
| `key_alias` | A readable name, so logs and reports show which application made a call |
| `models` | The model names this key may request; anything else is refused |
| `duration` | Lifetime, after which the key stops working |
| `rpm_limit` | Requests per minute |
| `tpm_limit` | Tokens per minute |
| `max_budget` | Spend ceiling in US dollars |

The numbers above are examples to replace with your own. Limiting `models` matters more than it looks: it stops an internal tool that should use the local model from quietly running up a bill on the hosted one.

To see what a key has used, or to cut it off:

```bash
curl -s "http://127.0.0.1:4000/key/info?key=sk-the-application-key" \
  -H "Authorization: Bearer $LITELLM_MASTER_KEY"

curl -s -X POST http://127.0.0.1:4000/key/block \
  -H "Authorization: Bearer $LITELLM_MASTER_KEY" \
  -H "Content-Type: application/json" \
  -d '{"key": "sk-the-application-key"}'
```

Spend is calculated from LiteLLM's table of per-token prices for known hosted models. A self-hosted model has no entry in that table, so its spend reads as zero and a dollar budget will not constrain it. For local backends, rely on the request and token limits instead. The same key management is available in the admin interface served by the proxy under `/ui`.

## Load balancing and fallbacks

Routing rules live in the same config file. There are two separate mechanisms, and they solve different problems.

**Load balancing** spreads traffic across equivalent backends. Give several entries the same `model_name` and the proxy treats them as one group:

```yaml
model_list:
  - model_name: chat-default
    litellm_params:
      model: hosted_vllm/Qwen/Qwen2.5-7B-Instruct
      api_base: http://vllm-a:8000/v1
      api_key: os.environ/VLLM_API_KEY
  - model_name: chat-default
    litellm_params:
      model: hosted_vllm/Qwen/Qwen2.5-7B-Instruct
      api_base: http://vllm-b:8000/v1
      api_key: os.environ/VLLM_API_KEY
  - model_name: chat-hosted
    litellm_params:
      model: openai/gpt-4o-mini
      api_key: os.environ/OPENAI_API_KEY

router_settings:
  routing_strategy: simple-shuffle
  allowed_fails: 3
  cooldown_time: 30
  fallbacks: [{"chat-default": ["chat-hosted"]}]

litellm_settings:
  num_retries: 2
  request_timeout: 120
```

`simple-shuffle` is the default strategy and the one the LiteLLM documentation recommends for production: it picks a deployment at random, weighted by any `rpm` or `tpm` values you set on the entries. Other strategies exist, such as `least-busy` and `latency-based-routing`, but start with the default and change it only when you have measured a reason.

**Fallbacks** handle failure of a whole group. The `fallbacks` line says that when `chat-default` cannot be served, the request should go to `chat-hosted` instead. The surrounding settings control how failure is detected:

- `num_retries` is how many times a request is retried within its own group before the fallback is tried.
- `request_timeout` is how many seconds to wait for a backend before giving up. Set it for your longest legitimate generation, not for a typical one.
- `allowed_fails` and `cooldown_time` take a misbehaving deployment out of rotation: after that many failures it is skipped for the cooldown period, in seconds.

Think before you add a fallback from a self-hosted model to a hosted one. It keeps the service up, but it also sends prompts to a third party that would otherwise have stayed on your own hardware. If the data must not leave your network, fall back to another local model or let the request fail.

To confirm which backend actually answered a request, look at the `x-litellm-model-id` response header.

## Running it for real

A gateway that every application depends on needs the same care as a database.

**Pin the version.** The `main-stable` tag moves. Choose a specific release tag or image digest, test it, and upgrade deliberately. This is not a theoretical concern: in March 2026 the LiteLLM project published a security advisory after two releases on PyPI, 1.82.7 and 1.82.8, were found to contain malicious code and were pulled. A gateway holds every provider credential you own, so pin exact versions, review upgrades, and know how you would rotate every key it holds.

**Use the right health endpoints.** `GET /health/liveliness` reports that the process is running and `GET /health/readiness` that it is ready for traffic, including its database connection. Neither needs a key, and neither calls a model, so they are safe for load balancer probes. `GET /health` is different: it needs a key and, unless background checks are enabled, sends a real test request to every backend each time it is called. Do not point a frequent probe at it.

**Quiet the logs.** Debug logging can write prompts and responses to the log. In production set the `LITELLM_LOG` environment variable to `ERROR` and keep verbose modes off.

**Protect the admin surface.** The master key and the admin interface control everything. Keep port 4000 on a private interface, put TLS in front of it, and expose only what clients need. [Securing a self-hosted LLM API](/blog/secure-self-hosted-llm-api/) covers the proxy, TLS and network side of this.

**Add Redis when you scale out.** One proxy instance keeps its counters in memory. With several instances behind a load balancer, the LiteLLM documentation calls for Redis so that rate limits and cooldowns are shared rather than counted separately per instance.

## Common mistakes

**Using `localhost` in `api_base` from inside a container.** It points at the gateway's own container. Use the backend's container name on a shared network, or an address the container can route to.

**Wrong or missing provider prefix.** `Qwen/Qwen2.5-7B-Instruct` with no prefix is not routable. The prefix must match the backend type, and the remainder must match the name the backend itself reports in its model list.

**Master key without the `sk-` prefix.** Key management expects it. Generate the key in that form from the start.

**Virtual keys with no database.** The proxy starts and answers master-key requests, which makes the setup look healthy, but every virtual key fails. Check that `DATABASE_URL` is set and the readiness endpoint reports the database as connected.

**Losing or changing the salt key.** Stored provider credentials become unreadable. Keep it in your secret store next to the database backups; [Secrets management](/blog/secrets-management-guide/) covers where such values should live.

**Clients sending the backend's model name.** Clients must use `model_name` from the config. Asking for the Hugging Face name returns an error, because the gateway has no group by that name.

**Timeouts on long generations.** If long answers are cut off, the limit may be the gateway's `request_timeout` or a reverse proxy in front of it. Check both.

**Giving applications the master key.** It can create keys, read every key's usage and change configuration. Applications get virtual keys, always.

## Frequently asked questions

### Do I need the database?

Not for routing. A config file and a master key are enough to give clients one endpoint with load balancing and fallbacks. You need PostgreSQL as soon as you want virtual keys, per-key limits, budgets or usage records, which in practice means as soon as more than one application uses the gateway.

### Does streaming work through the gateway?

Yes. A request with `"stream": true` is streamed back to the client as the backend produces tokens. If responses arrive in one block, look at the reverse proxy in front of the gateway: response buffering there is the usual cause.

### Can the gateway serve embeddings as well as chat?

Yes. Add the embedding model to `model_list` like any other entry, and clients call `/v1/embeddings` with its `model_name`. This is useful for retrieval systems, where the embedding model and the chat model can then share keys and limits; [Build a RAG pipeline from scratch](/blog/build-rag-pipeline-from-scratch/) shows where each one is called.

### How much latency does it add?

A proxy hop costs something, but for text generation the time is dominated by the model producing tokens, so the gateway's share is normally small in comparison. Measure it in your own environment by timing the same request against the backend directly and through the gateway; no general figure will match your setup.

### Is LiteLLM the only option?

No. Any reverse proxy can give you one address, and other model gateways exist. LiteLLM's distinguishing features are format translation across many providers and built-in key management. If all your backends already speak the OpenAI format and you need only routing and TLS, a plain reverse proxy may be enough.
