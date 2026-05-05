# VaultMind Similarity Sidecar

A small FastAPI service that computes high-quality semantic edges between
Notion pages using **chunked BGE-Small embeddings + FAISS ANN + chunk
voting + domain-aware thresholds**.

The Next.js app calls this service via HTTP. If the sidecar isn't running,
the app falls back to a pure-TS TF-IDF + concept-tag heuristic so the
graph still renders — just less accurately.

---

## Running locally

Requires Python 3.12+. The first run downloads the BGE-Small model (~134 MB).

```bash
cd backend

# Install dependencies (use uv, pip, or whatever you prefer)
pip install -e .

# Start the service on port 8000
uvicorn main:app --port 8000 --reload
```

Then in the Next.js app, set the env var so the retriever knows where to
reach it:

```
VAULTMIND_SIDECAR_URL=http://localhost:8000
```

You can confirm it's wired up by hitting `GET http://localhost:8000/healthz`
(should return `{"status":"ok"}`).

---

## What it does

`POST /similarity/build-graph`

Input — a list of `{id, title, body}` page objects.

1. **Chunk** each page into ~380-word, 50-word-overlap chunks (sentence-aware).
   The title is prepended to every chunk so it influences the embedding.
2. **Embed** every chunk with `BAAI/bge-small-en-v1.5` (384-dim, L2-normalized).
3. **FAISS ANN** — build an `IndexFlatIP` over normalized vectors (= cosine
   similarity) and run top-40 nearest-neighbor search per chunk.
4. **Chunk voting** — for each `(page_a, page_b)` pair, collect every
   cross-chunk similarity score, sort descending, and use the **top-3
   mean** as the page-pair score. Pairs with fewer than 3 votes get a
   multiplier penalty (1 vote → 0.73×, 2 votes → 0.86×). This is the core
   defense against "single shared word" false positives.
5. **Domain gate** — every page is tagged with regex domains (`us_edu`,
   `health`, `ml`, `career`, ...). Same-domain links pass at ≥ 0.45 cosine,
   cross-domain at ≥ 0.62, unknown at ≥ 0.55.
6. **Top-K per page** — at most 5 edges per node, deduplicated as undirected.

`POST /similarity/warmup` — loads the model into memory without computing
anything. The Next.js app can ping this on boot to avoid a cold-start delay
on the first user query.

---

## Tuning

You can pass overrides on each request:

- `top_k` — max neighbors per page (default 5)
- `min_chunks_for_voting` — vote count required for full score (default 3)
- `same_domain_threshold` — cosine gate for same-domain pairs (default 0.45)
- `cross_domain_threshold` — cosine gate for cross-domain pairs (default 0.62)
- `chunk_size_words` / `chunk_overlap_words` — chunking parameters

---

## Resources

- ~280 MB resident memory after model load (well within 16 GB)
- ~1–2 GB peak during embedding for ~10K chunks
- Single-threaded; embeddings run on CPU
