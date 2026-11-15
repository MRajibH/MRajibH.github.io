---
title: "GGUF and quantization explained: choosing Q4, Q5 or Q8"
description: "What GGUF files are, how to read names like Q4_K_M and IQ3_M, how much memory each level needs, and how to pick or build the right quantization."
date: 2026-11-15
tags: [self-hosted-llms]
art:
  kind: flow
  caption: "Quantization trades a little accuracy for a model that fits your hardware."
  items: ["Full-precision model", "Quantize", "GGUF file", "Runs on your hardware"]
draft: true
---

Open a model repository on Hugging Face and you are faced with twenty files named things like `Q4_K_M`, `Q5_K_S`, `IQ3_XXS` and `Q8_0`, with no obvious way to choose. The names describe how much the model has been compressed, and the choice decides whether it fits on your hardware and how well it answers. This article explains the file format, decodes the naming scheme, shows how much memory each level costs using published measurements, and gives you a method for picking one, plus the commands to download a specific level or build your own.

## What a GGUF file is

GGUF is a binary file format for storing a model so that it can be loaded quickly and run for inference. It was created for llama.cpp, the C/C++ inference engine, and is the format used by tools built around that ecosystem, including Ollama and LM Studio.

Two properties make it practical:

- **One file holds everything.** Besides the tensors (the arrays of weights), a GGUF file carries standardized metadata: the model architecture, the tokenizer vocabulary, the chat template that formats a conversation into the text the model expects, and the context length it was trained for. You do not need a folder of separate configuration files, and a runner can load the model without guessing.
- **It stores quantized weights.** The tensors can be kept at full precision or compressed to a few bits per weight, and the file records which scheme each tensor uses.

The other format you will meet is safetensors, which stores tensors only and is what model authors usually publish. A GGUF file is produced from that original by a conversion step and, almost always, a quantization step.

You can inspect a GGUF file without downloading it. Hugging Face has a viewer on the file listing of any GGUF repository that shows the metadata and each tensor's shape and precision. For a model already in Ollama, `ollama show <model>` prints the parameter count, context length and quantization.

## What quantization does

A model's weights are numbers. During training they are stored as 16-bit or 32-bit floating-point values. Quantization replaces them with lower-precision values, such as 4-bit integers, together with a small amount of extra data that says how to scale those integers back into approximately the original numbers.

A helpful comparison is image compression. Saving a photograph as a JPEG discards detail that is hard to notice and produces a much smaller file. Compress too far and the damage becomes visible. Quantization does the same to a model: at moderate levels the answers are hard to tell from the original, and at aggressive levels the model becomes noticeably less accurate, more repetitive or less coherent.

The weights are quantized in blocks. For each block, the file stores a scale (and sometimes an offset) at higher precision, then the individual weights at low precision relative to that scale. That overhead is why a "4-bit" quantization uses somewhat more than 4 bits per weight on average. The honest measure of a quantization level is therefore **bits per weight**, abbreviated bpw, which counts everything.

Memory needed for the weights follows directly:

```text
size in GB ≈ parameters in billions × bits per weight ÷ 8
```

Smaller weights also tend to generate faster, because text generation is limited by how quickly weights can be read from memory, and there is less to read. How that plays out depends on your hardware, which is covered in [Hardware for local LLMs](/blog/hardware-for-local-llms/).

## How to read the names

The names follow a pattern once you know the parts. Take `Q4_K_M`:

- **`Q4`** is the nominal number of bits per weight for most of the model.
- **`K`** identifies the quantization family, here the "K-quants".
- **`M`** is the variant within that level: `S` for small, `M` for medium, `L` for large.

There are three families in common use.

### Legacy quants: `Q4_0`, `Q5_1`, `Q8_0`

The original scheme. Weights are grouped into blocks of 32 and rounded to the nearest representable value, with one scale per block (`_0`) or a scale and a minimum (`_1`). These are simple and have mostly been superseded at 4 and 5 bits. The exception is `Q8_0`, which remains the standard 8-bit option.

### K-quants: `Q3_K_S`, `Q4_K_M`, `Q5_K_M`, `Q6_K`

A more efficient scheme that organises blocks into super-blocks and stores the scales themselves compactly. More importantly, K-quants are mixtures: not every tensor in the model is equally sensitive to precision loss, so the more sensitive ones are kept at a higher bit depth than the rest. The `S`, `M` and `L` suffixes describe how generous that mixture is. `Q4_K_S` keeps almost everything at 4 bits, while `Q4_K_M` spends a little extra on the tensors that matter most, for a slightly larger file and slightly better fidelity. `Q6_K` has no suffix because it comes in one variant.

### I-quants: `IQ2_XS`, `IQ3_M`, `IQ4_XS`

A newer family designed to hold up better at low bit rates, roughly 4 bits and below. They use a more elaborate encoding and are produced with the help of an importance matrix, described later. The suffixes run from `XXS` (smallest) through `XS`, `S` and `M`. An I-quant is usually the better choice when you must go below 4 bits. On some hardware, particularly CPU inference, I-quants can run slower than a K-quant of similar size because decoding them takes more work, so test both if speed matters.

You will also see `F16`, `BF16` and `F32`: unquantized 16-bit and 32-bit floating-point files, used as the starting point for making quants rather than for everyday running.

## What each level costs

The llama.cpp project publishes bits per weight and file size for every quantization of Llama 3.1 8B in its [quantize tool documentation](https://github.com/ggml-org/llama.cpp/blob/master/tools/quantize/README.md). A selection of those figures, rounded:

| Quantization | Bits per weight | File size (GiB) | Share of F16 size |
| --- | --- | --- | --- |
| `Q2_K` | 3.16 | 2.95 | 20% |
| `IQ3_M` | 3.76 | 3.52 | 24% |
| `Q3_K_M` | 4.00 | 3.74 | 25% |
| `IQ4_XS` | 4.46 | 4.17 | 28% |
| `Q4_K_S` | 4.67 | 4.36 | 29% |
| `Q4_K_M` | 4.89 | 4.58 | 31% |
| `Q5_K_S` | 5.57 | 5.21 | 35% |
| `Q5_K_M` | 5.70 | 5.33 | 36% |
| `Q6_K` | 6.56 | 6.14 | 41% |
| `Q8_0` | 8.50 | 7.95 | 53% |
| `F16` | 16.00 | 14.96 | 100% |

Two things stand out. First, the nominal number understates the real cost: `Q2_K` is over 3 bits per weight and `Q4_K_M` is nearly 5. Second, the steps are uneven. Going from `Q4_K_M` to `Q8_0` nearly doubles the file. Going from `Q4_K_M` to `Q5_K_M` adds about a sixth.

The bits-per-weight figures carry over to other models closely enough for planning, though the exact value shifts a little with architecture. Multiply by the parameter count to estimate any model, or simply read the file size on the download page, which is the same information.

Remember that the file size is not the whole memory requirement. The context window needs its own working memory on top, which grows with the length of the context.

## How to choose a level

Quality loss from quantization is real but hard to state as a single number. It is usually measured by perplexity or by how far the quantized model's output probabilities diverge from the original's, and those measurements vary by model. So treat what follows as widely used rules of thumb, not guarantees:

| Level | Character | When to use it |
| --- | --- | --- |
| `Q8_0` | Practically indistinguishable from the original | Memory is plentiful, or the model is small anyway |
| `Q6_K` | Very close to the original | You have headroom and want to spend it on fidelity |
| `Q5_K_M` | Small loss | A good upgrade from Q4 when it still fits fully in VRAM |
| `Q4_K_M` | Modest loss, the usual default | The general-purpose choice for most hardware |
| `IQ4_XS`, `Q4_K_S` | Slightly more loss than `Q4_K_M` | The model is just short of fitting |
| `Q3_K_M`, `IQ3_M` | Noticeable loss | A larger model is worth it and nothing bigger fits |
| `Q2_K`, `IQ2` variants | Heavy loss | Experiments, or very large models on limited memory |

`Q4_K_M` is the default in both places you are likely to download from: llama.cpp selects it when you do not name a quantization, and so does Ollama when running a model from Hugging Face.

A procedure that works in practice:

1. **Find your memory budget.** That is your VRAM, less one to two gigabytes for context and overhead, or more if you need a long context window.
2. **Start with the largest model whose `Q4_K_M` file fits in that budget.** A bigger model at 4 bits generally outperforms a smaller model at 8 bits in the same memory, because parameter count affects capability more than the last few bits of precision do.
3. **If there is room left, step up** to `Q5_K_M` or `Q6_K` of the same model.
4. **If it does not quite fit, step down one notch** to `Q4_K_S` or `IQ4_XS` before dropping to a smaller model. Below roughly 4 bits, weigh a smaller model at `Q4_K_M` against the larger one at 3 bits and test both.
5. **Test on your own task.** Run the same set of real prompts through two candidates. Tasks needing precision, such as code generation, structured output and arithmetic, show quantization damage sooner than casual conversation does.

Smaller models are also more sensitive. A model with a few billion parameters has less redundancy to absorb the rounding, so it is worth running small models at `Q5`, `Q6` or `Q8`, where the absolute cost in memory is small anyway. Embedding models, which turn text into vectors for search, are small too and are commonly kept at high precision for the same reason.

## Getting a specific quantization

### With Ollama

Models in the Ollama library have a default tag that points to a 4-bit build, plus explicit tags for other levels. For example, the default `llama3.2` tag is the 3-billion-parameter model at `Q4_K_M`, and the library also lists an 8-bit build:

```bash
ollama pull llama3.2
ollama pull llama3.2:3b-instruct-q8_0
ollama show llama3.2:3b-instruct-q8_0
```

Check the Tags page of a model in the library for the exact names available, since not every model is published at every level.

Ollama can also run a GGUF repository straight from Hugging Face. Append the quantization after a colon; the name is not case-sensitive:

```bash
ollama run hf.co/bartowski/Llama-3.2-3B-Instruct-GGUF:Q8_0
```

Setting up Ollama itself is covered in [How to run an LLM locally with Ollama](/blog/run-llm-locally-with-ollama/).

### With llama.cpp

The `-hf` option downloads from a Hugging Face repository using the same `repository:quantization` form:

```bash
llama-server -hf bartowski/Llama-3.2-3B-Instruct-GGUF:Q8_0 --port 8080 -c 8192
```

If you already have the file, pass its path with `-m` instead.

## Making your own GGUF

Community quantizations exist for most popular models, so you rarely need to do this. It becomes necessary when you have fine-tuned a model yourself, when a new model has not been converted yet, or when you want a level nobody has published.

The process has two phases: convert the original model to an unquantized GGUF, then quantize that file. Both tools come from the llama.cpp repository:

```bash
git clone https://github.com/ggml-org/llama.cpp
cd llama.cpp
python3 -m pip install -r requirements.txt

cmake -B build
cmake --build build --config Release -j 8
```

Convert a model directory downloaded from Hugging Face to a 16-bit GGUF:

```bash
python convert_hf_to_gguf.py ./my-finetuned-model \
  --outfile my-model-f16.gguf --outtype f16
```

Then quantize it. The arguments are the input file, the output file and the target type:

```bash
./build/bin/llama-quantize my-model-f16.gguf my-model-Q4_K_M.gguf Q4_K_M
```

Always quantize from the 16-bit or 32-bit file. Quantizing an already quantized file compounds the rounding errors; the tool refuses to do it unless you pass `--allow-requantize`, and its documentation warns that quality can suffer severely.

### Importance matrices

An importance matrix, or imatrix, improves a quantization by measuring which weights matter most. The model is run over a sample of text, statistics are collected on how strongly each weight influences the output, and the quantizer then spends its limited precision where it has the most effect. This is how I-quants are made, and it also improves K-quants, most visibly at lower bit rates.

llama.cpp includes a tool to generate the matrix from a text file, and `llama-quantize` accepts the result:

```bash
./build/bin/llama-imatrix -m my-model-f16.gguf -f calibration.txt -o imatrix.gguf

./build/bin/llama-quantize --imatrix imatrix.gguf \
  my-model-f16.gguf my-model-IQ4_XS.gguf IQ4_XS
```

The calibration text should resemble what the model will be used for. Many community repositories state in their description whether an imatrix was used, which is worth checking when comparing two uploads of the same model.

To use your file in Ollama, write a Modelfile with a single line, `FROM ./my-model-Q4_K_M.gguf`, and run `ollama create my-model -f Modelfile`. Ollama imports the GGUF as it is and does not quantize it during import.

## Common mistakes

**Picking the largest file because bigger sounds better.** An 8-bit model that spills out of VRAM onto the CPU is far slower than a 4-bit one that fits, for a difference in quality most tasks will not reveal.

**Comparing a model at different quantizations without noticing.** Two people reporting different results from "the same model" are often running `Q3` and `Q8`. Note the level whenever you record a test result.

**Going very low to squeeze in a huge model.** At 2 bits a large model may lose the advantage that made it attractive. Compare it against the next size down at 4 bits before committing.

**Requantizing a quantized file.** Converting `Q8_0` to `Q4_K_M` gives a worse result than quantizing the original to `Q4_K_M`. Go back to the source weights.

**Forgetting the context memory.** The file fits, the model loads, and generation is still slow because the context cache pushed part of it onto the CPU. Check the `PROCESSOR` column of `ollama ps`.

**Assuming GGUF works everywhere.** It is the format of the llama.cpp family. GPU serving engines such as vLLM are built around other formats; [Ollama vs llama.cpp vs vLLM](/blog/ollama-vs-llama-cpp-vs-vllm/) explains the split.

## Frequently asked questions

### Is Q4_K_M good enough?

For most general use, yes. It is the default in both llama.cpp and Ollama's Hugging Face integration because it balances size and quality well. Step up if you have spare memory or your task is sensitive to small errors.

### What is the difference between Q4_K_M and Q4_K_S?

Both are 4-bit K-quants. The `M` variant keeps more of the sensitive tensors at higher precision, so it is slightly larger and slightly more faithful. For Llama 3.1 8B the published figures are 4.89 against 4.67 bits per weight.

### Does quantization make a model faster?

Usually, because there is less data to read from memory per token, and because a smaller file is more likely to fit entirely on the GPU. The effect varies with hardware, and some low-bit formats cost extra time to decode, so measure on your own system.

### Can I convert a GGUF file back to the original model?

Not exactly. Quantization discards information, so the original weights cannot be recovered from a quantized file. Keep the source model if you may want other quantization levels later.

### Should I use an I-quant or a K-quant?

At 4 bits and above, K-quants are the conventional choice. Below 4 bits, I-quants generally preserve more quality for the same size. If you run on CPU, compare speed as well, since I-quants can be slower there.
