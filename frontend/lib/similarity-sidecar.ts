/**
 * Client for the Python similarity sidecar (FastAPI + BGE-Small + FAISS).
 *
 * The sidecar is mounted at `/api/sidecar/*` in `vercel.json`. Internally it
 * implements the recommended chunked-embedding + chunk-voting + domain-aware
 * threshold pipeline. This module just calls it over HTTP with a timeout and
 * normalizes the response into the shape the retriever expects.
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
 * Resolve the absolute URL for a sidecar route. On Vercel `VERCEL_URL` is
 * always set in the runtime; locally `vercel dev` exposes the gateway on
 * port 3000 (the env vars `VERCELHOST`/`VERCEL_REGION` may not be set there).
 */
function sidecarUrl(path: string): string {
  const fromEnv =
    process.env.VAULTMIND_SIDECAR_BASE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "")
  const base = fromEnv || "http://localhost:3000"
  return `${base}${path}`
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
  const url = sidecarUrl("/api/sidecar/similarity/build-graph")
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
    const url = sidecarUrl("/api/sidecar/similarity/warmup")
    await fetch(url, { method: "POST" })
  } catch {
    // Warmup failure is non-fatal.
  }
}
