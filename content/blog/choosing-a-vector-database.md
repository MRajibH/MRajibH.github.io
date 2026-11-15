---
title: "pgvector vs Qdrant vs Chroma: choosing a vector database"
description: "Compare pgvector, Qdrant and Chroma on indexing, filtering, operations and scale, with working setup commands and queries for each one."
date: 2026-11-15
tags: [rag-and-agents]
art:
  kind: compare
  caption: "Three vector stores and where each one lives."
  items: ["pgvector | Inside PostgreSQL", "Qdrant | Dedicated server", "Chroma | Embedded, quick start"]
---

Every retrieval-augmented generation (RAG) system needs somewhere to store embeddings and find the nearest ones quickly, and the choice of store shapes how you deploy, filter, back up and scale the whole system. This guide compares three popular open-source options, pgvector, Qdrant and Chroma, by running the same small workload on each and looking at what differs. By the end you will be able to pick one for your project and explain why.

If the pipeline around the store is still new to you, read [Build a RAG pipeline from scratch](/blog/build-rag-pipeline-from-scratch/) first. This article assumes you already have text chunks and an embedding model.

## The short answer

The three tools sit at different points on the same line, from "a library inside your application" to "a dedicated search service".

| | pgvector | Qdrant | Chroma |
| --- | --- | --- | --- |
| What it is | An extension for PostgreSQL | A standalone vector search engine | An embedding database that can run inside your Python process or as a server |
| How you talk to it | SQL | REST or gRPC API, official clients | Python or JavaScript client |
| Approximate index | HNSW or IVFFlat | HNSW | HNSW on a single node |
| Metadata filtering | Ordinary `WHERE` clauses | Payload filters, with payload indexes | `where` dictionaries on metadata |
| Runs without a server | No, needs PostgreSQL | Yes, the Python client has a local mode | Yes, in memory or persisted to a folder |
| Best fit | You already run PostgreSQL and want vectors next to relational data | Vector search is a core, heavily used feature with selective filters | Prototypes, notebooks and small applications |

A reasonable default: if your application already has a PostgreSQL database, start with pgvector, because you add a capability rather than a new system. Choose Qdrant when vector search is the main workload and you want it to scale and be tuned independently of your transactional database. Choose Chroma when you want the least setup between an idea and a working retrieval loop.

The rest of this article explains what sits behind those recommendations.

## What all three have in common

A vector database stores points. Each point has an identifier, a vector (the embedding), and some attached data: the original text and metadata such as a source file, a tenant ID or a date. A query supplies another vector and asks for the `k` stored vectors closest to it under a distance measure.

Three distance measures cover almost every embedding model:

- **Cosine distance** compares direction and ignores length. It is the usual choice for text embeddings.
- **Inner product** (dot product) is equivalent to cosine when vectors are normalised to length 1, and slightly cheaper to compute.
- **Euclidean distance** (L2) is straight-line distance.

Use the measure your embedding model was trained for; its documentation or model card will say which. Mixing them up does not raise an error, it just returns worse results.

Comparing a query against every stored vector is called exact search. It always returns the true nearest neighbours, but its cost grows with the size of the collection. To stay fast on large collections, all three tools offer approximate nearest neighbour (ANN) search using HNSW, short for Hierarchical Navigable Small World. HNSW builds a layered graph in which each vector links to some of its neighbours, and a search walks the graph towards the query instead of scanning everything. The trade is recall for speed: an approximate search may miss a few true neighbours. Recall here means the fraction of the true top `k` results that the index actually returned.

Because the core algorithm is shared, the practical differences are elsewhere: how filters interact with the index, how the system is operated, and what else it can store.

## pgvector: vectors inside PostgreSQL

[pgvector](https://github.com/pgvector/pgvector) adds a `vector` column type, distance operators and two index types to PostgreSQL. The project publishes a container image with the extension already installed:

```bash
docker run -d --name pgvector \
  -e POSTGRES_PASSWORD=change-me \
  -p 127.0.0.1:5432:5432 \
  pgvector/pgvector:pg18-trixie

docker exec -it pgvector psql -U postgres
```

Enable the extension once per database, then create a table. The number in `vector(384)` is the dimension, which must match your embedding model's output size.

```sql
CREATE EXTENSION vector;

CREATE TABLE chunks (
    id        bigserial PRIMARY KEY,
    source    text NOT NULL,
    tenant_id integer NOT NULL,
    content   text NOT NULL,
    embedding vector(384) NOT NULL
);
```

A query orders by a distance operator. pgvector defines `<->` for Euclidean distance, `<=>` for cosine distance, `<#>` for negative inner product and `<+>` for L1 distance. The inner product operator returns the negative value because PostgreSQL index scans only support ascending order.

```sql
SELECT id, source, content, embedding <=> $1 AS distance
FROM chunks
WHERE tenant_id = 42
ORDER BY embedding <=> $1
LIMIT 5;
```

Without an index this is an exact search, which is perfectly adequate for small tables and gives perfect recall. When it becomes too slow, add an HNSW index. The operator class in the index must match the operator in your queries, or the index will not be used:

```sql
CREATE INDEX ON chunks USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);
```

`m` is the maximum number of links per node and `ef_construction` is the size of the candidate list while building; the values shown are the defaults. Larger values improve recall at the cost of build time and memory. At query time, `hnsw.ef_search` (default 40) controls how many candidates a search keeps:

```sql
SET hnsw.ef_search = 100;
```

pgvector also offers IVFFlat, which groups vectors into lists and searches only the closest lists. It builds faster and uses less memory than HNSW but gives a worse speed-to-recall trade-off, and it should be created after the table has data. For most RAG workloads HNSW is the better starting point.

### Filtering and its catch

The strength of pgvector is that a filter is just SQL. You can join to a permissions table, filter on a date range and order by distance in one statement, with transactions and foreign keys intact.

The catch is how approximate indexes combine with filters. With an HNSW index, the filter is applied after the index scan. If the index returns 40 candidates and only a tenth of the table matches `tenant_id = 42`, you may get four rows back instead of five. pgvector 0.8.0 added iterative index scans to address this: the scan keeps going until enough rows pass the filter.

```sql
SET hnsw.iterative_scan = strict_order;
```

For filters with a few distinct values, a partial index per value works well; for many values, partition the table. Also index the filter column itself with a normal B-tree index, since for very selective filters PostgreSQL may do better with an exact scan over the few matching rows.

### Limits to know

An HNSW or IVFFlat index on a `vector` column supports up to 2,000 dimensions. Larger embeddings can be indexed as half-precision `halfvec` (up to 4,000 dimensions), or reduced in size if the model supports shorter outputs. Index builds are memory-hungry; raising `maintenance_work_mem` for the build session so the graph fits in memory makes a large difference to build time.

## Qdrant: a dedicated search engine

[Qdrant](https://qdrant.tech/documentation/) is a standalone service written in Rust. It stores points in collections and exposes a REST API on port 6333 and a gRPC API on port 6334.

```bash
docker run -d --name qdrant \
  -p 127.0.0.1:6333:6333 -p 127.0.0.1:6334:6334 \
  -v "$(pwd)/qdrant_storage:/qdrant/storage" \
  qdrant/qdrant

pip install qdrant-client
```

The attached data on each point is called the payload, and it is a JSON object.

```python
from qdrant_client import QdrantClient, models

client = QdrantClient(url="http://localhost:6333")

client.create_collection(
    collection_name="chunks",
    vectors_config=models.VectorParams(size=384, distance=models.Distance.COSINE),
)

# Index the fields you will filter on before loading data.
client.create_payload_index(
    collection_name="chunks",
    field_name="tenant_id",
    field_schema=models.PayloadSchemaType.INTEGER,
)

client.upsert(
    collection_name="chunks",
    points=[
        models.PointStruct(
            id=1,
            vector=[0.01] * 384,
            payload={"tenant_id": 42, "source": "handbook.md", "content": "Leave policy text"},
        ),
    ],
)

hits = client.query_points(
    collection_name="chunks",
    query=[0.01] * 384,
    query_filter=models.Filter(
        must=[models.FieldCondition(key="tenant_id", match=models.MatchValue(value=42))]
    ),
    limit=5,
).points

for hit in hits:
    print(hit.score, hit.payload["source"])
```

The placeholder vectors of `0.01` stand in for real embeddings so that the script runs on its own; replace them with the output of your model.

### Why the payload index matters

Qdrant's main architectural difference from pgvector is how it handles filters. Its HNSW graph is filter-aware: when payload indexes exist, the graph is built with extra links so that a search restricted to, say, one tenant can still navigate the graph, and filtering happens during the search rather than after it. That avoids the "asked for five, got four" problem without extra settings.

This only works if the payload index exists when the vector index is built, which is why the example creates it before the upsert. Qdrant's documentation states that payload indexes should be created before ingesting data; adding one later means the HNSW index has to be rebuilt to benefit.

### Other things you get

Because it is a purpose-built engine, Qdrant includes features that would be separate work elsewhere: named vectors (several embeddings per point), sparse vectors for keyword-style retrieval, built-in fusion of several searches in one request, and vector quantization to reduce memory use. The first three are what make it convenient for the techniques in [Hybrid search and reranking](/blog/hybrid-search-and-reranking/).

The Python client also has a local mode that needs no server, which is useful in tests:

```python
client = QdrantClient(":memory:")          # gone when the process exits
client = QdrantClient(path="./qdrant_db")  # persisted to a folder
```

The cost of Qdrant is that it is one more service to run, secure, monitor and back up, and your vectors live apart from your relational data. Anything that must stay consistent between the two, such as deleting a user's documents, becomes your application's job.

## Chroma: the shortest path to a working prototype

[Chroma](https://docs.trychroma.com/) is designed to be easy to start with. It runs inside your Python process, stores data in a folder, and will even compute embeddings for you with a built-in default model if you pass raw text.

```bash
pip install chromadb
```

```python
import chromadb

client = chromadb.PersistentClient(path="./chroma_db")

collection = client.get_or_create_collection(
    name="chunks",
    configuration={"hnsw": {"space": "cosine"}},
)

collection.upsert(
    ids=["handbook-1", "handbook-2"],
    documents=[
        "Annual leave is 25 days per year.",
        "Expenses must be filed within 30 days.",
    ],
    metadatas=[
        {"tenant_id": 42, "source": "handbook.md"},
        {"tenant_id": 42, "source": "handbook.md"},
    ],
)

results = collection.query(
    query_texts=["How many holidays do I get?"],
    n_results=2,
    where={"tenant_id": 42},
)

print(results["documents"][0])
print(results["distances"][0])
```

Two details in that snippet are worth understanding.

First, the distance measure. Chroma's default `space` is `l2`, not cosine. If your embedding model expects cosine similarity, set it when the collection is created, as above; the space is fixed at creation.

Second, embeddings. Passing `documents` and `query_texts` lets Chroma embed the text itself. That is convenient, but it means the model is chosen by the collection's embedding function. For a real project, either configure the embedding function explicitly or compute embeddings yourself and pass `embeddings=` and `query_embeddings=`, so the model is a decision you made rather than a default you inherited.

Metadata filters are dictionaries with operators such as `$eq`, `$gt`, `$in`, `$and` and `$or`:

```python
collection.query(
    query_texts=["expense deadline"],
    n_results=3,
    where={"$and": [{"tenant_id": 42}, {"source": {"$in": ["handbook.md", "faq.md"]}}]},
)
```

When several processes need the same data, run Chroma as a server with `chroma run --path ./chroma_db` (it listens on port 8000 by default) and connect to it with an HTTP client instead of the persistent client.

Chroma gives you fewer tuning and operational controls than the other two, and metadata is limited to simple values rather than arbitrary relational structure. That is the price of the simple interface, and for a prototype or an internal tool with a modest corpus it is usually a fair one.

## How to decide

Work through these questions in order. The first one that gives a clear answer is usually enough.

1. **Do you already operate PostgreSQL?** If yes, pgvector means no new service, backups you already trust, and joins between vectors and business data. Start there and move only when you measure a problem.
2. **Is heavy filtering central to every query?** Multi-tenant search, where every query is restricted to one customer's data, is the typical case. Qdrant's filter-aware index is built for this. pgvector handles it too, with iterative scans, partial indexes or partitioning, but you design for it.
3. **Do you need hybrid dense and sparse retrieval in the store itself?** Qdrant supports it in one query. In PostgreSQL you combine pgvector with built-in full-text search in SQL. Both work; the Qdrant route involves less hand-written logic.
4. **Is this a prototype, a notebook or a small single-user tool?** Chroma gets you to a working retrieval loop fastest, and its API is small enough to learn in an afternoon.
5. **How large will the collection get?** Every option here handles the tens or hundreds of thousands of chunks that a typical documentation or knowledge-base corpus produces. As a rough rule of thumb, the choice only starts to be driven by scale once you reach many millions of vectors, and at that point you should benchmark with your own data rather than trust anyone's published figures.

Whatever you choose, keep the store behind a small interface in your code: one function to upsert chunks and one to search. The embedding model and chunking strategy affect answer quality far more than the store does, and a thin interface keeps a later migration to a weekend's work.

## Common mistakes

**Mismatched distance measure.** The index is built for cosine but the query uses the Euclidean operator, or a Chroma collection is left on the default `l2` while the model expects cosine. In pgvector a mismatch means the index is silently skipped and queries get slow; elsewhere it means lower quality results. Decide the measure once and write it down next to the model name.

**Changing the embedding model without re-embedding.** Vectors from two different models are not comparable, even when the dimensions happen to match. A model change means a new collection or table and a full re-embed. Store the model name alongside the data so this is detectable.

**Filtering after the fact.** Fetching the top 5 and then discarding rows the user may not see returns too few results and, worse, tempts you to skip the check. Put the permission filter in the query itself, in all three tools.

**Forgetting payload or column indexes.** A filter on an unindexed field forces extra work on every query. In Qdrant, create payload indexes before ingestion. In PostgreSQL, add a B-tree index on filter columns.

**Tuning before measuring.** Raising `ef_search` or `m` without a test set is guesswork. Build a small set of queries with known correct chunks and measure recall before and after; [How to evaluate a RAG system](/blog/evaluate-rag-system/) shows how.

**Exposing the database port.** None of these should be reachable from the internet. The Docker commands above bind to `127.0.0.1` for that reason. Put the store on a private network and enable authentication where it is offered.

## Frequently asked questions

### Do I need a vector database at all?

Not always. For a few thousand chunks, keeping embeddings in a NumPy array and computing similarity by brute force is fast and has no moving parts. A database earns its place when you need persistence, concurrent access, metadata filtering or more vectors than comfortably fit an in-memory scan.

### Is approximate search accurate enough for RAG?

Usually, yes. RAG retrieves several chunks and lets the language model pick out what matters, so missing the occasional true neighbour is rarely visible. If you need a guarantee, exact search is available in all three: skip the index in pgvector, or query a small filtered subset where an exact scan is cheap.

### Can I move from one store to another later?

Yes, and it is less painful than it sounds. The expensive asset is the embeddings, and those are just arrays of numbers with an ID and metadata. Export them, load them into the new store, rebuild the index and rerun your evaluation set. Keeping the original text and metadata in a system of record outside the vector store makes this simpler still.

### Which one is fastest?

It depends on the dataset, vector size, filter selectivity, hardware and the recall you require, which is why this article quotes no benchmark numbers. Published benchmarks are a starting point at best. Load a sample of your own data into your two leading candidates and measure latency at the recall level you need.

### Should embeddings live in the same database as my application data?

It is convenient when they do: one transaction can insert a document and its chunks, and one delete removes both. That is the main argument for pgvector. Separate stores make sense when the search workload needs to scale or be tuned on its own, at the cost of keeping the two in sync yourself.
