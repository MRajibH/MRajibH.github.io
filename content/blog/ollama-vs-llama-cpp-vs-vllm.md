---
title: "Ollama vs llama.cpp vs vLLM: which should you self-host with?"
description: "A practical comparison of Ollama, llama.cpp and vLLM: how each loads models, uses memory and handles concurrency, with commands to try all three."
date: 2026-11-15
tags: [self-hosted-llms]
draft: true
---

Three names come up whenever someone decides to run a language model on their own hardware: Ollama, llama.cpp and vLLM. They overlap enough to be confusing and differ enough that picking the wrong one costs real time. This article explains what each one is built for, shows the commands to start each, and gives you a way to decide based on your hardware and your number of users rather than on popularity.

All three expose an OpenAI-compatible HTTP API, so the application code that talks to them barely changes. The differences are in what sits behind that API.

## The short answer

| | Ollama | llama.cpp | vLLM |
| --- | --- | --- | --- |
| Best at | Getting started, single-user and small-team use | Control, portability, modest hardware | Many concurrent requests on GPUs |
| Model format | GGUF, pulled by name from a registry | GGUF files | Hugging Face repositories (safetensors) |
| Runs without a GPU | Yes | Yes | Not its purpose; built for GPUs |
| Model larger than VRAM | Splits between GPU and CPU automatically | Splits between GPU and CPU, tunable | Expects the model to fit on the GPUs |
| Several models on one server | Yes, loads and unloads on demand | Yes, with router mode | One model per server process |
| Authentication built in | No | Optional API key | Optional API key |
| Default API address | `127.0.0.1:11434` | `127.0.0.1`, port set with `--port` | `localhost:8000` |
| Setup effort | Lowest | Low to medium | Medium |

If you want one sentence: use Ollama to get a model running today, use llama.cpp when you want to control exactly how it runs or have unusual hardware, and use vLLM when a GPU server has to answer many requests at once.

The rest of the article explains why.

## Two engines, three tools

It helps to see that there are really two inference engines here, not three.

**llama.cpp** is a C/C++ inference engine with no heavyweight dependencies. It runs models stored in GGUF, a single-file format that holds quantized weights. Quantization means storing weights with fewer bits, which is what lets a model that needs tens of gigabytes at full precision fit on a consumer graphics card. See [GGUF and quantization explained](/blog/gguf-quantization-explained/) for the details. llama.cpp supports a long list of backends: CUDA for NVIDIA, Metal for Apple Silicon, Vulkan, HIP for AMD, SYCL for Intel, and plain CPU.

**Ollama** grew out of that ecosystem. It runs the same GGUF models and adds a model registry, a background service that manages loading and unloading, and a simple CLI. You can think of it as a managed, opinionated way to run this class of model.

**vLLM** is a different engine entirely. It is a Python and PyTorch-based serving system designed for throughput on GPUs. It loads models in their original Hugging Face format and is built around serving many requests simultaneously.

So the practical choice is first between two families: the GGUF family (Ollama and llama.cpp), which is flexible about hardware, and vLLM, which assumes capable GPUs and rewards you with throughput.

## How each one handles memory

Memory behaviour is the most important practical difference, and it explains most of the surprises people hit.

### Ollama and llama.cpp: fit what you can

Both GGUF-based tools can place some of a model's layers on the GPU and leave the rest on the CPU. If a model needs more VRAM than you have, it still runs, only slower, because the CPU layers become the bottleneck. This makes them forgiving on small GPUs and usable on machines with no GPU at all.

In llama.cpp the number of layers sent to the GPU is the `-ngl` (`--n-gpu-layers`) option. Current builds default it to `auto` and also enable a `--fit` behaviour that adjusts unset options to fit the device's memory. Ollama makes the same decision for you and reports the outcome in the `PROCESSOR` column of `ollama ps`.

Memory use is on demand. A model takes VRAM when it loads and gives it back when it unloads, which suits a workstation where the GPU is shared with other work.

### vLLM: claim the GPU up front

vLLM takes the opposite approach. When the server starts, it reserves most of the GPU's memory, loads the weights, and gives everything left over to the KV cache, the per-request memory that stores the model's working state for each token in context. The `--gpu-memory-utilization` option sets the fraction it may claim.

This surprises people who see a small model occupying nearly an entire card in `nvidia-smi`. It is deliberate: a large pre-allocated cache is what lets vLLM hold many conversations in memory at once. The consequence is that vLLM wants a GPU, or several, dedicated to it. It has a `--cpu-offload-gb` option, but its design assumes the model fits on the GPUs you give it.

vLLM can also spread a model across several GPUs with `--tensor-parallel-size`, which is the usual way to serve a model too large for one card.

## Concurrency: where vLLM pulls ahead

A single user chatting with a model generates one sequence at a time. A service used by a team or an application generates many. How the engine handles that is the second major difference.

vLLM is built on continuous batching: requests that arrive at different times are merged into the same GPU batch and each one leaves as soon as it finishes, instead of waiting for a fixed batch to fill. Because a GPU can process many sequences in one pass at little extra cost per sequence, total throughput under load rises far above what one-at-a-time processing achieves. This is the reason to choose vLLM, and it only pays off when there is real concurrent load.

llama.cpp's server also supports parallel requests. It divides work into slots, set with `-np` (`--parallel`), and has continuous batching enabled by default. It handles a handful of simultaneous users well. It is not designed to compete with vLLM at high request rates on large GPUs.

Ollama queues incoming requests and processes them according to `OLLAMA_NUM_PARALLEL`, which defaults to one request at a time per model. Raising it works, but each parallel slot needs its own context memory.

No specific throughput numbers are given here, because they depend heavily on the model, the GPU, the prompt lengths and the version of each tool. If the decision hinges on throughput, measure with your own model and a realistic request mix. A fair test sends concurrent requests, not one after another, because sequential tests hide exactly the difference you are trying to see.

## Starting each one

### Ollama

```bash
curl -fsSL https://ollama.com/install.sh | sh
ollama run llama3.2
```

The installer registers a system service, and the API is immediately available at `http://localhost:11434`, with the OpenAI-compatible routes under `/v1`. A full walkthrough, including service configuration, is in [How to run an LLM locally with Ollama](/blog/run-llm-locally-with-ollama/).

### llama.cpp

The project publishes prebuilt binaries and container images, and can be built from source with CMake. The server program is `llama-server`. This example uses the official container image and a GGUF file you have already downloaded into `./models`:

```bash
docker run -p 127.0.0.1:8080:8080 -v "$PWD/models:/models" \
  ghcr.io/ggml-org/llama.cpp:server \
  -m /models/model-q4_k_m.gguf \
  --host 0.0.0.0 --port 8080 \
  -c 8192
```

With a locally installed binary you can let it download a model from Hugging Face by repository name. The part after the colon selects the quantization, and defaults to `Q4_K_M` when omitted:

```bash
llama-server -hf bartowski/Llama-3.2-3B-Instruct-GGUF:Q4_K_M \
  --port 8080 -c 8192 -ngl all --api-key "$LLAMA_API_KEY"
```

A few notes on those options:

- `--port` is given explicitly on purpose. The default port has changed between releases, so stating it keeps scripts and reverse proxy configurations stable.
- `-c` sets the context size in tokens. Left unset, the server takes the value from the model file, which can be very large and memory-hungry.
- `-ngl all` asks for every layer on the GPU. For NVIDIA cards use a CUDA build or the `server-cuda` image with `--gpus all`.
- `--api-key` makes the server require a bearer token. It is a single shared secret, not user management, but it is more than Ollama offers.

Recent releases also ship a unified `llama` command, where the same server is started as `llama serve`. The options are the same. The server includes a built-in web chat page and a Prometheus-format `/metrics` endpoint when started with `--metrics`. The full option list lives in the [server README](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md).

### vLLM

vLLM runs on Linux and installs as a Python package. The project recommends `uv` for managing the environment:

```bash
uv venv --python 3.12 --seed
source .venv/bin/activate
uv pip install vllm --torch-backend=auto

vllm serve Qwen/Qwen2.5-1.5B-Instruct --api-key "$VLLM_API_KEY"
```

Or with the official container image:

```bash
docker run --runtime nvidia --gpus all \
  -v ~/.cache/huggingface:/root/.cache/huggingface \
  -p 127.0.0.1:8000:8000 \
  --ipc=host \
  vllm/vllm-openai:latest \
  --model Qwen/Qwen2.5-1.5B-Instruct
```

The `--ipc=host` flag gives the container access to the host's shared memory, which PyTorch uses to pass data between processes. The cache mount stops the model being downloaded again on every start. Gated models on Hugging Face also need an access token passed in the `HF_TOKEN` environment variable.

The server listens on port 8000. Test any of the three with the same request, changing only the port and the model name:

```bash
curl http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $VLLM_API_KEY" \
  -d '{
    "model": "Qwen/Qwen2.5-1.5B-Instruct",
    "messages": [{"role": "user", "content": "Reply with the word ready."}]
  }'
```

Production concerns for vLLM, such as sizing, health checks and multi-GPU layouts, are covered in [vLLM production deployment](/blog/vllm-production-deployment/).

## Model formats and quantization support

The format each tool expects affects which models you can run and how much memory they need.

Ollama and llama.cpp use GGUF. Nearly every popular open model is available as GGUF in a range of quantization levels, either from the Ollama library or from community repositories on Hugging Face. Ollama can run those repositories directly with `ollama run hf.co/<user>/<repository>`. The wide choice of quantization levels is what makes this family practical on 8 to 24 GB graphics cards.

vLLM loads the original model repository. Run that way, a model uses 16-bit weights and needs roughly two bytes of VRAM per parameter before any cache, which is several times more than a 4-bit GGUF. vLLM does support quantized models, in formats aimed at GPU serving such as AWQ, GPTQ and FP8 rather than GGUF; the supported list is in its [quantization documentation](https://docs.vllm.ai/en/latest/features/quantization/index.html). GGUF loading exists in vLLM only as an experimental plugin that the project itself describes as under-optimized, so do not plan a deployment around it.

The practical effect: on a single 12 or 16 GB card, the GGUF tools let you run a larger model than vLLM will. On a server with 48 GB or more of VRAM, that constraint relaxes and vLLM's throughput becomes the more valuable property.

## Choosing for your situation

**A laptop or desktop, one user.** Use Ollama. Model management is handled for you and memory is released when you stop using it. Add a chat front end with [Open WebUI](/blog/open-webui-self-hosted-chatgpt/) if you want one.

**A CPU-only server, an older GPU, or a non-NVIDIA accelerator.** Use Ollama or llama.cpp. Both run on CPU and support a broad set of backends. Choose llama.cpp if you want to pick the exact build and flags.

**A small team sharing one GPU, a few requests at a time.** Ollama or llama.cpp's server are both adequate. llama.cpp gives you an API key, metrics and explicit slot control. Ollama gives you easier model switching.

**An application with many concurrent users on dedicated GPUs.** Use vLLM. This is the case it was designed for, and the difference grows with load.

**Embedding inference inside your own program.** llama.cpp is a library as well as a server, with bindings for many languages. Neither of the others is meant to be linked into an application.

You do not have to commit to one. Because all three speak the OpenAI API, a common pattern is to develop against Ollama on a workstation and deploy on vLLM, with a gateway in front that hides the difference. [A self-hosted LiteLLM gateway](/blog/litellm-gateway-self-hosted/) describes that arrangement.

## Common mistakes

**Benchmarking with one request at a time.** This measures single-stream speed, where the three tools are far closer than they are under load. It will make vLLM look pointless and tell you nothing about a multi-user service.

**Expecting vLLM to share a GPU politely.** It reserves most of the card at startup. Running a desktop session, another model server or a training job on the same GPU leads to out-of-memory errors. Lower `--gpu-memory-utilization` if you must share, and expect less capacity.

**Comparing different quantizations.** A 4-bit GGUF in Ollama and a 16-bit model in vLLM are not the same model in terms of memory, speed or output quality. Decide what you are comparing before drawing conclusions.

**Leaving the context size at its default.** Ollama's default window is small on most hardware, while llama.cpp and vLLM default to the model's maximum, which can be far more memory than you intended. Set it explicitly in all three: `num_ctx` or `OLLAMA_CONTEXT_LENGTH`, `-c`, and `--max-model-len` respectively.

**Exposing the port to the network.** Ollama has no authentication at all, and the single API key in the other two is a thin layer. Bind to localhost and put a reverse proxy with TLS and proper access control in front, as described in [Securing a self-hosted LLM API](/blog/secure-self-hosted-llm-api/).

**Using a model name the server does not know.** Ollama expects its own tags such as `llama3.2`, vLLM expects the Hugging Face repository name unless you set `--served-model-name`, and llama.cpp reports its own name at `/v1/models`. When a request fails with a model-not-found error, list the models first.

## Frequently asked questions

### Is Ollama just a wrapper around llama.cpp?

It started from the same foundations and runs the same GGUF model format, but it adds its own server, model registry, packaging format and scheduling of loaded models. For a user the important point is that a model and quantization level that work in one generally behave similarly in the other.

### Can vLLM run on a CPU or a Mac?

vLLM is designed for Linux servers with GPUs, primarily NVIDIA, with builds for some other accelerators. For CPU-only machines and Apple laptops, Ollama or llama.cpp are the natural choices.

### Which is fastest for a single user?

For one request at a time on the same model at the same precision, the differences are modest and depend on hardware. The large gap appears with many simultaneous requests, where vLLM's batching gives it much higher total throughput.

### Can I run the same model file in Ollama and llama.cpp?

Yes, if it is a GGUF file. llama.cpp loads it directly with `-m`. Ollama can import it with a Modelfile containing a `FROM /path/to/file.gguf` line followed by `ollama create`.

### Do I need Docker for any of these?

No. Ollama installs as a system service, llama.cpp is a set of standalone binaries, and vLLM is a Python package. Containers are a convenience, mainly for keeping GPU library versions consistent on servers.
