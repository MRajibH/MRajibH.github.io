---
title: "RAG chunking strategies: how to split documents that retrieve well"
description: "Compare chunking strategies for RAG, from fixed-size and recursive splitting to structure-aware and contextual chunks, and learn how to choose by measuring."
date: 2026-11-15
tags: [rag-and-agents]
art:
  kind: flow
  caption: "How a document becomes chunks that can be retrieved on their own."
  items: ["Document", "Split on structure", "Add overlap", "Retrievable chunks"]
draft: true
---

In a retrieval-augmented generation (RAG) system, the model can only answer from the passages that search returns, and search can only return the pieces you cut the documents into. Cut badly and the answer to a question ends up split across two pieces, or buried in one so broad that it matches nothing well. This guide explains what makes a chunk retrieve well, compares the main splitting strategies with working code, and shows how to choose between them by measuring instead of guessing.

It assumes you know the basic shape of a RAG pipeline. If not, [Build a RAG pipeline from scratch](/blog/build-rag-pipeline-from-scratch/) walks through one end to end.

## Why chunking decides retrieval quality

A chunk is a passage of a document that is embedded, stored and retrieved as one unit. An embedding is a list of numbers that represents the meaning of a text, and it is a single vector for the whole chunk no matter how long the chunk is. Two pressures follow from that, and they pull in opposite directions.

**Chunks that are too large** blur. One vector has to stand for several topics at once, so it matches none of them strongly, and a specific question scores only moderately against it. Large chunks also spend the model's context on text that is beside the point. And there is a hard limit: every embedding model reads only a fixed number of tokens, and many truncate anything beyond it without warning, so the end of an oversized chunk is never indexed at all.

**Chunks that are too small** lose meaning. A sentence such as "It must be restarted after this change" matches a question about restarting, but neither the search nor the model knows what "it" is or which change is meant. Small chunks retrieve precisely and then fail to answer.

A good chunk sits between the two. A useful test: read a chunk by itself, with no surrounding text, and ask whether a person could tell what it is about and learn something from it. If yes, an embedding model can represent it and a language model can use it.

## Size, overlap and how to count

Three settings appear in almost every strategy.

**Measure in tokens, not characters.** A token is the unit a model actually reads, usually a word or a piece of one. Model limits are stated in tokens, and the ratio of characters to tokens varies between prose, code and languages, so a character count is an unreliable stand-in. Count with a tokenizer, ideally the one belonging to your embedding model.

**Chunk size.** There is no universally correct value, and published advice differs because documents differ. A few hundred tokens is a common starting range for prose. The firm rule is the upper bound: the chunk, including anything you prepend to it, must fit inside the input limit of the embedding model. Look that limit up on the model's documentation page before choosing a number. Some widely used small models read only a few hundred tokens.

**Overlap.** Overlap repeats the end of one chunk at the start of the next, so a sentence that falls on a boundary appears whole in at least one of them. As a rough rule of thumb, people start with an overlap of around a tenth to a fifth of the chunk size. Overlap has costs: a larger index, and near-duplicate passages in the results that crowd out other material. If your chunks already end at natural boundaries such as paragraphs or headings, you need little or none.

## The main strategies compared

| Strategy | How it splits | Strengths | Weaknesses | Suits |
| --- | --- | --- | --- | --- |
| Fixed-size | Every N tokens, with overlap | Trivial, predictable size | Cuts through sentences and ideas | A baseline; text with no structure |
| Recursive | On paragraphs first, then lines, then words, until pieces fit | Respects natural breaks; still simple | Unaware of headings and document layout | General prose; a sensible default |
| Structure-aware | Along the document's own headings, sections or code units | Chunks match how the author organised the content | Needs a parser per format; sections vary wildly in size | Markdown, HTML, documentation, source code |
| Semantic | Where the meaning of adjacent sentences shifts | Finds topic boundaries in unstructured text | Extra embedding work at indexing; needs tuning | Transcripts, long prose without headings |
| Parent-child | Search small chunks, return the larger section they belong to | Precise matching with fuller context for the model | More bookkeeping; larger prompts | Reference material where answers need surrounding detail |
| Contextual | Add document and section context to each chunk before embedding | Fixes chunks that are meaningless out of context | More tokens per chunk; a model call per chunk if generated | Large collections of similar-looking documents |

These are not exclusive. A strong setup usually combines them: split along structure, apply a size limit inside each section, and add context to every chunk.

## Fixed-size and recursive splitting

Fixed-size splitting takes the token stream and cuts it every N tokens. It needs no knowledge of the text, which is its only virtue. Boundaries land in the middle of sentences, lists and tables, and overlap only partly repairs the damage. Its real use is as a baseline to compare other strategies against.

Recursive splitting is the practical default. It tries to cut at the largest natural break available and falls back to smaller ones only when a piece is still too big: first blank lines between paragraphs, then single line breaks, then spaces. Most chunks therefore end where a paragraph ends.

The `langchain-text-splitters` package provides this without pulling in the rest of LangChain. This example measures size in tokens:

```bash
pip install langchain-text-splitters tiktoken
```

```python
from pathlib import Path

from langchain_text_splitters import RecursiveCharacterTextSplitter

splitter = RecursiveCharacterTextSplitter.from_tiktoken_encoder(
    encoding_name="cl100k_base",
    chunk_size=300,       # tokens
    chunk_overlap=40,     # tokens
)

text = Path("docs/backup-runbook.md").read_text(encoding="utf-8")
chunks = splitter.split_text(text)

for number, chunk in enumerate(chunks[:3]):
    print(f"--- chunk {number} ---\n{chunk}\n")
```

Without the `from_tiktoken_encoder` constructor, `chunk_size` is counted in characters, which is a common source of chunks that are far smaller or larger than intended. The `cl100k_base` encoding is a general-purpose tokenizer; its counts will differ somewhat from your embedding model's own tokenizer, so leave a margin below the model's limit rather than aiming exactly at it. The sizes here are starting values to test, not recommendations.

Always print a sample of the chunks and read them. It takes two minutes and reveals most problems before you spend time embedding anything.

## Structure-aware splitting

Authors already divide documents into sections, and a section under a heading is usually about one thing. Splitting along that structure gives chunks whose boundaries mean something. It also gives you the heading text, which is the cheapest and most valuable context you can attach to a chunk.

This function walks a Markdown document and yields each section together with its full heading path, such as `Backups > Restoring > Point-in-time recovery`. It ignores `#` characters inside fenced code blocks, where they are comments, not headings.

```python
import re

HEADING = re.compile(r"^(#{1,6})\s+(.*)$")


def split_by_headings(markdown):
    """Yield (heading_path, body) for each section of a Markdown document."""
    path, body, in_code = [], [], False
    for line in markdown.splitlines():
        if line.lstrip().startswith("```"):
            in_code = not in_code
        match = None if in_code else HEADING.match(line)
        if match:
            if any(l.strip() for l in body):
                yield " > ".join(path), "\n".join(body).strip()
            level, title = len(match.group(1)), match.group(2).strip()
            path = path[: level - 1] + [title]
            body = []
        else:
            body.append(line)
    if any(l.strip() for l in body):
        yield " > ".join(path), "\n".join(body).strip()
```

Sections vary enormously in length, so structure alone is not enough: one section may be two lines and the next two thousand words. Combine it with the size-limited splitter from the previous section, and put the heading path at the top of every chunk:

```python
def chunk_markdown(markdown, title):
    chunks = []
    for heading_path, body in split_by_headings(markdown):
        label = " > ".join(part for part in (title, heading_path) if part)
        for piece in splitter.split_text(body):
            chunks.append({
                "embed_text": f"{label}\n\n{piece}",   # what gets embedded
                "text": piece,                          # what the model is shown
                "section": heading_path,
            })
    return chunks
```

Now the orphaned sentence "It must be restarted after this change" is embedded as "Operations guide > Database > Changing connection limits" followed by the sentence. The search can match it to a question about connection limits, and the model can tell what "it" refers to. The label counts towards the embedding model's token limit, so reduce `chunk_size` to leave room for it.

LangChain's `MarkdownHeaderTextSplitter` does a similar job if you prefer a library, and the same idea applies to other formats: split HTML on its heading and section elements, and split source code on functions and classes instead of on line counts. `RecursiveCharacterTextSplitter.from_language` offers separators suited to a range of programming languages.

## Giving chunks more context

The heading path is one form of a broader idea: the text you embed does not have to be identical to the text you cut. Three techniques build on that.

### Parent-child retrieval

Small chunks match questions precisely; large ones give the model enough to answer. Parent-child retrieval, sometimes called small-to-big, uses both. You index small chunks, each carrying the identifier of the larger section it came from. At query time you search the small chunks, then hand the model the parent sections of the best matches, removing duplicates when several matches share a parent.

The sentence-window variant is the same idea at a finer grain: embed single sentences, and return each match with a few sentences on either side.

The cost is larger prompts and a second lookup. It pays off when answers depend on surrounding detail, such as a step in a procedure that makes sense only with the steps before it.

### Generated context

Headings do not always carry enough. In a set of quarterly reports, every file has a "Revenue" section, and the heading does not say which company or quarter it belongs to. Anthropic's write-up on [contextual retrieval](https://www.anthropic.com/news/contextual-retrieval) describes having a language model read the whole document and write a short description, typically 50 to 100 tokens, that situates each chunk, which is then prepended before embedding and keyword indexing. In the experiments that article reports, adding this context to embeddings reduced the rate of failed retrievals among the top 20 results by 35 percent, and by more when combined with keyword search and reranking. Those are the authors' figures on their own test sets, so treat them as evidence that the idea works, not as a prediction for your data.

The cost is a model call per chunk at indexing time. Start with the free version, which is the title and heading path, and add generated context only if measurement shows the free version is not enough.

### Semantic and late chunking

Semantic chunking places boundaries where the topic changes. It embeds each sentence, compares neighbours, and starts a new chunk where similarity between adjacent sentences drops sharply. It helps most with text that has no structure to lean on, such as transcripts. It adds indexing cost and a threshold to tune, and on well-structured documents it often does no better than splitting on headings.

Late chunking changes the order of operations. A long-context embedding model processes the whole document first, producing a vector per token that already reflects the surrounding text; the token vectors belonging to each chunk are then averaged into that chunk's embedding. Each chunk's vector therefore carries context from the rest of the document. It requires an embedding model with a long input window and tooling that supports the technique.

## Content that breaks naive splitters

Some content is damaged by any splitter that treats a document as a stream of words.

- **Tables.** A table cut in half loses its header row, and the remaining rows are numbers without meaning. Keep a table whole if it fits; if not, split it by rows and repeat the header in each piece.
- **Code blocks.** Never split inside one when you can avoid it, and keep the sentence that introduces the code attached to it. A command without the explanation of when to run it is a hazard, not an answer.
- **Lists and procedures.** Keep the sentence that introduces a list with its items. Steps separated from "do the following before upgrading" lose their purpose.
- **PDFs.** Extracted PDF text often contains page headers, footers and page numbers in the middle of sentences, words hyphenated across lines, and columns read in the wrong order. Clean these up before chunking; no splitting strategy can repair text that was extracted badly.
- **Boilerplate.** Navigation menus, cookie notices and legal footers repeated on every page produce many near-identical chunks that crowd real content out of the results. Strip them at loading time.

## How to choose: measure, do not guess

No strategy wins everywhere, so the choice has to come from a test on your own documents. The procedure is short.

1. **Write a question set.** Collect twenty to fifty questions that real users would ask, and for each one record the document and section that contains the answer. Include questions that use different wording from the source, and some that depend on exact terms.
2. **Pick a metric.** The simplest useful one is hit rate: the share of questions for which the correct section appears among the top *k* retrieved chunks, for the *k* you actually pass to the model.
3. **Change one thing at a time.** Index with the baseline, record the hit rate, then change only the chunk size, or only the strategy, and index again.
4. **Read the failures.** For every miss, look at what was retrieved instead. The pattern, whether split answers, missing context or boilerplate, tells you which change to try next.
5. **Check the answers too.** A higher hit rate with much larger chunks can still produce worse answers if the model is handed too much. Confirm the improvement holds end to end.

Record where each chunk came from by section, not only by chunk number, because chunk numbers change every time you change the strategy and your question set would stop matching. [How to evaluate a RAG system](/blog/evaluate-rag-system/) expands this into a repeatable test.

If retrieval keeps missing questions that hinge on exact terms such as error codes or product names, chunking is probably not the cause. Embeddings are weak at exact matching, and [Hybrid search and reranking](/blog/hybrid-search-and-reranking/) is the fix to look at.

## Common mistakes

**Counting characters while thinking in tokens.** A splitter configured with `chunk_size=500` in characters produces chunks of roughly a hundred words, not five hundred tokens. Know which unit your splitter uses.

**Exceeding the embedding model's input limit.** The model truncates silently and the tail of every chunk becomes unsearchable. Check the limit, and remember that prepended context counts towards it.

**One strategy for every document type.** A splitter tuned for prose mangles code and tables. Route documents by type and chunk each type appropriately.

**Heavy overlap as a cure-all.** Large overlaps fill the top results with near-copies of the same passage. Fix boundaries first, then use a modest overlap.

**Throwing away structure.** Stripping headings before splitting discards free context. Keep the title and heading path with every chunk.

**Never reading the chunks.** Most chunking problems are obvious the moment you look at twenty chunks at random. Make that a step every time you change the settings.

**Changing chunking without re-indexing.** New settings apply only to newly indexed text. After a change, rebuild the whole index, or old and new chunks will be mixed.

**Tuning chunk size on a few favourite questions.** A value that fixes three questions can break ten others. Use the full question set every time.

## Frequently asked questions

### What chunk size should I start with?

Start with a few hundred tokens for prose, safely below your embedding model's input limit, then test smaller and larger values against your question set. Short factual questions tend to favour smaller chunks, and questions needing explanation favour larger ones or parent-child retrieval. The measured result on your own documents is the only answer that counts.

### Do I always need overlap?

No. Overlap protects against content being cut at a boundary. If chunks end at paragraph or section boundaries, little is cut, and a small overlap or none is fine. Fixed-size splitting needs it most.

### Is semantic chunking worth the extra cost?

Sometimes. It helps most on long unstructured text such as transcripts, where there are no headings to split on. For documentation with clear headings, structure-aware splitting is cheaper and usually performs as well. Test both on your data before paying the indexing cost.

### Can I skip chunking with a long-context model?

If the whole knowledge base fits comfortably in the model's context window, putting all of it in the prompt is a legitimate option and removes retrieval errors. Beyond that size you need retrieval, and retrieval needs chunks. Long-context embedding models allow bigger chunks, but one vector for a very long passage still blurs its topics.

### How should I chunk source code?

Split on the code's own units, such as functions, classes and methods, not on line counts, and attach the file path and enclosing class or module name to each chunk as context. A language-aware splitter or a parser for the language gives much better boundaries than a prose splitter.
