---
title: "Hardware for local LLMs: GPU, VRAM and RAM explained"
description: "How to size hardware for local LLMs: estimate memory from parameter count and quantization, and decide between GPU, CPU and Apple Silicon."
date: 2026-11-15
tags: [self-hosted-llms]
art:
  kind: layers
  caption: "What each part of the machine does when you run a model locally."
  items: ["GPU memory (VRAM): holds the model", "System RAM: overflow and CPU inference", "CPU: runs what the GPU cannot", "Disk: stores the model files"]
---

Most disappointment with local language models comes from a mismatch between the model and the machine: a model that almost fits, spills onto the CPU, and answers at a crawl. The good news is that the requirement is predictable. This article shows how to estimate the memory a model needs from two numbers, explains what each hardware component actually contributes, and gives you commands to check what your current machine can run before you spend anything.

No prices or benchmark figures appear here. Both change too quickly and vary too much between systems to be worth printing. The method for working out what you need does not change.

## The one rule: the model has to fit in fast memory

A language model is a very large set of numbers called weights or parameters. Generating each token (a word piece) means reading essentially all of them and doing arithmetic with each one. Two consequences follow:

1. **The whole model must be in memory.** If it is not, the system reads from disk constantly and generation becomes unusably slow.
2. **Speed is governed by how fast that memory can be read.** Generating text is limited less by raw compute than by how quickly the weights can be moved from memory to the processor.

Video memory (VRAM) on a graphics card is very fast memory sitting next to a processor built for parallel arithmetic. System RAM is slower to read, and a CPU has far fewer parallel units. That is the whole reason GPUs matter here.

It leads to the most useful sizing rule: **a model that fits entirely in VRAM is fast; a model that does not is slow, even if only a small part spills over.** Tools such as Ollama and llama.cpp can split a model between the GPU and the CPU, and it will run, but the CPU portion sets the pace. Buying or choosing hardware is therefore mostly a question of which models fit entirely.

## Estimate how much memory a model needs

Memory use has two parts: the weights, and the working memory for the context.

### The weights

The size of the weights is the parameter count multiplied by the number of bits used to store each one:

```text
weights in GB ≈ parameters in billions × bits per weight ÷ 8
```

Models are trained with 16-bit weights, so an 8-billion-parameter model needs about 16 GB in its original form. Quantization stores the weights with fewer bits, trading a little accuracy for a large saving. The common 4-bit format, `Q4_K_M`, averages a little under 5 bits per weight once its internal bookkeeping is included. The llama.cpp project publishes measured figures for Llama 3.1 8B: about 4.9 bits per weight at `Q4_K_M`, 5.7 at `Q5_K_M`, 6.6 at `Q6_K`, 8.5 at `Q8_0` and 16 at `F16`. [GGUF and quantization explained](/blog/gguf-quantization-explained/) covers what those names mean and how to choose between them.

Applying the formula with those figures gives a table you can use for planning. These are computed estimates of the weights alone, rounded, not measurements of any particular model:

| Model size | Q4_K_M (~4.9 bits) | Q5_K_M (~5.7 bits) | Q8_0 (~8.5 bits) | F16 (16 bits) |
| --- | --- | --- | --- | --- |
| 3 billion | ~1.8 GB | ~2.1 GB | ~3.2 GB | ~6 GB |
| 8 billion | ~4.9 GB | ~5.7 GB | ~8.5 GB | ~16 GB |
| 14 billion | ~8.6 GB | ~10 GB | ~15 GB | ~28 GB |
| 32 billion | ~20 GB | ~23 GB | ~34 GB | ~64 GB |
| 70 billion | ~43 GB | ~50 GB | ~74 GB | ~140 GB |

You rarely need to calculate this yourself. The download size of a quantized model file is, for practical purposes, the memory its weights will occupy. If a model page lists a 9 GB file, plan for 9 GB of weights.

### The context

On top of the weights, the model keeps working state for every token in its context window: the prompt, the conversation so far, and the reply. This is the KV cache (key-value cache). It lets the model avoid recomputing earlier tokens, and its size grows in proportion to the context length. It also depends on the model's architecture, so there is no single figure, but the pattern is reliable: a few thousand tokens of context adds a modest amount, while a very long context on a large model can add many gigabytes.

Serving several requests in parallel multiplies this cost, because each simultaneous conversation needs its own cache.

### A workable rule of thumb

Putting the parts together, as a rough guide rather than a guarantee:

```text
memory needed ≈ model file size + 1 to 2 GB for a modest context and overhead
```

Leave more headroom if you plan to use long contexts, and remember that on a desktop the operating system's display also uses some VRAM. A model whose file is the same size as your VRAM will not fit.

## What each component contributes

### GPU and VRAM

VRAM capacity is the specification that decides which models you can run. The speed of the GPU decides how fast they run once they fit, and for most people capacity is the binding limit. An older card with more memory is often more useful for this work than a newer card with less, because it can hold a larger model entirely.

NVIDIA cards have the broadest software support, since most inference software targets CUDA, NVIDIA's compute platform, first. AMD cards work in Ollama and llama.cpp through ROCm or Vulkan, and Intel cards through SYCL or Vulkan, but tools aimed at high-throughput serving, such as vLLM, are built primarily around NVIDIA hardware. Check that the software you intend to use supports a card before buying it; the [Ollama GPU page](https://docs.ollama.com/gpu) lists supported hardware and driver requirements.

### Several GPUs

Two cards can hold a model that neither could alone. llama.cpp and Ollama spread a model's layers across the available GPUs, and vLLM splits a model with its `--tensor-parallel-size` option. Memory adds up usefully. Speed does not double, because the cards must pass data between them at each step. A second GPU is a way to run a bigger model, not a way to make a small one faster for a single user.

Check the practical side as well: the power supply rating, physical slot spacing, and case airflow. Sustained generation keeps a GPU at high load for much longer stretches than typical desktop use.

### System RAM

With a GPU doing the work, system RAM plays a supporting role. The model file is read from disk through RAM on its way to the GPU, and the inference software and operating system need their share. A sensible minimum is enough RAM to hold the largest model you intend to load, plus what the system needs for everything else.

RAM becomes central in two cases: running on CPU only, where it holds the entire model, and partial offload, where it holds whatever did not fit in VRAM.

### CPU

When the model is fully on the GPU, the CPU mostly prepares input and shuffles data, and a mid-range processor is plenty. When the CPU does the inference, what matters most is memory bandwidth: how many bytes per second can travel from RAM to the processor. That depends on the memory generation and speed, and on the number of memory channels in use, more than on the core count. This is why a server or workstation platform with many memory channels can outperform a desktop chip with more cores, and why two matched memory modules beat one of the same total size. Adding threads beyond the number of physical cores rarely helps and can make things slower.

### Storage

Storage affects loading, not generation. Models are multi-gigabyte files, and loading one from a solid-state NVMe drive takes a fraction of the time it takes from a spinning disk. Plan capacity generously: a handful of models in a couple of quantizations each uses up hundreds of gigabytes quickly.

### Apple Silicon and unified memory

Apple's M-series machines blur the GPU and RAM distinction. They have unified memory: one pool shared by the CPU and GPU, with higher bandwidth than typical desktop RAM. A model loaded there is accelerated through Metal, Apple's graphics and compute API, without being limited to a separate, smaller VRAM budget. A Mac with a large amount of memory can therefore run models that would need an expensive multi-GPU setup on a PC, though usually not as fast as high-end dedicated GPUs run a model that fits. The same idea applies to other systems that share memory between CPU and an integrated GPU.

## Choosing a setup for a goal

The table maps common goals to the capacity they need. The model sizes assume `Q4_K_M` quantization and a moderate context, and the tiers are rules of thumb derived from the estimates above:

| Fast memory available | What fits comfortably | Typical use |
| --- | --- | --- |
| CPU only, 16 GB RAM | Up to about 8 billion parameters, slowly | Trying things out, batch jobs where speed is unimportant |
| 8 GB VRAM | Around 8 billion parameters | Personal assistant, summaries, light coding help |
| 12 to 16 GB VRAM | Around 14 billion parameters | Stronger general use, room for longer context |
| 24 GB VRAM | Around 32 billion parameters with a tight context | Capable coding and reasoning models |
| 48 GB or more, one or several GPUs | 70 billion parameters | The largest open models, or serving several users |

Three pieces of reasoning help when a choice sits between tiers.

**A larger model at lower precision usually beats a smaller model at higher precision.** If you have 12 GB, a 14-billion-parameter model at 4 bits is generally a better use of it than an 8-billion-parameter model at 8 bits. Going much below 4 bits is where quality falls off more steeply.

**Budget for context, not only for weights.** Tasks such as coding assistants, agents and document question answering need long context windows. A model that fits with a 4,000-token window may not fit with a 32,000-token one.

**Concurrent users change the calculation.** One person chatting uses one context. Ten simultaneous users need ten, or a serving engine designed to batch them. If that is the goal, read [Ollama vs llama.cpp vs vLLM](/blog/ollama-vs-llama-cpp-vs-vllm/) before choosing hardware, because the software determines how the memory gets used.

## Check what your machine can do

Before buying anything, measure what you have. On an NVIDIA system, list the GPU and its memory:

```bash
nvidia-smi --query-gpu=name,memory.total,memory.used --format=csv
```

Check system memory and the processor:

```bash
free -h
lscpu | grep -E 'Model name|^CPU\(s\)|Thread|Core|Flags' | cut -c1-200
```

In the `Flags` line, look for `avx2` or `avx512f`. These are instruction sets that CPU inference relies on for speed; a processor without at least AVX2 will be very slow.

To see how memory modules are installed, which tells you whether all memory channels are populated:

```bash
sudo dmidecode --type memory | grep -E 'Size|Speed|Locator' | grep -v 'No Module'
```

Then test with a real model. With Ollama installed (see [How to run an LLM locally with Ollama](/blog/run-llm-locally-with-ollama/)), load one and check where it landed:

```bash
ollama run llama3.2 "Say hello." && ollama ps
```

The `PROCESSOR` column shows `100% GPU`, `100% CPU` or a split. Anything other than `100% GPU` on a machine with a graphics card means the model and its context did not fit. While a prompt is generating, watch memory use in a second terminal:

```bash
watch -n 1 nvidia-smi
```

For speed, measure rather than guess. Ollama's API returns `eval_count` and `eval_duration` with every response, and tokens generated divided by the duration in seconds is your generation rate. As a point of reference for judging the result, comfortable reading speed is only a few words per second, so a rate that sounds low can still feel responsive in a chat. Uses that process text in bulk are far more demanding.

## Ways to make a model fit

When a model is slightly too large, there are four levers, in rough order of preference:

1. **Shorten the context.** If you do not need a long window, reducing it frees memory at no cost in answer quality.
2. **Use a smaller quantization.** Moving from `Q8_0` or `Q6_K` to `Q4_K_M` saves a lot of memory for a small quality cost.
3. **Compress the context cache.** Both llama.cpp and Ollama can store the KV cache at reduced precision. In Ollama, setting `OLLAMA_KV_CACHE_TYPE=q8_0` with flash attention enabled roughly halves the cache memory compared with the 16-bit default, according to its documentation.
4. **Choose a smaller model.** A model that fits will serve you better than a larger one that crawls.

In Ollama on Linux these are service settings:

```ini
[Service]
Environment="OLLAMA_FLASH_ATTENTION=1"
Environment="OLLAMA_KV_CACHE_TYPE=q8_0"
Environment="OLLAMA_CONTEXT_LENGTH=8192"
```

Partial offload to the CPU is the fallback when none of these is acceptable. It works, and it is slow.

## Common mistakes

**Sizing by file size alone.** A model file that matches your VRAM exactly leaves nothing for the context or for the desktop. Leave headroom.

**Choosing a GPU on speed and ignoring memory.** The faster card with less VRAM runs the small model quickly and cannot run the large one properly at all.

**Expecting a second GPU to double single-user speed.** It increases capacity. It does not halve the time per token.

**Running one memory module.** On CPU inference, a single module leaves half of a dual-channel system's bandwidth unused.

**Raising the context window without checking memory.** A large window can silently push a model that fitted onto the CPU. Check `ollama ps` after changing it.

**Assuming an integrated GPU helps.** Integrated graphics share ordinary system RAM. They can run models, but they do not provide the fast dedicated memory that makes a discrete card valuable.

**Forgetting sustained load.** A laptop that handles short bursts may throttle during long generations. Thin machines get hot, and performance drops as they do.

**Trusting other people's speed figures.** Tokens-per-second numbers depend on the model, quantization, context length, software version and settings. Use them to compare orders of magnitude, then measure on your own system.

## Frequently asked questions

### Can I run a local LLM without a GPU?

Yes. Small models of a few billion parameters run acceptably on a modern CPU with enough RAM. Larger models run too, but slowly. Fast memory in dual-channel or better configuration matters more than a high core count.

### How much VRAM do I need?

Enough to hold the model file plus one to two gigabytes for a modest context, as a rule of thumb. For 4-bit models that puts 8-billion-parameter models on 8 GB cards, 14-billion on 12 to 16 GB, and 32-billion on 24 GB with little room to spare.

### Is system RAM a substitute for VRAM?

It lets a model load when VRAM runs out, since inference software can keep some layers on the CPU. It is not a substitute in speed: the part held in RAM runs at CPU pace and slows the whole model down.

### Do I need a fast CPU if I have a good GPU?

Not especially. When the model is fully on the GPU, the CPU has a light load. Spend the budget on VRAM first.

### Does a faster SSD make the model answer faster?

No. Storage speed shortens the time to load a model into memory. Once loaded, generation speed depends on the GPU or, for CPU inference, on memory bandwidth.
