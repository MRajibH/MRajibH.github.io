---
title: "Hybrid search and reranking: better retrieval for RAG"
description: "Combine keyword and vector search with reciprocal rank fusion, then rerank with a cross-encoder, using PostgreSQL, Qdrant and Python examples."
date: 2026-11-15
tags: [rag-and-agents]
draft: true
---

Vector search finds text that means the same thing as the question, but it regularly misses the chunk containing the exact error code, product number or function name the user typed. Keyword search has the opposite weakness. This guide shows how to run both, merge their results with reciprocal rank fusion, and then reorder the merged list with a reranking model, so that the handful of chunks you finally send to the language model are the right ones.

The examples use PostgreSQL with pgvector, Qdrant and a small amount of Python. They assume you already have a working retrieval step; if not, start with [Build a RAG pipeline from scratch](/blog/build-rag-pipeline-from-scratch/).

## Why one retriever is not enough

There are two families of retrieval, and they fail in different places.

**Dense retrieval** is ordinary vector search. An embedding model turns each chunk and each query into a vector of a few hundred to a few thousand numbers, and nearby vectors mean similar text. It handles paraphrase well: a question about "time off" finds a chunk about "annual leave". It is weak on tokens the embedding model has no good representation for, such as `ERR_CONN_RESET_4012`, a part number, a surname or a rarely used configuration key. Those strings get squeezed into the same vector as everything around them and lose their identity.

**Sparse retrieval** is keyword search. Each document is represented by the terms it contains, weighted by how informative they are. The best-known scoring function is BM25, which rewards documents containing the query's rarer terms and discounts very long documents. It is precise on exact tokens and cannot match a paraphrase at all: "time off" does not find "annual leave".

| Query type | Dense (vector) | Sparse (keyword) |
| --- | --- | --- |
| Paraphrased question | Strong | Weak |
| Exact identifier, code or name | Weak | Strong |
| Misspelled word | Often tolerant | Usually misses |
| Domain jargon unseen in training | Unreliable | Strong if the term appears |
| Cross-language match | Possible with a multilingual model | No |

Real users send both kinds of query, often in the same sentence. Hybrid search runs both retrievers and combines the results, so each covers the other's blind spot.

## The retrieve-then-rerank pipeline

A complete retrieval stage has three steps:

1. **Retrieve candidates** with a dense search and a sparse search, taking a generous number from each, for example 30 to 50.
2. **Fuse** the two ranked lists into one.
3. **Rerank** the fused candidates with a more accurate but slower model, and keep the top few, typically 3 to 8, for the prompt.

The reason for this shape is cost. The first-stage retrievers are cheap because documents are processed once, at indexing time, and a query only needs a lookup. They are also crude, because the query and the document never see each other during scoring. A reranker reads the query and a candidate together, which is far more accurate but must be run per pair at query time. Running it on 40 candidates is affordable; running it on a whole corpus is not. So the first stage is tuned for recall (do not miss the right chunk) and the reranker for precision (put it at the top).

The candidate counts above are rough rules of thumb, not measured optima. The right values depend on your corpus and latency budget, and should be chosen with a test set.

## Reciprocal rank fusion

The two retrievers produce scores on unrelated scales. A cosine similarity lies between -1 and 1; a BM25 score is unbounded and depends on the query length. Adding them, or even normalising and then adding them, is fragile.

Reciprocal rank fusion (RRF) avoids the problem by ignoring scores and using only positions. Each document receives, from each list it appears in, a contribution of

```text
1 / (k + rank)
```

where `rank` is its position in that list and `k` is a constant that dampens the advantage of the very top positions. The contributions are summed. A document ranked highly by both retrievers beats one ranked first by only one of them, which is exactly the behaviour you want. The paper that introduced RRF used `k = 60` with ranks starting at 1, and that value is a common default, although implementations differ: Qdrant, for example, uses zero-based ranks and a smaller default constant. The exact value rarely matters much; consistency does.

RRF in Python is a few lines:

```python
from collections import defaultdict


def reciprocal_rank_fusion(ranked_lists, k=60, top_n=20):
    """Merge several ranked lists of document IDs into one.

    ranked_lists: iterable of lists, each ordered best first.
    """
    scores = defaultdict(float)
    for ranking in ranked_lists:
        for position, doc_id in enumerate(ranking, start=1):
            scores[doc_id] += 1.0 / (k + position)
    ordered = sorted(scores.items(), key=lambda item: item[1], reverse=True)
    return ordered[:top_n]


dense_hits = ["c17", "c03", "c42", "c08"]
keyword_hits = ["c42", "c99", "c17", "c51"]

for doc_id, score in reciprocal_rank_fusion([dense_hits, keyword_hits]):
    print(doc_id, round(score, 5))
```

Running it puts `c17` and `c42` at the top, because both lists contain them, followed by the documents that only one retriever found.

This function is store-agnostic. If your vector store has no keyword search, you can run the keyword side in any search engine, or in process with a BM25 library, and fuse the two ID lists in your application.

## Hybrid search in PostgreSQL with pgvector

PostgreSQL already contains a full-text search engine, so with the pgvector extension one database can do both halves. Assume a `chunks` table with a `content` column and an `embedding vector(384)` column, as in [the vector database comparison](/blog/choosing-a-vector-database/).

First add a `tsvector` column, which holds the normalised terms of each chunk, and index it. A generated column keeps it in step with `content` automatically:

```sql
ALTER TABLE chunks
    ADD COLUMN tsv tsvector
    GENERATED ALWAYS AS (to_tsvector('english', content)) STORED;

CREATE INDEX chunks_tsv_idx ON chunks USING gin (tsv);
CREATE INDEX chunks_embedding_idx ON chunks USING hnsw (embedding vector_cosine_ops);
```

`to_tsvector('english', ...)` lower-cases the text, removes common stop words and reduces words to their stems, so "running" matches "run". The GIN index makes term lookups fast.

Now a single query can run both searches as common table expressions and fuse them with RRF. `$1` is the query embedding and `$2` is the query text:

```sql
WITH semantic AS (
    SELECT id, row_number() OVER (ORDER BY embedding <=> $1) AS rank
    FROM chunks
    ORDER BY embedding <=> $1
    LIMIT 40
),
keyword AS (
    SELECT id, row_number() OVER (ORDER BY ts_rank_cd(tsv, query) DESC) AS rank
    FROM chunks, websearch_to_tsquery('english', $2) AS query
    WHERE tsv @@ query
    ORDER BY ts_rank_cd(tsv, query) DESC
    LIMIT 40
)
SELECT c.id,
       c.content,
       coalesce(1.0 / (60 + semantic.rank), 0.0)
     + coalesce(1.0 / (60 + keyword.rank), 0.0) AS rrf_score
FROM semantic
FULL OUTER JOIN keyword USING (id)
JOIN chunks AS c USING (id)
ORDER BY rrf_score DESC
LIMIT 20;
```

The `FULL OUTER JOIN` keeps documents that appear in only one list, and `coalesce` gives a missing rank a contribution of zero.

Two caveats apply to the keyword half.

`ts_rank_cd` is PostgreSQL's own ranking function. It is not BM25: it does not weigh terms by how rare they are across the corpus. It is still useful as one input to RRF, because fusion only needs a sensible ordering, but do not expect it to match a dedicated search engine.

`websearch_to_tsquery` requires every term in the query to be present. That suits short keyword queries and is too strict for a full-sentence question, which may match nothing. A simple remedy is to build an OR query from the question's terms in your application and pass it to `to_tsquery`:

```python
import re


def or_tsquery(question: str) -> str:
    """Turn free text into an OR query string for to_tsquery()."""
    terms = re.findall(r"[A-Za-z0-9_]+", question.lower())
    return " | ".join(dict.fromkeys(terms))


print(or_tsquery("Why does the VPN drop with ERR_CONN_RESET_4012?"))
# why | does | the | vpn | drop | with | err_conn_reset_4012
```

Stop words such as "the" are discarded by `to_tsquery('english', ...)`, and the ranking function then favours chunks that match more of the remaining terms.

## Hybrid search in Qdrant

Qdrant can store a dense vector and a sparse vector on the same point and fuse searches over both in a single request. A sparse vector is a list of term indices and weights; it can come from a BM25-style tokeniser or from a learned sparse model.

The query API expresses a hybrid search as a set of `prefetch` sub-queries followed by a fusion step. This example assumes a collection whose points have a named dense vector called `dense` and a named sparse vector called `sparse`:

```python
from qdrant_client import QdrantClient, models

client = QdrantClient(url="http://localhost:6333")


def hybrid_search(dense_vector, sparse_indices, sparse_values, limit=20):
    response = client.query_points(
        collection_name="chunks",
        prefetch=[
            models.Prefetch(query=dense_vector, using="dense", limit=40),
            models.Prefetch(
                query=models.SparseVector(indices=sparse_indices, values=sparse_values),
                using="sparse",
                limit=40,
            ),
        ],
        query=models.FusionQuery(fusion=models.Fusion.RRF),
        limit=limit,
        with_payload=True,
    )
    return response.points
```

Each prefetch runs independently and returns its own top 40. The outer query does no vector search of its own; it fuses the prefetched lists with RRF and returns the best `limit` points. Because everything happens inside the engine, there is one network round trip and no fusion code to maintain. Qdrant also offers a second fusion method, distribution-based score fusion, which normalises scores instead of using ranks; the [hybrid queries documentation](https://qdrant.tech/documentation/concepts/hybrid-queries/) describes both.

Filters can be attached to each prefetch, so a tenant restriction applies to both halves before fusion rather than after it.

## Reranking with a cross-encoder

Fusion gives you a candidate list in which the right chunk is very likely present. Reranking decides the final order.

The embedding models used for dense retrieval are bi-encoders: they encode the query and the document separately, and similarity is computed afterwards from two vectors. A **cross-encoder** takes the query and one document together as a single input and outputs one relevance score. Because the model can attend to both texts at once, it can tell that a chunk mentions the right keywords but answers a different question. The price is that nothing can be precomputed: every query-document pair is a full model run.

The `sentence-transformers` library provides a `CrossEncoder` class and a range of pretrained reranking models:

```bash
pip install sentence-transformers
```

```python
from sentence_transformers import CrossEncoder

reranker = CrossEncoder("cross-encoder/ms-marco-MiniLM-L6-v2")


def rerank(query: str, candidates: list[str], keep: int = 5) -> list[tuple[float, str]]:
    """Return the `keep` most relevant candidates, best first."""
    ranked = reranker.rank(query, candidates)
    return [(float(r["score"]), candidates[r["corpus_id"]]) for r in ranked[:keep]]


candidates = [
    "Annual leave is 25 days per year, plus public holidays.",
    "Leave the building by the nearest fire exit when the alarm sounds.",
    "Unused leave can be carried over until the end of March.",
]

for score, text in rerank("How many days of holiday do I get?", candidates, keep=2):
    print(f"{score:.2f}  {text}")
```

`rank` scores every candidate against the query and returns a list of dictionaries sorted by score, each with a `corpus_id` pointing back into the input list. The second candidate shares the word "leave" with the first but is about something else entirely; a keyword retriever would rank it highly, and the cross-encoder pushes it down.

Some practical points:

- **Scores are not probabilities.** Many cross-encoders output unbounded values. Use them for ordering. If you want a cut-off below which chunks are dropped, calibrate it on your own data.
- **Match the model to your content.** The model above is small and trained on English web search data. For other languages or long technical passages, choose a multilingual or larger reranker and check it against your test set.
- **Mind the input length.** A cross-encoder truncates input beyond its maximum sequence length. If your chunks are long, the end of each chunk is invisible to the reranker. Chunk size and reranker choice have to be considered together; see [RAG chunking strategies](/blog/rag-chunking-strategies/).
- **Batch on a GPU if you have one.** Reranking 40 short passages with a small model is quick on a CPU; larger models and longer passages benefit greatly from a GPU.

Hosted reranking APIs exist as well and follow the same contract: send a query and a list of documents, get back an ordering. The pipeline shape does not change.

## Common mistakes

**Adding hybrid search without measuring.** Hybrid search and reranking each add latency and moving parts. Build a test set first, record recall and ranking metrics for plain vector search, and adopt each addition only if the numbers improve. [How to evaluate a RAG system](/blog/evaluate-rag-system/) covers the method.

**Combining raw scores.** Summing a cosine similarity and a BM25 score lets whichever scale is larger dominate. Use rank-based fusion, or a normalising method designed for the purpose.

**Too few candidates.** If each retriever returns only five results, fusion has little to work with and the reranker cannot rescue a chunk that was never retrieved. Retrieve widely, then cut down.

**Too many chunks after reranking.** The point of reranking is to send fewer, better chunks. Passing all 40 to the language model wastes context and gives it more irrelevant text to be distracted by.

**Keyword queries that match nothing.** A strict AND query built from a full sentence often returns zero rows, silently turning hybrid search back into vector search. Log how many results each retriever returns so this is visible.

**Language mismatch in the keyword half.** Stemming and stop-word rules are per language. Indexing German text with the `english` configuration, or tokenising code identifiers with rules written for prose, quietly degrades the keyword side.

**Applying permission filters after fusion.** Filter inside each retriever. Filtering afterwards shrinks the candidate list unpredictably and risks leaking restricted text into logs or the reranker.

## Frequently asked questions

### Do I need hybrid search if my vector search already works well?

Check your failures before deciding. If the missed queries contain identifiers, names, version numbers or rare terms, hybrid search will probably help. If the corpus is conversational prose and the queries are natural questions, the gain may be small, and reranking alone could be the better investment.

### Should I add hybrid search or reranking first?

Reranking is usually the simpler first step, because it needs no change to your index: retrieve more candidates than before and reorder them. Add the keyword retriever when you see queries where the right chunk is not among the candidates at all, since a reranker can only reorder what was retrieved.

### How much latency does reranking add?

It depends on the model size, the number and length of candidates, and the hardware, so any single figure would be misleading. Measure it on your own setup. The levers, in order of effect, are fewer candidates, shorter chunks, a smaller model, and a GPU.

### Can I weight one retriever more than the other?

Yes. Weighted variants of RRF multiply each list's contribution by a weight, and some engines expose this directly. Only tune weights against a test set with a held-out portion; without one, equal weights are the safer choice.

### Does hybrid search replace good chunking?

No. Retrieval can only return chunks that exist. If the answer is split across two chunks or buried in a chunk that mixes several topics, no ranking method will fix it. Chunking, retrieval and reranking are separate stages, and each sets a ceiling for the ones after it.
