---
title: "How to run an LLM locally with Ollama: a complete setup guide"
description: "Install Ollama on Linux, pull a model, call its API, tune context length and memory, run it as a hardened service and fix the usual problems."
date: 2026-11-15
tags: [self-hosted-llms]
draft: true
---

Sending prompts to a hosted API is easy until the data is private, the bill grows, or the network is not available. Ollama is the shortest path to running a large language model (LLM) on your own machine: one install command, one command to download a model, and a local HTTP API that your scripts can call. By the end of this guide you will have Ollama running as a service on Linux, a model answering over the API, and a clear idea of which settings matter and why.

The commands target Linux with systemd, because that is where Ollama usually ends up running as a server. macOS and Windows use a desktop installer, but the CLI and API behave the same way.

## What Ollama is and what it does for you

Ollama is a model runner. It wraps an inference engine (the code that turns model weights into text) in three things that make it convenient:

- **A background server** that loads models into memory on demand and unloads them when idle.
- **A model registry client**, so `ollama pull` fetches a model by name the way `docker pull` fetches an image.
- **An HTTP API** on port 11434, including an OpenAI-compatible endpoint, so existing client libraries work with a changed base URL.

Models are distributed as quantized files. Quantization stores each weight with fewer bits so that a model fits in ordinary amounts of memory; the trade-offs are covered in [GGUF and quantization explained](/blog/gguf-quantization-explained/). For now it is enough to know that the default tag of a model in the Ollama library is already a sensible 4-bit build.

What Ollama does not give you is authentication, rate limiting or TLS. It is designed to listen on localhost and trust whoever can reach it. Keep that in mind when you get to the networking section.

## Install Ollama and run a first model

The official installer is a shell script. It installs the binary, creates an `ollama` system user, and registers a systemd service:

```bash
curl -fsSL https://ollama.com/install.sh | sh
```

Piping a script into a shell means trusting the source. If you would rather read it first, download it to a file, inspect it, then run it. The [Linux install page](https://docs.ollama.com/linux) also documents a manual install from a tarball.

Check that the service is up and the CLI can reach it:

```bash
systemctl status ollama --no-pager
ollama -v
```

Now download and start a small model. `llama3.2` is a 3-billion-parameter model of about 2 GB, which runs on almost any recent machine, including CPU-only ones:

```bash
ollama run llama3.2
```

The first run downloads the weights, then drops you into an interactive prompt. Type a question, read the answer, and leave with `/bye`. You can also pass a prompt directly, which is handy in scripts:

```bash
ollama run llama3.2 "Explain what a systemd unit file is in two sentences."
```

The commands you will use every day are few:

| Command | What it does |
| --- | --- |
| `ollama pull <model>` | Download or update a model without starting it |
| `ollama run <model>` | Load a model and chat with it, or answer a one-off prompt |
| `ollama ls` | List models stored on disk |
| `ollama ps` | Show models currently loaded in memory, and whether they are on GPU or CPU |
| `ollama stop <model>` | Unload a model from memory now |
| `ollama rm <model>` | Delete a model from disk |
| `ollama show <model>` | Print a model's details: parameters, context length, quantization, template |

`ollama ps` is the one to remember. Its `PROCESSOR` column tells you whether the model sits fully on the GPU, fully on the CPU, or is split between the two. A split means the model did not fit in video memory (VRAM), and generation will be noticeably slower than a full GPU load. If you are choosing hardware or wondering why a model is slow, [Hardware for local LLMs](/blog/hardware-for-local-llms/) explains how to size it.

## Call the local API

The server listens on `127.0.0.1:11434`. The native chat endpoint is `/api/chat`:

```bash
curl http://localhost:11434/api/chat -d '{
  "model": "llama3.2",
  "messages": [
    {"role": "user", "content": "Name three uses for a reverse proxy."}
  ],
  "stream": false
}'
```

Two details matter here. First, streaming is on by default: without `"stream": false` the response arrives as a sequence of JSON objects, one per line, which is what you want for a chat interface but not for a quick script. Second, the final response object includes timing fields such as `eval_count` (tokens generated) and `eval_duration` (in nanoseconds). Dividing one by the other gives you a tokens-per-second figure for your own hardware, which is more trustworthy than any published benchmark.

Per-request settings go in an `options` object:

```bash
curl http://localhost:11434/api/chat -d '{
  "model": "llama3.2",
  "messages": [{"role": "user", "content": "Write a haiku about log rotation."}],
  "stream": false,
  "options": {"temperature": 0.2, "num_ctx": 8192}
}'
```

### The OpenAI-compatible endpoint

Most tools and libraries already speak the OpenAI API. Ollama serves a compatible version under `/v1`, so you can reuse them by changing the base URL. The API key is required by the client library but ignored by Ollama:

```python
from openai import OpenAI

client = OpenAI(base_url="http://localhost:11434/v1/", api_key="unused")

reply = client.chat.completions.create(
    model="llama3.2",
    messages=[{"role": "user", "content": "Summarise what a cron job is."}],
)
print(reply.choices[0].message.content)
```

The compatible API covers chat completions, completions, embeddings and model listing. Not every OpenAI feature is implemented, so check the [compatibility page](https://docs.ollama.com/api/openai-compatibility) before relying on a less common parameter. One known gap is context size: the OpenAI request format has no field for it, so you set it on the server or bake it into a model, as shown below.

## Set the context length deliberately

The context window is the number of tokens (word pieces) the model can consider at once: system prompt, conversation history, any documents you paste in, and the reply. It is the setting most likely to cause confusing behaviour, for two reasons.

First, Ollama's default is conservative. According to the [context length documentation](https://docs.ollama.com/context-length), the default depends on how much VRAM is detected, and on machines with less than 24 GiB it is about 4,000 tokens, even if the model itself supports far more. Second, when a prompt exceeds the window, the oldest content is dropped rather than an error being raised. The model then answers as if it never saw your instructions, because it did not.

A larger window is not free. The memory needed for the context grows with its size, so doubling the window can push a model that fitted on the GPU partly onto the CPU. Raise it to what the task needs, then confirm the result with `ollama ps`, which has a `CONTEXT` column.

There are three places to set it:

```bash
# 1. For the whole server (see the systemd section for a permanent version)
OLLAMA_CONTEXT_LENGTH=16384 ollama serve

# 2. Inside an interactive session
/set parameter num_ctx 16384

# 3. Per request, in the API "options" object
#    "options": {"num_ctx": 16384}
```

For clients that use the OpenAI-compatible endpoint, or when you want a named preset, create a derived model with a Modelfile. A Modelfile is a small recipe, similar in spirit to a Dockerfile:

```dockerfile
FROM llama3.2
PARAMETER num_ctx 16384
PARAMETER temperature 0.3
SYSTEM You are a concise assistant for Linux administrators. Answer with commands and short explanations.
```

Build and run it:

```bash
ollama create sysadmin-helper -f Modelfile
ollama run sysadmin-helper
```

The new model shares the weights of its base, so it costs almost no extra disk space. To see how an existing model is defined, run `ollama show --modelfile llama3.2`.

## Configure the service with systemd

On Linux the server runs as a systemd unit, so environment variables set in your shell do not reach it. Put them in a drop-in override instead:

```bash
sudo systemctl edit ollama
```

That opens an editor on `/etc/systemd/system/ollama.service.d/override.conf`. A reasonable starting point:

```ini
[Service]
Environment="OLLAMA_CONTEXT_LENGTH=8192"
Environment="OLLAMA_KEEP_ALIVE=30m"
Environment="OLLAMA_MODELS=/srv/ollama/models"
```

Then apply it:

```bash
sudo systemctl daemon-reload
sudo systemctl restart ollama
```

The variables worth knowing, with defaults taken from the [Ollama FAQ](https://docs.ollama.com/faq):

| Variable | Default | Why you might change it |
| --- | --- | --- |
| `OLLAMA_HOST` | `127.0.0.1:11434` | Listen on another address or port |
| `OLLAMA_MODELS` | `/usr/share/ollama/.ollama/models` on Linux | Store models on a larger disk |
| `OLLAMA_KEEP_ALIVE` | 5 minutes | Keep models loaded longer to avoid reload delays |
| `OLLAMA_CONTEXT_LENGTH` | Depends on detected VRAM | Set a server-wide context window |
| `OLLAMA_NUM_PARALLEL` | 1 | Serve several requests to one model at once |
| `OLLAMA_MAX_LOADED_MODELS` | 3 per GPU, or 3 on CPU | Limit how many models stay in memory |
| `OLLAMA_MAX_QUEUE` | 512 | Cap queued requests before the server rejects new ones |

Some reasoning behind the common changes:

- **Model directory.** Models are large, and the root partition often is not. If you move `OLLAMA_MODELS`, the `ollama` user must own the new directory: `sudo chown -R ollama:ollama /srv/ollama/models`.
- **Keep-alive.** A model is unloaded after five idle minutes, and the next request pays the load time again. A longer keep-alive suits a machine dedicated to inference. A shorter one suits a desktop where the GPU is also used for other work.
- **Parallel requests.** Each parallel slot needs its own share of context memory, so raising `OLLAMA_NUM_PARALLEL` multiplies the context cost. Raise it only when you have real concurrent users and spare VRAM.

### Exposing Ollama to other machines

To reach the server from another host, change the bind address:

```ini
[Service]
Environment="OLLAMA_HOST=0.0.0.0:11434"
```

Do this only on a network you control. With no authentication, anyone who can connect can run prompts, pull models and delete them. Restrict the port with a firewall to the hosts that need it, or keep Ollama on localhost and put an authenticating reverse proxy in front. [Securing a self-hosted LLM API](/blog/secure-self-hosted-llm-api/) walks through that setup.

## GPU support and running in Docker

Ollama uses a GPU automatically when it finds a supported one. On NVIDIA hardware that means a working driver; confirm it with `nvidia-smi` before blaming Ollama. The [GPU documentation](https://docs.ollama.com/gpu) lists the minimum driver versions and the supported AMD cards, which use ROCm, AMD's compute stack. Apple Silicon is accelerated through Metal without any setup.

After loading a model, check where it went:

```bash
ollama run llama3.2 "hello" && ollama ps
```

If the processor column says `100% GPU`, you are done. If it says `100% CPU` on a machine with a GPU, read the service log for the reason:

```bash
journalctl -e -u ollama
```

To run Ollama in a container instead of installing it on the host, use the official image. The named volume keeps downloaded models across container restarts:

```bash
# CPU only
docker run -d -v ollama:/root/.ollama -p 127.0.0.1:11434:11434 --name ollama ollama/ollama

# NVIDIA GPU (requires the NVIDIA Container Toolkit on the host)
docker run -d --gpus=all -v ollama:/root/.ollama -p 127.0.0.1:11434:11434 --name ollama ollama/ollama

# Run a model inside the container
docker exec -it ollama ollama run llama3.2
```

Publishing the port as `127.0.0.1:11434:11434` rather than `11434:11434` matters. Docker's default is to publish on all interfaces, and its firewall rules can bypass a host firewall you thought was protecting the port.

## Common mistakes and troubleshooting

**The model forgets instructions or ignores a long document.** The prompt is larger than the context window and the start was cut off. Increase `num_ctx` and check the `CONTEXT` column in `ollama ps`.

**Environment variables have no effect.** They were exported in a shell, but the server is a systemd service with its own environment. Set them with `systemctl edit ollama`, then reload and restart.

**Generation is slow on a machine with a GPU.** Look at `ollama ps`. A CPU/GPU split means the model plus its context does not fit in VRAM. Use a smaller model, a smaller quantization, or a shorter context. A `100% CPU` result means the GPU was not detected; check the driver and the service log.

**The GPU stops being used after suspend and resume.** This is a known issue with the NVIDIA driver on Linux laptops and desktops. The Ollama GPU documentation describes reloading the `nvidia_uvm` kernel module as the fix.

**Permission denied after moving the model directory.** The `ollama` user cannot write to the new path. Fix ownership with `chown` as shown earlier.

**Connection refused from another machine or a container.** The server is bound to `127.0.0.1`. Either change `OLLAMA_HOST` (and firewall the port) or connect from the same host.

**A browser-based tool cannot call the API.** Browsers enforce cross-origin rules. Add the tool's origin to the `OLLAMA_ORIGINS` variable.

**The disk fills up.** Every tag you pull stays on disk until removed. Review with `ollama ls` and delete what you do not use with `ollama rm`.

To update Ollama on Linux, run the install script again; it replaces the binary and keeps your models and overrides.

## Where to go next

A terminal prompt is fine for testing, but most people want a chat interface with history and multiple users. [Self-host a private ChatGPT with Open WebUI and Ollama](/blog/open-webui-self-hosted-chatgpt/) adds that on top of the server you just set up. If you expect many simultaneous users, or want more control over how the model is loaded, compare the alternatives in [Ollama vs llama.cpp vs vLLM](/blog/ollama-vs-llama-cpp-vs-vllm/).

## Frequently asked questions

### Do I need a GPU to use Ollama?

No. Ollama runs on the CPU when no supported GPU is present. Small models of a few billion parameters are usable that way; larger ones work but respond slowly. A GPU with enough VRAM to hold the whole model makes the biggest difference to speed.

### Where does Ollama store models on Linux?

With the standard installer, under `/usr/share/ollama/.ollama/models`, owned by the `ollama` user. On macOS the directory is `~/.ollama/models`. Set `OLLAMA_MODELS` to use a different location.

### Does Ollama send my prompts anywhere?

Prompts sent to a model running on your machine are processed locally. The server contacts the network to download models when you pull them. Ollama also offers optional cloud-hosted models; those run on remote servers, so avoid them if the goal is to keep data on your own hardware.

### How do I keep a model loaded permanently?

Set `OLLAMA_KEEP_ALIVE=-1` on the service, or send `"keep_alive": -1` in an API request. A value of `0` does the opposite and unloads the model as soon as the response is finished.

### Can several people use one Ollama server at the same time?

Yes. Requests are queued, and `OLLAMA_NUM_PARALLEL` controls how many are processed at once per model. Each parallel slot uses additional memory for its context, so size it against your available VRAM.
