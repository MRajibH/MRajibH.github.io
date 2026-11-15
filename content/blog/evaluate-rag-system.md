---
title: "How to evaluate a RAG system: metrics, test sets and tooling"
description: "Build a test set, measure retrieval with recall and MRR, score answers for faithfulness with an LLM judge, and run it all as a regression check."
date: 2026-11-15
tags: [rag-and-agents]
art:
  kind: flow
  caption: "An evaluation run scores retrieval and the final answer separately."
  items: ["Test questions", "Retrieve", "Generate", "Score"]
draft: true
---

A retrieval-augmented generation (RAG) system can look fine in a demo and still give wrong answers to a third of real questions, and without measurement you cannot tell whether a change to the chunk size, the embedding model or the prompt made things better or worse. This guide shows how to build a test set, measure the retrieval and generation stages separately with a few dozen lines of Python, and turn the result into a check you can run after every change.

The code is plain Python with no evaluation framework, so you can see what each metric actually computes. Frameworks are covered near the end.

## Evaluate the two stages separately

A RAG system does two things: it retrieves chunks of text for a question, then a language model writes an answer from those chunks. A wrong answer has one of two causes.

- **Retrieval failure.** The chunk containing the answer was never retrieved, so the model had nothing to work with.
- **Generation failure.** The right chunk was retrieved, but the model ignored it, misread it, or added claims that are not in it.

The fixes are completely different. Retrieval failures are fixed by changing chunking, the embedding model, the search method or the number of results. Generation failures are fixed by changing the prompt, the model or how the context is formatted. If you only measure the final answer, you know that something is wrong but not where, and you will spend time tuning the wrong stage.

So the evaluation has two layers:

| Layer | Question it answers | Needs an LLM to score? | Typical metrics |
| --- | --- | --- | --- |
| Retrieval | Did the right chunks come back, and how high? | No | Recall@k, precision@k, MRR |
| Generation | Is the answer supported by the chunks, and does it address the question? | Usually yes | Faithfulness, answer relevance, correctness |

Retrieval metrics are cheap, deterministic and fast, so start there. In practice a large share of bad answers trace back to retrieval, and an answer metric cannot be good if the context is wrong.

## Build a test set first

Every metric below needs a test set: a list of questions, each with the information required to judge the system's output. This is the most valuable artefact in the whole exercise and worth doing carefully.

Each test case should have:

- **A question**, phrased the way a real user would ask it.
- **The IDs of the chunks or documents that contain the answer.** This is what makes retrieval measurable without a language model.
- **A reference answer**, short and factual, written or checked by a person.

A simple JSON Lines file, one case per line, is enough:

```json
{"id": "q001", "question": "How many days of annual leave do employees get?", "relevant_ids": ["handbook-12"], "reference": "25 days per year, plus public holidays."}
{"id": "q002", "question": "What is the deadline for filing expenses?", "relevant_ids": ["handbook-31", "finance-faq-4"], "reference": "Within 30 days of the purchase."}
{"id": "q003", "question": "What is the company's policy on bringing pets to the office?", "relevant_ids": [], "reference": "The documents do not cover this."}
```

### Where the questions come from

In order of value:

1. **Real questions.** Support tickets, search logs, chat history from a pilot. These reflect how people actually phrase things, including vague and badly formed questions.
2. **Questions written by people who know the content.** Ask subject experts for the questions they are asked most often and the ones they would expect the system to get wrong.
3. **Synthetic questions.** Give a language model a chunk and ask it to write a question that the chunk answers. This scales well and gives you the relevant chunk ID for free, but the questions tend to reuse the chunk's own wording, which makes retrieval look better than it is. Review them by hand and rewrite the ones that are too easy.

### What a good test set covers

Include the awkward cases deliberately, because averages hide them:

- Questions whose answer needs two chunks from different documents.
- Questions containing exact identifiers, such as error codes or product names.
- Questions phrased very differently from the source text.
- Questions the documents cannot answer, like `q003` above. The correct behaviour is to say so, and a system that invents an answer here has a serious fault.

As a rough rule of thumb, 50 to 100 well-chosen cases are enough to see the effect of most changes, and a few hundred give steadier numbers. A small set you trust beats a large one you have not read.

One warning: chunk IDs change when you change the chunking strategy. If you are comparing chunking approaches, label relevance at the document or section level, or by a text span, so the labels survive re-chunking. [RAG chunking strategies](/blog/rag-chunking-strategies/) discusses the options you may want to compare.

## Measure retrieval

Retrieval metrics compare the ranked list of IDs your retriever returns against the `relevant_ids` in the test set. `k` is how many results you look at, normally the number of chunks you put in the prompt.

- **Recall@k**: of all the relevant chunks, what fraction appear in the top `k`? This is the most important number, because a chunk that is not retrieved cannot be used.
- **Precision@k**: of the top `k` results, what fraction are relevant? Low precision means the prompt is full of noise.
- **Hit rate@k**: did at least one relevant chunk appear in the top `k`? Simpler than recall, and identical to it when each question has one relevant chunk.
- **MRR** (mean reciprocal rank): take 1 divided by the position of the first relevant result (1 for first place, 0.5 for second, and so on, 0 if absent), averaged over all questions. It tells you whether relevant chunks appear near the top or only just make the cut.

Here is a complete evaluator. `retrieve` is the only part specific to your system: a function that takes a question and returns a ranked list of chunk IDs.

```python
import json
from statistics import mean


def load_cases(path):
    with open(path, encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def recall_at_k(retrieved, relevant, k):
    if not relevant:
        return None  # undefined for unanswerable questions
    found = len(set(retrieved[:k]) & set(relevant))
    return found / len(relevant)


def precision_at_k(retrieved, relevant, k):
    top = retrieved[:k]
    if not top:
        return 0.0
    return len([doc_id for doc_id in top if doc_id in relevant]) / len(top)


def reciprocal_rank(retrieved, relevant):
    for position, doc_id in enumerate(retrieved, start=1):
        if doc_id in relevant:
            return 1.0 / position
    return 0.0


def evaluate_retrieval(cases, retrieve, k=5):
    rows = []
    for case in cases:
        relevant = set(case["relevant_ids"])
        if not relevant:
            continue  # scored separately, in the generation stage
        retrieved = retrieve(case["question"])
        rows.append(
            {
                "id": case["id"],
                "recall": recall_at_k(retrieved, relevant, k),
                "precision": precision_at_k(retrieved, relevant, k),
                "rr": reciprocal_rank(retrieved, relevant),
            }
        )
    summary = {
        f"recall@{k}": mean(row["recall"] for row in rows),
        f"precision@{k}": mean(row["precision"] for row in rows),
        "mrr": mean(row["rr"] for row in rows),
        "cases": len(rows),
    }
    return summary, rows


if __name__ == "__main__":
    def retrieve(question):
        # Replace with a call to your retriever. It must return chunk IDs, best first.
        return ["handbook-12", "handbook-40", "finance-faq-4"]

    summary, rows = evaluate_retrieval(load_cases("testset.jsonl"), retrieve, k=5)
    print(json.dumps(summary, indent=2))
    for row in rows:
        if row["recall"] < 1.0:
            print("missed:", row["id"])
```

The list of missed cases at the end matters more than the averages. Read every failure. Patterns appear quickly: all the misses contain an identifier, or come from one document type, or need two chunks. That tells you what to change. Misses on exact identifiers, for instance, point towards the techniques in [Hybrid search and reranking](/blog/hybrid-search-and-reranking/).

### Reading the numbers

Recall@k and precision@k pull against each other as `k` grows: more results raise recall and lower precision. Report both at the `k` you actually use. A sensible sequence is to raise recall first, by retrieving more candidates or improving the search, and then recover precision by reranking and trimming.

There is no universal target value. Compare against your own baseline: record the numbers for the current system, change one thing, and run again.

## Measure the generated answer

Answer quality has several distinct dimensions, and it helps to name them separately.

- **Faithfulness** (also called groundedness): is every claim in the answer supported by the retrieved context? An unfaithful answer contains hallucinated content, meaning statements the model produced without support in the sources.
- **Answer relevance**: does the answer address the question that was asked, without padding or evasion?
- **Correctness**: does the answer agree with the reference answer?
- **Refusal behaviour**: when the context does not contain the answer, does the system say so?

These are different. An answer can be faithful to the context but wrong, if retrieval returned an outdated document. It can be correct but unfaithful, if the model answered from its training data rather than the sources, which is luck rather than a working system.

Free-text answers cannot be compared with string matching, because many different wordings are equally right. The common approach is to use a language model as a judge: give it the question, the context and the answer, and ask for a verdict against a written rubric.

### An LLM judge for faithfulness

The script below works against any server that implements the OpenAI-compatible chat completions API, including local ones; see [Run an LLM locally with Ollama](/blog/run-llm-locally-with-ollama/) for a setup that keeps your evaluation data on your own machine.

```python
import json
import os

from openai import OpenAI

client = OpenAI(
    base_url=os.environ.get("JUDGE_BASE_URL", "http://localhost:11434/v1"),
    api_key=os.environ.get("JUDGE_API_KEY", "not-needed-for-local"),
)
JUDGE_MODEL = os.environ.get("JUDGE_MODEL", "llama3.1")

RUBRIC = """You are grading an answer produced by a question-answering system.

Decide whether every factual claim in the ANSWER is supported by the CONTEXT.
Ignore whether the answer is well written. Do not use outside knowledge.

Reply with a JSON object with exactly these keys:
  "unsupported_claims": a list of claims in the answer that the context does not support
  "verdict": "pass" if the list is empty, otherwise "fail"
"""


def judge_faithfulness(question, context, answer):
    response = client.chat.completions.create(
        model=JUDGE_MODEL,
        temperature=0,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": RUBRIC},
            {
                "role": "user",
                "content": f"QUESTION:\n{question}\n\nCONTEXT:\n{context}\n\nANSWER:\n{answer}",
            },
        ],
    )
    try:
        result = json.loads(response.choices[0].message.content)
    except json.JSONDecodeError:
        return {"verdict": "error", "unsupported_claims": []}
    if result.get("verdict") not in ("pass", "fail"):
        result["verdict"] = "error"
    return result


if __name__ == "__main__":
    print(
        judge_faithfulness(
            question="How many days of annual leave do employees get?",
            context="Employees receive 25 days of annual leave per year.",
            answer="You get 25 days of annual leave, and unused days are paid out in cash.",
        )
    )
```

A capable judge model should fail this example and list the claim about cash payment, which the context never mentions. If your server rejects the `response_format` parameter, remove it; the rubric still asks for JSON and the `try` block handles a malformed reply.

Several design choices in that rubric are deliberate:

- **One criterion per judge call.** A prompt that asks for faithfulness, relevance and tone at once produces muddled scores. Write one rubric per dimension.
- **A binary verdict with reasons.** Pass or fail is more consistent between runs than a score from 1 to 10, where the difference between a 6 and a 7 is undefined. Asking for the list of unsupported claims first makes the model do the analysis before committing to a verdict, and gives you something to read when you disagree.
- **Temperature 0.** You want the same input to give the same verdict as far as possible.
- **An explicit instruction not to use outside knowledge.** Otherwise the judge marks true-but-unsupported claims as fine.

The same pattern covers the other dimensions. For correctness, give the judge the reference answer instead of the context and ask whether the answer agrees with it on the facts. For refusal behaviour, run the unanswerable cases and ask whether the answer declines rather than inventing something.

### Check the judge

A judge is a model and makes mistakes. Before trusting its numbers, label 30 to 50 answers yourself, run the judge on the same answers, and compare. If you and the judge disagree often, tighten the rubric or use a stronger model. Repeat this spot check whenever you change the judge model or its prompt, because either can shift every score.

Avoid using the same model as both generator and judge where you can; a model tends to be lenient towards output that resembles its own.

## Turn it into a regression check

Evaluation pays off when it runs routinely. The aim is a single command that produces a small table of numbers and fails loudly when they drop.

A workable routine:

1. **Freeze a baseline.** Run the full evaluation on the current system and save the summary as a JSON file in the repository.
2. **Change one thing at a time.** Chunk size, embedding model, `k`, prompt wording. Changing several at once tells you nothing about which one mattered.
3. **Compare against the baseline.** Fail the run if a key metric falls by more than a tolerance you choose.
4. **Read the per-case differences.** An unchanged average can hide five cases that got better and five that got worse.

A minimal gate looks like this:

```python
import json
import sys

TOLERANCE = 0.03  # allow small run-to-run variation

baseline = json.load(open("eval/baseline.json", encoding="utf-8"))
current = json.load(open("eval/current.json", encoding="utf-8"))

failed = False
for metric, old_value in baseline.items():
    if metric == "cases":
        continue
    new_value = current[metric]
    change = new_value - old_value
    print(f"{metric:16} {old_value:.3f} -> {new_value:.3f} ({change:+.3f})")
    if change < -TOLERANCE:
        failed = True

sys.exit(1 if failed else 0)
```

Retrieval metrics are deterministic, so they can run on every commit. Judge-based metrics cost model calls and vary slightly between runs, so many teams run them less often, for example before a release, and treat small movements as noise. The tolerance value above is illustrative; choose yours by running the unchanged system a few times and seeing how much the scores move by themselves.

Keep the test set under version control alongside the code, and add a case whenever a real user reports a bad answer. Over time the set becomes a record of every failure the system has had.

## Tooling

You do not have to write everything yourself. Evaluation frameworks package the metrics above, along with test set generation and reporting.

[Ragas](https://docs.ragas.io/) is a widely used open-source library focused on RAG. Its metric list maps directly onto the concepts in this article: Context Precision and Context Recall for the retrieval stage, Faithfulness and Response Relevancy for the answer, and Noise Sensitivity for how much irrelevant context disturbs the answer. Other open-source projects, such as DeepEval and promptfoo, take a test-runner approach in which cases and assertions are declared and executed like unit tests.

Whichever you pick, the same rules apply:

- **Know what each metric computes.** Most framework metrics are LLM-judge prompts underneath. Read the definition before relying on the number.
- **Pin versions.** Metric implementations and default prompts change between releases, which changes scores. Record the framework version and judge model with every result.
- **Keep the deterministic retrieval metrics.** They need no model, cost nothing and catch most regressions.

Starting with the hand-written scripts above and moving to a framework once you know which metrics you care about is a reasonable path, and it means you can check the framework's numbers against your own.

## Common mistakes

**Measuring only the final answer.** Without separate retrieval metrics you cannot tell which stage failed. Always log the retrieved chunk IDs for every test case.

**A test set made only of easy synthetic questions.** Questions generated from a chunk echo its vocabulary, so retrieval scores look excellent and then collapse on real traffic. Mix in real and hand-written questions.

**Tuning on the test set until it passes.** If you adjust prompts and parameters against the same 50 questions for weeks, the system becomes fitted to those questions. Hold back a portion that you look at rarely, and refresh the set with new real questions.

**No unanswerable questions.** A system that is never tested on missing information is never tested on its most damaging failure mode, confident invention.

**Trusting the judge blindly.** An unvalidated judge can be systematically lenient or strict. Compare it with human labels before using it as a gate.

**Comparing scores across different judges.** A faithfulness score from one judge model is not comparable with a score from another. When the judge changes, re-run the baseline.

**Ignoring cost and latency.** A change that raises recall by doubling response time may not be an improvement. Record time per query and tokens used alongside the quality metrics.

## Frequently asked questions

### How many test questions do I need?

Enough to cover the kinds of question your users ask, including the awkward ones. As a rough guide, 50 to 100 carefully chosen cases let you see the effect of most changes. More cases reduce noise, but coverage of different question types matters more than raw count.

### Can I evaluate without reference answers?

Partly. Retrieval metrics need only the relevant chunk IDs, and faithfulness needs only the retrieved context and the answer. Correctness does need a reference. If writing references for everything is too slow, write them for a subset and use the reference-free metrics for the rest.

### Is an LLM judge reliable enough?

It is reliable enough to detect regressions and compare two versions of a system, provided you have checked it against human labels on a sample and you keep the judge model and prompt fixed. It is not a substitute for people reading a sample of answers, particularly in domains where a wrong answer is costly.

### Which metric should I improve first?

Recall at the `k` you use. If the right chunk is not retrieved, nothing downstream can fix it. Once recall is acceptable, work on precision and ranking, then on faithfulness.

### How often should the evaluation run?

Run the retrieval metrics on every change to chunking, indexing or search code, since they are fast and free. Run the judge-based metrics before releases and after any change to the prompt or generation model. Also re-run everything when the document corpus changes substantially, because new content can crowd out old answers.
