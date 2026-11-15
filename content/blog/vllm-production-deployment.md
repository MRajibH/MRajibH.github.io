---
title: "Serving LLMs in production with vLLM: a practical guide"
description: "Deploy vLLM as an OpenAI-compatible server: Docker setup, the flags that control memory and concurrency, metrics to watch and mistakes to avoid."
date: 2026-11-15
tags: [self-hosted-llms]
art:
  kind: flow
  caption: "vLLM sits between many clients and the GPU and batches their requests."
  items: ["Many clients", "OpenAI-compatible API", "vLLM batching", "GPU"]
---

A model that answers one person at a time on a workstation is a different problem from a model that answers fifty requests at once without falling over. vLLM is an open-source inference server built for the second case: it batches concurrent requests on the GPU and exposes them through an API that follows the OpenAI format. By the end of this guide you will have vLLM running in a container, know which flags decide whether it fits in memory and how many requests it handles, and know what to monitor once real traffic arrives.

The guide assumes a Linux host with an NVIDIA GPU, a working driver, Docker, and the NVIDIA Container Toolkit. If you are still choosing between inference servers, read [Ollama vs llama.cpp vs vLLM](/blog/ollama-vs-llama-cpp-vs-vllm/) first.

## What vLLM does differently

Most local runners process requests one after another, or run a small fixed number of parallel slots. vLLM is designed around **continuous batching**: at every generation step the scheduler looks at all requests in flight and runs them through the model together. A new request joins the running batch at the next step instead of waiting for the others to finish, and a finished request leaves without holding anyone up.

Two more ideas matter for operating it:

- **The KV cache.** While generating, a transformer stores intermediate attention results (keys and values) for every token it has already seen, so it does not recompute them. That cache lives in GPU memory, and its size limits how many tokens of conversation the server can hold across all concurrent requests. vLLM claims a large share of the GPU at startup and manages this cache itself.
- **The OpenAI-compatible server.** vLLM speaks the same HTTP API as OpenAI's service, including `/v1/chat/completions`, `/v1/completions`, `/v1/embeddings` and `/v1/models`. Any client library that lets you change the base URL can talk to it.

The practical consequence is that vLLM behaves like a service, not a desktop tool. It loads one model per process, takes the GPU for itself, and expects you to plan memory up front. It is built around models in the Hugging Face Transformers format (usually safetensors) rather than the GGUF files that llama.cpp and Ollama use; [GGUF quantization explained](/blog/gguf-quantization-explained/) covers that other ecosystem.

## Run the server

The project publishes an official image, `vllm/vllm-openai`, whose entry point is the API server. This command starts it with a 7-billion-parameter instruct model:

```bash
docker run --runtime nvidia --gpus all \
  -v ~/.cache/huggingface:/root/.cache/huggingface \
  --env "HF_TOKEN=$HF_TOKEN" \
  -p 127.0.0.1:8000:8000 \
  --ipc=host \
  vllm/vllm-openai:latest \
  --model Qwen/Qwen2.5-7B-Instruct
```

Each part has a reason:

- `--runtime nvidia --gpus all` gives the container access to the GPUs.
- The volume mount keeps downloaded weights on the host. Without it, every new container downloads the model again.
- `HF_TOKEN` is your Hugging Face access token. It is only needed for gated or private models, but passing it does no harm.
- `-p 127.0.0.1:8000:8000` publishes the default port, 8000, on the loopback interface only. Publishing on all interfaces would put an unprotected API on your network.
- `--ipc=host` lets the container use the host's shared memory. PyTorch passes data between processes through shared memory, and the default allocation inside a container is too small, especially when the model is spread over several GPUs. `--shm-size` with a generous value is the alternative.

Everything after the image name is passed to the server. If you install vLLM with pip instead of Docker, the same options go to the `vllm serve` command, with the model as the first argument.

The first start takes a while: the weights download, load into GPU memory, and the server warms up. When the log shows the application has started, check it:

```bash
curl -s http://127.0.0.1:8000/health -o /dev/null -w "%{http_code}\n"
curl -s http://127.0.0.1:8000/v1/models
```

`/health` returns 200 when the engine is alive. Then send a chat request:

```bash
curl -s http://127.0.0.1:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Qwen/Qwen2.5-7B-Instruct",
    "messages": [{"role": "user", "content": "Explain what a KV cache is in two sentences."}],
    "max_tokens": 120
  }'
```

From Python, the official OpenAI client works unchanged once you point it at the server:

```python
from openai import OpenAI

client = OpenAI(base_url="http://127.0.0.1:8000/v1", api_key="not-needed-yet")

reply = client.chat.completions.create(
    model="Qwen/Qwen2.5-7B-Instruct",
    messages=[{"role": "user", "content": "Give me three uses for a reverse proxy."}],
    max_tokens=200,
)
print(reply.choices[0].message.content)
```

## The flags that decide whether it works

vLLM has a long option list, but a handful of flags account for most production behaviour. This table lists the ones worth understanding before the first deployment.

| Flag | What it controls | Why you would change it |
| --- | --- | --- |
| `--served-model-name` | The model name clients send in requests | Gives clients a stable alias, so you can swap the underlying model without changing them |
| `--max-model-len` | Maximum context length in tokens (prompt plus output) | Lowering it lets a model start on a GPU that cannot hold the full context |
| `--gpu-memory-utilization` | Fraction of GPU memory the process may claim | Lower it when something else must share the GPU |
| `--max-num-seqs` | Maximum sequences processed in one scheduler step | Caps concurrency so each request keeps acceptable speed |
| `--tensor-parallel-size` | Number of GPUs each layer is split across | Needed when the model does not fit on one GPU |
| `--dtype` | Numeric type for weights and activations | Rarely changed; `auto` picks the type from the model |
| `--api-key` | A bearer token required on the OpenAI-style routes | A first barrier; not sufficient alone (see below) |
| `--chat-template` | Path to a Jinja chat template | Required when the model's tokenizer does not include one |
| `--generation-config` | Where default sampling settings come from | Set to `vllm` to ignore the model repository's defaults |

### Memory: context length and the GPU fraction

At startup vLLM loads the weights and then reserves the rest of its memory budget for the KV cache. The budget is set by `--gpu-memory-utilization`, a fraction between 0 and 1. The documented default is high (0.92, or 1.0 in some configurations on current releases), which is right for a dedicated GPU and wrong for a shared one.

This is why `nvidia-smi` shows the GPU nearly full the moment vLLM starts, regardless of traffic. That is by design. The memory is the pool that concurrent requests draw from.

If the server refuses to start because the model's full context does not fit in the KV cache, reduce `--max-model-len`. A model that advertises a very long context rarely needs all of it for a chat or retrieval workload, and a smaller limit leaves room for more simultaneous requests. Requests longer than the limit are rejected with an error, so pick a value that covers your longest real prompt plus the longest answer you allow.

### Concurrency

`--max-num-seqs` caps how many sequences are processed in one step. More concurrent sequences raise total throughput but share the same GPU, so each individual request generates more slowly, and all of them draw on the same KV cache. When the cache runs out, vLLM preempts some requests and recomputes them later, which shows up as latency spikes and a warning in the log. The documented remedies are to give the process more memory, lower `--max-num-seqs`, or add GPUs.

### More than one GPU

There are two different reasons to use several GPUs, and they need different setups:

| Goal | Approach | How |
| --- | --- | --- |
| The model is too large for one GPU | Tensor parallelism: split each layer across GPUs | `--tensor-parallel-size 2` (or 4, 8) |
| The model fits, but you need more throughput | Replicas: one full copy per GPU | One vLLM process per GPU behind a load balancer |

Tensor parallelism adds synchronisation overhead between GPUs, so it is the tool for fitting a large model, not the cheapest way to add capacity. For capacity, independent replicas pinned to one GPU each with `CUDA_VISIBLE_DEVICES`, behind a gateway such as [LiteLLM](/blog/litellm-gateway-self-hosted/), are simpler to reason about and fail independently.

### Sampling defaults and chat templates

Two behaviours surprise people coming from other servers. First, vLLM reads `generation_config.json` from the model repository by default and uses it for default sampling settings such as temperature. If you want the server's own defaults regardless of what the model author shipped, start with `--generation-config vllm`.

Second, chat requests depend on a chat template, the Jinja snippet that turns a list of messages into the exact prompt format the model was trained on. Most instruct models ship one in their tokenizer configuration. If a model has none, chat requests fail until you supply a template with `--chat-template`.

## A repeatable deployment with Compose

A long `docker run` line is fine for a test, but production configuration belongs in a file under version control. This Compose file pins the image tag, sets the important flags explicitly, and restarts the server if it exits.

```yaml
services:
  vllm:
    image: vllm/vllm-openai:latest   # replace with a specific release tag
    restart: unless-stopped
    ipc: host
    ports:
      - "127.0.0.1:8000:8000"
    volumes:
      - hf-cache:/root/.cache/huggingface
    environment:
      HF_TOKEN: ${HF_TOKEN}
      VLLM_API_KEY: ${VLLM_API_KEY}
    command:
      - --model
      - Qwen/Qwen2.5-7B-Instruct
      - --served-model-name
      - chat-default
      - --max-model-len
      - "16384"
      - --max-num-seqs
      - "32"
      - --gpu-memory-utilization
      - "0.90"
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: all
              capabilities: [gpu]

volumes:
  hf-cache:
```

The numbers for context length and concurrency are starting points to adjust against your own hardware and prompts, not recommendations. Three choices in the file deserve a comment:

- **Pin the image.** `latest` changes under you. vLLM releases often, and flags and defaults do change between releases, so choose a release tag from the project's Docker Hub page, test it, and upgrade on purpose.
- **Use a served name.** Clients ask for `chat-default`. When you move to a different model, clients do not need a new release.
- **Keep secrets out of the file.** `HF_TOKEN` and `VLLM_API_KEY` come from the environment or an `.env` file that is not committed. `VLLM_API_KEY` has the same effect as the `--api-key` flag without putting the key on a command line that other users on the host can read. [Secrets management](/blog/secrets-management-guide/) covers better stores than an `.env` file.

Start it and follow the log until the server reports it is ready:

```bash
docker compose up -d
docker compose logs -f vllm
```

Model loading can take minutes for large models. If an orchestrator or load balancer checks `/health`, give it a start-up grace period long enough to cover the load, or it will restart the container in a loop before the model is ever ready.

## Tool calling and structured clients

Agent frameworks send a `tools` list and expect the model to answer with a structured tool call. vLLM supports this, but it is off until you enable it, because each model family formats tool calls differently and the server needs the matching parser:

```bash
vllm serve Qwen/Qwen2.5-7B-Instruct \
  --enable-auto-tool-choice \
  --tool-call-parser hermes
```

`--enable-auto-tool-choice` lets the model decide when to call a tool, and `--tool-call-parser` names the parser that converts the model's raw output into the OpenAI tool-call structure. Parsers exist for several families, including `hermes`, `llama3_json` and `mistral`; the right one for your model is listed in the [tool calling documentation](https://docs.vllm.ai/en/latest/features/tool_calling.html). Without these flags, a request that sets `tool_choice` to a named function or to `required` is rejected with a 400 error. [Build an AI agent with tool calling](/blog/build-ai-agent-with-tool-calling/) shows the client side of this exchange.

## What to monitor

vLLM exposes Prometheus metrics at `/metrics` on the same port as the API. Prometheus is a monitoring system that scrapes numeric time series over HTTP. A minimal scrape job looks like this:

```yaml
scrape_configs:
  - job_name: vllm
    scrape_interval: 15s
    static_configs:
      - targets: ["127.0.0.1:8000"]
```

There are dozens of series. These are the ones that tell you whether users are having a good time:

| Metric | What it tells you |
| --- | --- |
| `vllm:num_requests_running` | Requests currently being generated |
| `vllm:num_requests_waiting` | Requests queued because the engine is at capacity |
| `vllm:kv_cache_usage_perc` | How full the KV cache is |
| `vllm:time_to_first_token_seconds` | Delay before the first token arrives (a histogram) |
| `vllm:inter_token_latency_seconds` | Gap between streamed tokens, which is the speed users feel |
| `vllm:e2e_request_latency_seconds` | Total time per request |
| `vllm:num_preemptions` | Requests paused and recomputed because the cache ran out |

Read them together. A waiting queue that stays above zero means the server is saturated: add a replica or reduce what each request asks for. KV cache usage near its maximum together with a growing preemption count means concurrency or context length is too high for the memory available. Rising time to first token with a flat inter-token latency usually points at queueing or long prompts, not slow generation.

Metric names have changed between releases, so check the [metrics page](https://docs.vllm.ai/en/latest/usage/metrics.html) for the version you run before building dashboards and alerts.

## Lock it down before exposing it

The `--api-key` option is useful, but read what it covers. According to vLLM's own security documentation, the key is enforced only on the OpenAI-style route prefixes such as `/v1`. Other routes, including `/health`, `/metrics`, `/tokenize` and several operational endpoints, stay open, and the documentation says plainly not to rely on the key alone in production.

The recommended design is to keep vLLM on a private interface and put a reverse proxy in front that forwards only the routes clients need, terminates TLS, authenticates callers and applies rate limits. The full setup is in [Securing a self-hosted LLM API](/blog/secure-self-hosted-llm-api/). Two vLLM-specific points belong here:

- Do not enable `--trust-remote-code` unless you have read the code in the model repository. It allows the repository's Python code to run on your server.
- If you serve multimodal models that fetch images from URLs, restrict where the server may fetch from with `--allowed-media-domains`, so that a request cannot make your server call internal addresses.

## Common mistakes

**Out of memory at startup.** Either another process holds GPU memory, or the model plus its minimum KV cache does not fit. Check `nvidia-smi` for other processes, then lower `--max-model-len`. If the weights alone are larger than the GPU, you need a smaller or quantized model, or tensor parallelism across more GPUs.

**Treating full GPU memory as a leak.** vLLM reserves its budget up front. Constant high memory use is normal and says nothing about load. Watch `vllm:kv_cache_usage_perc` instead.

**Shared memory errors in Docker.** Crashes that mention shared memory or bus errors, particularly with several GPUs, mean `--ipc=host` or a larger `--shm-size` is missing.

**Restart loops during model load.** A health check that starts counting failures immediately will kill a server that is still loading weights. Add a start-up delay.

**Model name mismatch.** A 404 saying the model does not exist usually means the client sent the Hugging Face name while the server was started with `--served-model-name`, or the reverse. `GET /v1/models` shows the name the server expects.

**Different answers than another server gave.** Check sampling defaults first. The model's `generation_config.json` may be setting temperature or other values. Pass the parameters explicitly in the request, or start with `--generation-config vllm`.

**Expecting GGUF files to behave as they do in Ollama.** vLLM is built around Transformers-format weights, and GGUF is not its main path. If you need quantized weights, prefer a repository published in a quantization format the vLLM documentation lists as supported for your version, and test it before relying on it.

**Publishing port 8000 on all interfaces.** `-p 8000:8000` binds to every interface, and Docker's published ports can bypass host firewall rules. Bind to `127.0.0.1` and expose the service through the proxy.

## Frequently asked questions

### Can one vLLM server host several models?

No. One vLLM process serves one base model, optionally with LoRA adapters on top of it. To offer several models, run one process per model, each on its own port and GPU allocation, and put a gateway in front that routes by model name.

### Does vLLM work without a GPU?

It is designed for GPUs, and that is where its batching pays off. CPU backends exist but are not the main target. For CPU-only or small single-user setups, llama.cpp or [Ollama](/blog/run-llm-locally-with-ollama/) is the more practical choice.

### How much GPU memory do I need?

Enough for the weights plus a useful KV cache. As a rough rule of thumb, weights at 16-bit precision take about two bytes per parameter, so a 7-billion-parameter model needs roughly 14 GB before any cache. The cache then needs more for every concurrent request and every token of context. [Hardware for local LLMs](/blog/hardware-for-local-llms/) goes through sizing in more detail.

### How do I update the model without downtime?

Start a second vLLM instance with the new model on another port, wait for `/health` to return 200, send it a test request, then switch the proxy or gateway to the new upstream and stop the old one. Using `--served-model-name` means clients never see the change. This needs enough GPU memory for both copies at once, or a second machine.

### Should I use streaming?

For anything a person reads, yes. Set `"stream": true` in the request and tokens arrive as they are generated, so the user sees text after the time to first token instead of after the whole answer. Make sure any proxy in front has response buffering disabled, or the stream arrives as one block at the end.
