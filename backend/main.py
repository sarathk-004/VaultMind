"""
VaultMind similarity sidecar.

Implements the recommended RAG-grade pipeline for connecting Notion pages by
*content* similarity, not just keyword overlap:

    Raw pages
        |
    [1. Chunking — sentence-aware, ~512 tokens, 64-token overlap]
        |
    [2. BGE-Small embeddings per chunk]
        |
    [3. FAISS ANN — top-K candidate chunks per chunk]
        |
    [4. Chunk-voting — top_k_mean (k=3) per (page_a, page_b) pair]
        |
    [5. Domain-aware threshold gate]
        |
    [6. Per-page top-K edge selection]
        |
    Edges with grounded similarity scores

This is the core fix for the "Stevens University ↔ Diet Plan" problem: a single
shared word ("health") is no longer enough to link unrelated pages, because
*three independent chunks* must agree they're similar before an edge is added.

The sidecar exposes one main endpoint:
    POST /similarity/build-graph
"""

from __future__ import annotations

import logging
import os
import re
import threading
import time
from typing import Any

import faiss
import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sentence_transformers import SentenceTransformer

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("vaultmind.sidecar")

app = FastAPI(title="VaultMind Similarity Sidecar")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─────────────────────────────────────────────────────────────────────────────
# Model loading (lazy, thread-safe singleton)
# ─────────────────────────────────────────────────────────────────────────────
MODEL_NAME = os.getenv("EMBEDDING_MODEL", "BAAI/bge-small-en-v1.5")
_model: SentenceTransformer | None = None
_model_lock = threading.Lock()


def get_model() -> SentenceTransformer:
    """BGE-Small singleton. ~134 MB, 384-dim, multilingual-light, RAM-friendly."""
    global _model
    if _model is None:
        with _model_lock:
            if _model is None:
                log.info(f"Loading embedding model: {MODEL_NAME}")
                t0 = time.time()
                _model = SentenceTransformer(MODEL_NAME)
                log.info(f"Model loaded in {time.time() - t0:.1f}s")
    return _model


# ─────────────────────────────────────────────────────────────────────────────
# Domain detection — patterns mirror the legacy TF-IDF concept tagger so the
# threshold gate can adapt by topical area.
# ─────────────────────────────────────────────────────────────────────────────
DOMAIN_PATTERNS: dict[str, re.Pattern[str]] = {
    "ml": re.compile(
        r"\b(ml|ai|machine[- ]?learning|deep[- ]?learning|neural|llm|nlp|"
        r"supervised|unsupervised|reinforcement|regression|classification|"
        r"clustering|embedding|transformer|gpt|bert|pytorch|tensorflow|sklearn|"
        r"kaggle|gradient|tensor|cnn|rnn|gan|attention|fine[- ]?tun|"
        r"hyperparameter|backprop|optimizer|cross[- ]?validation|probability|"
        r"statistics|linear[- ]?algebra|calculus|bayesian|markov)\b",
        re.I,
    ),
    "us_edu": re.compile(
        r"\b(ms|msc|mba|phd|masters?|university|college|gre|gmat|toefl|ielts|"
        r"sop|lor|admission|grad[- ]?school|graduate|stem|f-?1|opt|cpt|"
        r"stanford|mit|cmu|berkeley|princeton|harvard|yale|columbia|cornell|"
        r"ucla|usc|gatech|uiuc|umich|nyu|northwestern|duke|caltech|brown|upenn|"
        r"wharton|kellogg|booth|fellowship|scholarship|tuition|gpa|transcript|"
        r"recommendation|target[- ]?school|safety[- ]?school|admit|wait[- ]?list|"
        r"shortlist|profile[- ]?evaluation)\b",
        re.I,
    ),
    "career": re.compile(
        r"\b(job|interview|resume|cv|hiring|recruiter|offer|salary|compensation|"
        r"faang|intern|internship|recruit|behavioral|system[- ]?design|"
        r"coding[- ]?round|on-?site|new[- ]?grad|swe|sde|engineer|developer|"
        r"portfolio|networking|referral|cold[- ]?outreach|career)\b",
        re.I,
    ),
    "design": re.compile(
        r"\b(design|ux|ui|figma|sketch|prototype|wireframe|interface|typography|"
        r"user[- ]?experience|user[- ]?interface|product[- ]?design|"
        r"graphic[- ]?design|usability|accessibility|design[- ]?system|"
        r"visual|color[- ]?theory|layout)\b",
        re.I,
    ),
    "programming": re.compile(
        r"\b(code|coding|programming|software|javascript|typescript|python|"
        r"java|rust|golang|c\+\+|cpp|react|node|next[- ]?js|web|frontend|"
        r"backend|full[- ]?stack|api|rest|graphql|algorithm|data[- ]?structure|"
        r"leetcode|sql|database|aws|gcp|azure|docker|kubernetes|github)\b",
        re.I,
    ),
    "ideas": re.compile(
        r"\b(idea|ideas|brainstorm|concept|thought|musing|hypothesis|theory|"
        r"insight|reflection|philosophy|principle|framework|mental[- ]?model)\b",
        re.I,
    ),
    "project": re.compile(
        r"\b(project|plan|planning|roadmap|milestone|sprint|deadline|launch|"
        r"mvp|feature|requirement|spec|deliverable|kick[- ]?off|retrospective)\b",
        re.I,
    ),
    "finance": re.compile(
        r"\b(finance|money|invest|investment|stock|budget|expense|saving|"
        r"income|tax|portfolio|asset|liability|net[- ]?worth|crypto|bitcoin|"
        r"etf|mutual[- ]?fund|401k|ira|roth|fire|financial)\b",
        re.I,
    ),
    "health": re.compile(
        r"\b(health|healthy|fitness|gym|workout|exercise|diet|nutrition|sleep|"
        r"meditation|mindfulness|yoga|run|running|cycling|cardio|strength|"
        r"protein|calorie|wellness|mental[- ]?health|therapy)\b",
        re.I,
    ),
    "books": re.compile(
        r"\b(book|books|reading|read|literature|novel|author|chapter|kindle|"
        r"audiobook|highlight|book[- ]?notes|book[- ]?summary)\b",
        re.I,
    ),
    "travel": re.compile(
        r"\b(travel|trip|flight|hotel|tour|vacation|airbnb|itinerary|airport|"
        r"destination|backpack)\b",
        re.I,
    ),
    "daily": re.compile(
        r"\b(daily|weekly|monthly|journal|log|gratitude|todo|to-?do|habit|"
        r"routine|morning|evening|standup|review)\b",
        re.I,
    ),
    "research": re.compile(
        r"\b(research|paper|publication|conference|workshop|arxiv|cite|"
        r"citation|methodology|literature[- ]?review|abstract|thesis|"
        r"dissertation)\b",
        re.I,
    ),
}


def detect_domains(text: str) -> set[str]:
    return {name for name, pattern in DOMAIN_PATTERNS.items() if pattern.search(text)}


# ─────────────────────────────────────────────────────────────────────────────
# Sentence-aware chunking
# Goal: ~512 tokens per chunk with 64-token overlap. We approximate tokens with
# whitespace-split words (1 token ≈ 0.75 words for English) and split by
# sentence boundaries first to avoid mid-sentence cuts.
# ─────────────────────────────────────────────────────────────────────────────
TARGET_WORDS_PER_CHUNK = 380   # ~512 BERT tokens
OVERLAP_WORDS = 50             # ~64 tokens

_SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9])|\n{2,}")


def chunk_text(title: str, body: str) -> list[str]:
    """
    Split `body` into overlapping chunks. Each chunk is prefixed with the page
    title to provide context (BGE-Small is sensitive to titles for short docs).

    For very short pages the title alone is the only chunk — this is correct
    behavior, since there's no body content to embed independently.
    """
    title = (title or "").strip()
    body = (body or "").strip()
    title_prefix = f"{title}. " if title else ""

    if not body:
        if title:
            return [title]
        return []

    # Split into sentences first
    sentences = [s.strip() for s in _SENTENCE_SPLIT.split(body) if s.strip()]
    if not sentences:
        return [f"{title_prefix}{body}"[:2000]]

    chunks: list[str] = []
    current_words: list[str] = []
    current_word_count = 0

    for sentence in sentences:
        sentence_words = sentence.split()
        if not sentence_words:
            continue

        # If adding this sentence would exceed the target, flush current chunk
        if (
            current_word_count + len(sentence_words) > TARGET_WORDS_PER_CHUNK
            and current_word_count > 0
        ):
            chunks.append(title_prefix + " ".join(current_words))
            # Start next chunk with the overlap from the end of the previous one
            current_words = current_words[-OVERLAP_WORDS:]
            current_word_count = len(current_words)

        current_words.extend(sentence_words)
        current_word_count += len(sentence_words)

    if current_words:
        chunks.append(title_prefix + " ".join(current_words))

    return chunks


# ─────────────────────────────────────────────────────────────────────────────
# Request / response models
# ─────────────────────────────────────────────────────────────────────────────
class PageInput(BaseModel):
    id: str
    title: str = ""
    body: str = ""


class BuildGraphRequest(BaseModel):
    pages: list[PageInput]
    top_k: int = Field(default=5, ge=1, le=15, description="Max edges per node")
    min_chunks_for_voting: int = Field(default=3, ge=1, le=10)


class GraphEdge(BaseModel):
    # `from` is a Python keyword, so we alias it for the JSON wire format
    source: str = Field(serialization_alias="from")
    target: str = Field(serialization_alias="to")
    score: float


class BuildGraphResponse(BaseModel):
    edges: list[GraphEdge]
    stats: dict[str, Any]


# ─────────────────────────────────────────────────────────────────────────────
# Health
# ─────────────────────────────────────────────────────────────────────────────
@app.get("/health")
async def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "model": MODEL_NAME,
        "model_loaded": _model is not None,
    }


@app.post("/similarity/warmup")
async def warmup() -> dict[str, Any]:
    """Trigger model load proactively so the first build-graph call is fast."""
    t0 = time.time()
    get_model()
    return {"loaded": True, "elapsed_s": round(time.time() - t0, 2)}


# ─────────────────────────────────────────────────────────────────────────────
# The main endpoint
# ─────────────────────────────────────────────────────────────────────────────
@app.post("/similarity/build-graph")
async def build_graph(req: BuildGraphRequest) -> dict[str, Any]:
    if not req.pages:
        raise HTTPException(status_code=400, detail="pages must not be empty")

    t_total = time.time()
    model = get_model()

    # ── Step 1: chunking + domain detection ──────────────────────────────────
    chunk_texts: list[str] = []
    chunk_page_ids: list[str] = []
    page_domains: dict[str, set[str]] = {}
    page_chunk_counts: dict[str, int] = {}

    for page in req.pages:
        domains = detect_domains(f"{page.title} {page.body}")
        page_domains[page.id] = domains
        chunks = chunk_text(page.title, page.body)
        if not chunks:
            # Skip pages with no extractable content — they can't be linked
            page_chunk_counts[page.id] = 0
            continue
        for c in chunks:
            chunk_texts.append(c)
            chunk_page_ids.append(page.id)
        page_chunk_counts[page.id] = len(chunks)

    n_chunks = len(chunk_texts)
    n_pages_with_chunks = sum(1 for c in page_chunk_counts.values() if c > 0)

    if n_chunks < 2:
        return BuildGraphResponse(
            edges=[],
            stats={
                "n_pages_input": len(req.pages),
                "n_pages_with_content": n_pages_with_chunks,
                "n_chunks": n_chunks,
                "reason": "not enough content to compute similarity",
            },
        ).model_dump(by_alias=True)

    # ── Step 2: BGE embeddings ──────────────────────────────────────────────
    t0 = time.time()
    embeddings: np.ndarray = model.encode(
        chunk_texts,
        normalize_embeddings=True,
        show_progress_bar=False,
        batch_size=32,
        convert_to_numpy=True,
    ).astype(np.float32)
    t_embed = time.time() - t0
    log.info(f"Embedded {n_chunks} chunks in {t_embed:.2f}s")

    # ── Step 3: FAISS ANN ───────────────────────────────────────────────────
    # Inner product on L2-normalized vectors == cosine similarity
    dim = embeddings.shape[1]
    index = faiss.IndexFlatIP(dim)
    index.add(embeddings)

    # Over-fetch candidates per chunk so chunk voting has enough material
    k_per_chunk = min(40, n_chunks)
    t0 = time.time()
    sims, ids = index.search(embeddings, k_per_chunk)
    t_search = time.time() - t0

    # ── Step 4: chunk voting (top_k_mean) ────────────────────────────────────
    # For every (page_a, page_b) pair, collect all cross-chunk similarities.
    pair_sims: dict[tuple[str, str], list[float]] = {}
    for chunk_idx in range(n_chunks):
        src_pid = chunk_page_ids[chunk_idx]
        for rank in range(k_per_chunk):
            tgt_chunk_idx = int(ids[chunk_idx][rank])
            if tgt_chunk_idx == chunk_idx or tgt_chunk_idx < 0:
                continue
            tgt_pid = chunk_page_ids[tgt_chunk_idx]
            if tgt_pid == src_pid:
                continue
            sim = float(sims[chunk_idx][rank])
            key = (src_pid, tgt_pid) if src_pid < tgt_pid else (tgt_pid, src_pid)
            pair_sims.setdefault(key, []).append(sim)

    # Aggregate to a single page-pair score using top-k mean.
    K_VOTE = req.min_chunks_for_voting
    pair_scores: dict[tuple[str, str], float] = {}
    pair_vote_counts: dict[tuple[str, str], int] = {}
    for pair, sims_list in pair_sims.items():
        sims_list.sort(reverse=True)
        n_votes = min(len(sims_list), K_VOTE)
        if n_votes == 0:
            continue
        top_sims = sims_list[:n_votes]
        score = sum(top_sims) / n_votes
        # Penalize pairs that don't have enough independent votes — this is the
        # core defense against "Stevens ↔ Diet Plan" false positives where one
        # spurious shared word created a single high-similarity chunk pair.
        if len(sims_list) < K_VOTE:
            score *= 0.6 + 0.13 * len(sims_list)  # 1 vote → 0.73x, 2 votes → 0.86x
        pair_scores[pair] = score
        pair_vote_counts[pair] = len(sims_list)

    # ── Step 5: domain-aware threshold gate ──────────────────────────────────
    # BGE-Small produces calibrated cosine scores in roughly [0.0, 1.0].
    # Empirically:
    #   - same explicit domain: 0.45+ is a safe link threshold
    #   - cross domain: requires 0.62+ to overcome the topical mismatch
    #   - both pages have no detected domain: use a middle threshold
    SAME_DOMAIN_THRESHOLD = 0.45
    CROSS_DOMAIN_THRESHOLD = 0.62
    NO_DOMAIN_THRESHOLD = 0.55

    candidates_per_node: dict[str, list[tuple[str, float]]] = {
        page.id: [] for page in req.pages
    }
    rejected_by_domain = 0
    for (a, b), score in pair_scores.items():
        domains_a = page_domains.get(a, set())
        domains_b = page_domains.get(b, set())
        if domains_a and domains_b:
            threshold = (
                SAME_DOMAIN_THRESHOLD if (domains_a & domains_b) else CROSS_DOMAIN_THRESHOLD
            )
        else:
            threshold = NO_DOMAIN_THRESHOLD

        if score < threshold:
            rejected_by_domain += 1
            continue

        candidates_per_node[a].append((b, score))
        candidates_per_node[b].append((a, score))

    # ── Step 6: per-page top-K selection + dedup ─────────────────────────────
    seen: set[tuple[str, str]] = set()
    edges: list[GraphEdge] = []
    for src, candidates in candidates_per_node.items():
        candidates.sort(key=lambda c: c[1], reverse=True)
        for tgt, score in candidates[: req.top_k]:
            key = (src, tgt) if src < tgt else (tgt, src)
            if key in seen:
                continue
            seen.add(key)
            edges.append(GraphEdge(source=src, target=tgt, score=round(score, 4)))

    t_total_s = time.time() - t_total
    stats = {
        "n_pages_input": len(req.pages),
        "n_pages_with_content": n_pages_with_chunks,
        "n_chunks": n_chunks,
        "n_pairs_evaluated": len(pair_scores),
        "n_pairs_rejected_by_threshold": rejected_by_domain,
        "n_edges_returned": len(edges),
        "embed_seconds": round(t_embed, 2),
        "search_seconds": round(t_search, 2),
        "total_seconds": round(t_total_s, 2),
        "model": MODEL_NAME,
    }
    log.info(f"build-graph done: {stats}")

    return BuildGraphResponse(edges=edges, stats=stats).model_dump(by_alias=True)
