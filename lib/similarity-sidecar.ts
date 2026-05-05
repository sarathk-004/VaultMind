/**
 * Client for the standalone Python similarity sidecar (FastAPI + BGE-Small + FAISS).
 *
 * The sidecar is a standalone FastAPI service that the user runs locally
 * (see `backend/README.md`). It implements the recommended chunked-embedding
 * + chunk-voting + domain-aware threshold pipeline.
 *
 * Configure its location via the env var `VAULTMIND_SIDECAR_URL`
 * (e.g. `http://localhost:8000`). If the variable is unset OR the sidecar
 * is unreachable, the retriever falls back to a pure-TS TF-IDF + concept-tag
 * heuristic so the graph still renders.
 */

export interface SidecarPage {
  id: string
  title: string
  body: string
}

export interface SidecarEdge {
  from: string
  to: string
  score: number
}

export interface SidecarResult {
  edges: SidecarEdge[]
  stats: Record<string, unknown>
}

/**
 * Resolve the absolute URL for a sidecar route. The user sets
 * `VAULTMIND_SIDECAR_URL` to point at their running backend (e.g.
 * `http://localhost:8000` for local dev). If unset, returns null and the
 * caller will fall back to the TS-only similarity heuristic.
 */
function sidecarUrl(path: string): string | null {
  const base = process.env.VAULTMIND_SIDECAR_URL
  if (!base) return null
  return `${base.replace(/\/+$/, "")}${path}`
}

/**
 * Call the sidecar to build semantic edges for a set of Notion pages.
 *
 * Returns null if the sidecar is unreachable, errors out, or takes too long —
 * the caller is expected to fall back to the in-process TF-IDF heuristic so
 * the graph still renders something useful.
 */
export async function buildSemanticEdgesViaSidecar(
  pages: SidecarPage[],
  opts: { topK?: number; timeoutMs?: number; minChunksForVoting?: number } = {},
): Promise<SidecarResult | null> {
  if (pages.length < 2) return { edges: [], stats: { skipped: "not enough pages" } }

  const { topK = 5, timeoutMs = 60_000, minChunksForVoting = 3 } = opts
  const url = sidecarUrl("/similarity/build-graph")
  if (!url) {
    // Sidecar not configured — the caller will fall back to TF-IDF.
    return null
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pages,
        top_k: topK,
        min_chunks_for_voting: minChunksForVoting,
      }),
      signal: controller.signal,
    })

    if (!res.ok) {
      const errorBody = await res.text().catch(() => "")
      console.error(
        `[v0] Similarity sidecar error ${res.status}: ${errorBody.slice(0, 200)}`,
      )
      return null
    }

    const data = (await res.json()) as SidecarResult
    return data
  } catch (err) {
    const reason =
      err instanceof Error
        ? err.name === "AbortError"
          ? `timeout after ${timeoutMs}ms`
          : err.message
        : String(err)
    console.warn(`[v0] Similarity sidecar unreachable (${reason}) — falling back`)
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Best-effort warmup ping to load the model into memory. Caller should not
 * await this — it's purely an optimization for the first user request.
 */
export async function warmupSidecar(): Promise<void> {
  try {
    const url = sidecarUrl("/similarity/warmup")
    if (!url) return
    await fetch(url, { method: "POST" })
  } catch {
    // Warmup failure is non-fatal.
  }
}
