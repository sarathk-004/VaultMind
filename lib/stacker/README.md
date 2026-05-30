# Stacker Architecture

Stacker is an opt-in retrieval layer behind the existing Graphyne API contract.
The UI still calls:

- `GET /api/vaultmind/workspace`
- `POST /api/vaultmind`

The API still returns the same `answer` and `graph` shapes, so chat, citations,
graph rendering, mock fallback data, and deterministic answer fallbacks remain
intact.

## Target Stack

- Notion API: source connector for workspace pages and blocks.
- Postgres + pgvector: durable document, chunk, and vector store.
- Neo4j: durable graph store for page, topic, date, project, and reference edges.
- Redis cache: short-lived cache for snapshots and retrieval contexts.
- LLM provider: answer generation and optional semantic graph enrichment.
- Background sync worker: keeps Notion content indexed outside the request path.

## Current Branch Implementation

This branch includes real local adapters:

- Postgres metadata store via `pg`.
- pgvector chunk index with deterministic local embeddings.
- Neo4j page relationship graph via `neo4j-driver`.
- Redis cache via `redis`.
- `/api/vaultmind/sync` and `pnpm stacker:worker` for background sync.

The memory adapters still exist as resilience fallbacks when a local service is
not running. The current legacy Notion retriever remains the baseline behavior
when stacker is disabled.

## Environment Flags

```env
VAULTMIND_STACKER_ENABLED=true
VAULTMIND_STACKER_STORE=postgres-pgvector
VAULTMIND_STACKER_VECTOR=pgvector
VAULTMIND_STACKER_GRAPH=neo4j
VAULTMIND_STACKER_CACHE=redis
```

Local services:

```env
DATABASE_URL=postgres://graphyne:graphyne@localhost:5432/graphyne
DATABASE_SSL=false
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=graphyne-password
REDIS_URL=redis://localhost:6379
```

Start them with:

```bash
docker compose -f docker-compose.stacker.yml up -d
```

Run the sync worker while the Next app is running:

```bash
pnpm stacker:worker
```

The graph persisted to Neo4j includes the existing deterministic and optional
LLM-classified links from the Notion snapshot pipeline. Retrieval remains
database/vector/graph-first; the LLM is kept for final answers and optional
classification/link enrichment.

## Free Service Options

- Postgres + pgvector: local Docker, Supabase free project, or Neon free project.
- Neo4j: local Docker or Neo4j Aura free instance.
- Redis: local Docker, Upstash free tier, or Redis Cloud free tier.
- LLM: Ollama local model, Gemini free tier, OpenRouter free models where available,
  or deterministic fallback with no LLM key.

Before wiring any hosted provider-specific SDK or paid service, confirm the
choice and limits for the deployment target.
