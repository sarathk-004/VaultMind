import {
  notionFetch,
  isNotionConnected,
  getPageTitle,
  getDatabaseTitle,
  richTextToPlain,
  tokenKey,
  type NotionPage,
  type NotionDatabase,
  type NotionSearchResponse,
  type NotionBlockChildrenResponse,
  type NotionBlock,
} from "./notion-client"
import { blocksToMarkdown } from "./notion-blocks"
import type { GraphNode, GraphEdge, KnowledgeGraph, NodeType, NoteContent } from "./vaultmind-types"
import { WORKSPACE, WORKSPACE_EDGES, NOTE_CONTENT } from "./workspace-data"

interface NotionPageMeta {
  id: string
  title: string
  type: NodeType
  parentId?: string
  url?: string
  /** Cluster id — top-level ancestor in the parent chain, or self if root. */
  cluster?: string
}

export interface CachedSnapshot {
  pages: Map<string, NotionPageMeta>
  edges: GraphEdge[]
  fetchedAt: number
  source: "notion" | "mock"
  usingMock: boolean
}

interface CachedPageContent {
  content: NoteContent
  fetchedAt: number
}

const SNAPSHOT_TTL = 5 * 60_000
const PAGE_CACHE_TTL = 10 * 60_000

const snapshotByToken = new Map<string, CachedSnapshot>()
const pageCacheByToken = new Map<string, Map<string, CachedPageContent>>()

function getPageCache(key: string): Map<string, CachedPageContent> {
  let m = pageCacheByToken.get(key)
  if (!m) {
    m = new Map()
    pageCacheByToken.set(key, m)
  }
  return m
}

/** Wipe caches for a specific token (used when user disconnects). */
export function clearTokenCaches(token: string | null | undefined): void {
  const key = tokenKey(token)
  snapshotByToken.delete(key)
  pageCacheByToken.delete(key)
}

/**
 * Fetch all accessible pages & databases from Notion. Falls back to local
 * mock workspace if Notion is unavailable or zero pages are accessible.
 */
export async function getWorkspaceSnapshot(token?: string | null): Promise<CachedSnapshot> {
  const key = tokenKey(token)

  if (!isNotionConnected(token)) {
    console.log("[v0] No Notion token — using local mock workspace")
    return mockSnapshot()
  }

  const now = Date.now()
  const cached = snapshotByToken.get(key)
  if (cached && cached.source === "notion" && now - cached.fetchedAt < SNAPSHOT_TTL) {
    return cached
  }

  try {
    const pages = new Map<string, NotionPageMeta>()
    let cursor: string | undefined
    let safetyCount = 0

    // Stats so the user can see exactly what was filtered and why.
    const stats = {
      raw: 0,
      databases: 0,
      databaseRows: 0,
      blockChildren: 0,
      untitled: 0,
      kept: 0,
    }

    do {
      const body: Record<string, unknown> = {
        page_size: 100,
        // Ask Notion for pages only — drops every `database` object at the
        // source. Database *rows* still come through (they're "page" objects
        // with parent.type === "database_id") and are filtered below.
        filter: { value: "page", property: "object" },
      }
      if (cursor) body.start_cursor = cursor
      const res = await notionFetch<NotionSearchResponse>(
        "/search",
        { method: "POST", body },
        token,
      )

      for (const item of res.results) {
        stats.raw++
        if (item.object === "database") {
          stats.databases++
          continue
        }
        const page = item as NotionPage
        const parentType = page.parent?.type
        if (parentType === "database_id") {
          stats.databaseRows++
          continue
        }
        if (parentType === "block_id") {
          stats.blockChildren++
          continue
        }
        const title = getPageTitle(page).trim()
        if (!title || title.toLowerCase() === "untitled") {
          stats.untitled++
          continue
        }
        const meta = parseSearchResult(item)
        if (meta) {
          stats.kept++
          pages.set(meta.id, meta)
        }
      }

      cursor = res.next_cursor ?? undefined
      safetyCount++
    } while (cursor && safetyCount < 10)

    console.log(
      `[v0] Notion filter stats: raw=${stats.raw} → kept=${stats.kept} ` +
        `(skipped: databases=${stats.databases}, dbRows=${stats.databaseRows}, ` +
        `blockChildren=${stats.blockChildren}, untitled=${stats.untitled})`,
    )

    if (pages.size === 0) {
      console.log("[v0] Notion returned 0 pages — falling back to mock workspace")
      const mockSnap = mockSnapshot()
      mockSnap.usingMock = true
      return mockSnap
    }

    const edges: GraphEdge[] = []
    for (const [id, meta] of pages) {
      if (meta.parentId && pages.has(meta.parentId)) {
        edges.push({ from: meta.parentId, to: id, relation: "contains" })
      }
    }

    // Cluster by connected component on the edge graph — every page that's
    // linked (directly or transitively) lands in the same cluster.
    assignClustersByConnectedComponent(pages, edges)

    const snap: CachedSnapshot = {
      pages,
      edges,
      fetchedAt: now,
      source: "notion",
      usingMock: false,
    }
    snapshotByToken.set(key, snap)
    console.log(`[v0] Fetched Notion workspace: ${pages.size} items, ${edges.length} edges`)
    return snap
  } catch (err) {
    console.error("[v0] Failed to fetch Notion workspace, falling back to mock data:", err)
    const mockSnap = mockSnapshot()
    mockSnap.usingMock = true
    return mockSnap
  }
}

/**
 * Cluster pages by connected component over the parent/child edge graph
 * using union-find. Any two pages that share an ancestor (direct or
 * transitive) end up in the same cluster — so visually grouped means
 * literally graph-connected.
 */
function assignClustersByConnectedComponent(
  pages: Map<string, NotionPageMeta>,
  edges: GraphEdge[],
): void {
  const parent = new Map<string, string>()
  for (const id of pages.keys()) parent.set(id, id)

  const find = (x: string): string => {
    let cur = x
    while (parent.get(cur) !== cur) {
      const p = parent.get(cur)!
      const gp = parent.get(p) ?? p
      parent.set(cur, gp) // path compression
      cur = gp
    }
    return cur
  }
  const union = (a: string, b: string) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent.set(ra, rb)
  }

  for (const e of edges) {
    if (pages.has(e.from) && pages.has(e.to)) union(e.from, e.to)
  }
  for (const [id, meta] of pages) {
    meta.cluster = find(id)
  }
}

/**
 * Reduce a workspace snapshot to a renderable graph. Picks top-N hubs by
 * degree so dense vaults stay readable. Carries cluster ids onto the nodes.
 */
export function snapshotToGraph(snap: CachedSnapshot, maxNodes = 500): KnowledgeGraph {
  const degree = new Map<string, number>()
  for (const e of snap.edges) {
    degree.set(e.from, (degree.get(e.from) ?? 0) + 1)
    degree.set(e.to, (degree.get(e.to) ?? 0) + 1)
  }

  const allMetas = Array.from(snap.pages.values())
  const sorted = allMetas.slice().sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0))
  const kept = new Set<string>(sorted.slice(0, maxNodes).map(m => m.id))

  const nodes: GraphNode[] = sorted.slice(0, maxNodes).map(m => ({
    id: m.id,
    label: m.title,
    type: m.type,
    cluster: m.cluster,
  }))
  const edges = snap.edges.filter(e => kept.has(e.from) && kept.has(e.to))
  return { nodes, edges }
}

// ── Ranking ─────────────────────────────────────────────────────────────

const STOPWORDS = new Set([
  "the","a","an","and","or","but","of","to","in","on","for","with","is","are","was","were",
  "be","been","being","this","that","what","how","why","when","where","which","who","tell",
  "show","find","give","please","about","my","me","i","do","does","did","can","could","would",
  "should","will","shall","may","might","must","need","want","get","got","make","take","like",
  "from","into","over","under","up","down","out","off","than","then","also","just","very",
])

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(t => t.length >= 2 && !STOPWORDS.has(t))
}

interface DocFeatures {
  meta: NotionPageMeta
  /** Concatenated title + (optional) snippet, plain text. */
  text: string
  tokens: string[]
}

/**
 * Content-aware retrieval pipeline (no LLM needed):
 *   1. Get candidate set: union of (a) Notion `/search?query`, (b) any local
 *      title-substring matches, capped at ~30 docs.
 *   2. Fetch a short content snippet for each candidate in parallel.
 *   3. Score every candidate with BM25 over (title + snippet).
 *   4. Add 1-hop graph neighbor bonus (related-to-top-hits).
 *   5. Return top 8.
 */
export async function rankPages(
  query: string,
  snap: CachedSnapshot,
  token?: string | null,
): Promise<NotionPageMeta[]> {
  const qTokens = tokenize(query)
  if (qTokens.length === 0) {
    return Array.from(snap.pages.values()).slice(0, 6)
  }

  // 1. Build a candidate set
  const candidates = new Map<string, NotionPageMeta>()

  // a) Local title contains — fast pre-filter
  const qPhrase = qTokens.join(" ")
  for (const meta of snap.pages.values()) {
    const t = meta.title.toLowerCase()
    if (qTokens.some(tok => t.includes(tok))) {
      candidates.set(meta.id, meta)
      if (candidates.size >= 30) break
    }
  }

  // b) Notion's content-aware search (if connected)
  if (!snap.usingMock) {
    try {
      const res = await notionFetch<NotionSearchResponse>(
        "/search",
        { method: "POST", body: { query, page_size: 20 } },
        token,
      )
      for (const item of res.results) {
        const meta = parseSearchResult(item)
        if (!meta) continue
        const known = snap.pages.get(meta.id) ?? meta
        candidates.set(known.id, known)
        if (candidates.size >= 35) break
      }
    } catch (err) {
      console.warn("[v0] Notion content search failed:", err)
    }
  }

  if (candidates.size === 0) return []

  // 2. Fetch short snippets in parallel (capped at 25 to keep latency bounded)
  const candList = Array.from(candidates.values()).slice(0, 25)
  const snippets = await Promise.all(
    candList.map(meta => fetchSnippet(meta, token).catch(() => "")),
  )

  // 3. Build doc features + run BM25
  const docs: DocFeatures[] = candList.map((meta, i) => {
    const text = `${meta.title}\n${snippets[i] ?? ""}`
    return { meta, text, tokens: tokenize(text) }
  })

  const bm25Scores = bm25(qTokens, docs)

  // 4. Add graph neighbor boost — neighbors of top-3 raw BM25 hits get a bump
  const adjacency = new Map<string, Set<string>>()
  for (const e of snap.edges) {
    if (!adjacency.has(e.from)) adjacency.set(e.from, new Set())
    if (!adjacency.has(e.to)) adjacency.set(e.to, new Set())
    adjacency.get(e.from)!.add(e.to)
    adjacency.get(e.to)!.add(e.from)
  }

  const sortedRaw = bm25Scores.slice().sort((a, b) => b.score - a.score)
  const topRawIds = new Set(sortedRaw.slice(0, 3).map(s => s.id))
  const neighborSet = new Set<string>()
  for (const id of topRawIds) {
    for (const n of adjacency.get(id) ?? []) neighborSet.add(n)
  }

  // 5. Final score = BM25 + 0.3 * neighbor_bonus + small title-exact bonus
  const final = bm25Scores
    .map(s => {
      let score = s.score
      if (neighborSet.has(s.id) && !topRawIds.has(s.id)) score += 0.3 * sortedRaw[0].score
      const m = snap.pages.get(s.id)
      if (m) {
        const t = m.title.toLowerCase()
        for (const tok of qTokens) {
          // Exact word match in title is a strong signal
          if (new RegExp(`\\b${tok.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(t)) {
            score += 0.5
          }
        }
      }
      return { id: s.id, score }
    })
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)

  return final
    .map(s => snap.pages.get(s.id))
    .filter((m): m is NotionPageMeta => Boolean(m))
}

/**
 * BM25 over the candidate corpus. Returns one entry per doc (preserving order).
 * Returns score 0 if a doc has no query-token match.
 */
function bm25(qTokens: string[], docs: DocFeatures[]): { id: string; score: number }[] {
  const k1 = 1.4
  const b = 0.75
  const N = docs.length || 1

  // Document frequency for each query token
  const df = new Map<string, number>()
  for (const t of qTokens) {
    let count = 0
    for (const d of docs) {
      if (d.tokens.includes(t)) count++
    }
    df.set(t, count)
  }

  const totalLen = docs.reduce((a, d) => a + d.tokens.length, 0)
  const avgLen = totalLen / N || 1

  return docs.map(d => {
    let score = 0
    const len = d.tokens.length || 1
    for (const t of qTokens) {
      const dft = df.get(t) ?? 0
      if (dft === 0) continue
      const tf = d.tokens.reduce((a, x) => (x === t ? a + 1 : a), 0)
      if (tf === 0) continue
      const idf = Math.log(1 + (N - dft + 0.5) / (dft + 0.5))
      const norm = tf * (k1 + 1) / (tf + k1 * (1 - b + (b * len) / avgLen))
      score += idf * norm
    }
    return { id: d.meta.id, score }
  })
}

/**
 * Fetch a short plain-text snippet (~600 chars) for ranking. Re-uses the
 * full-page cache when available to avoid duplicate Notion calls.
 */
async function fetchSnippet(meta: NotionPageMeta, token?: string | null): Promise<string> {
  // Mock branch — pull from local note content
  const mockHit = NOTE_CONTENT[meta.id]
  if (mockHit) return mockHit.content.slice(0, 600)

  const cached = getPageCache(tokenKey(token)).get(meta.id)
  if (cached) return cached.content.content.slice(0, 600)

  if (!isNotionConnected(token)) return ""

  try {
    if (meta.type === "database") {
      // Just probe the first row's properties — cheap and indicative.
      const res = await notionFetch<{ results: NotionPage[] }>(
        `/databases/${meta.id}/query`,
        { method: "POST", body: { page_size: 3 } },
        token,
      )
      const rows = res.results
        .map(p =>
          Object.values(p.properties ?? {})
            .map(v => (v?.title ? richTextToPlain(v.title) : ""))
            .join(" "),
        )
        .join(" ")
      return rows.slice(0, 600)
    }

    const res = await notionFetch<NotionBlockChildrenResponse>(
      `/blocks/${meta.id}/children?page_size=20`,
      undefined,
      token,
    )
    const { markdown } = blocksToMarkdown(res.results, { childrenMap: new Map() })
    return markdown.slice(0, 600)
  } catch {
    return ""
  }
}

// ── Page content ────────────────────────────────────────────────────────

export async function fetchPageContent(
  pageId: string,
  token?: string | null,
): Promise<NoteContent | null> {
  const cleanId = pageId.replace(/-/g, "")
  const cache = getPageCache(tokenKey(token))
  const cached = cache.get(cleanId)
  const now = Date.now()
  if (cached && now - cached.fetchedAt < PAGE_CACHE_TTL) return cached.content

  if (!isNotionConnected(token)) {
    return NOTE_CONTENT[cleanId] ?? NOTE_CONTENT[pageId] ?? null
  }

  try {
    const snap = await getWorkspaceSnapshot(token)
    if (snap.usingMock) {
      return NOTE_CONTENT[cleanId] ?? NOTE_CONTENT[pageId] ?? null
    }

    const meta = snap.pages.get(cleanId) ?? snap.pages.get(pageId)
    if (!meta) return NOTE_CONTENT[cleanId] ?? NOTE_CONTENT[pageId] ?? null

    if (meta.type === "database") {
      const md = await fetchDatabaseMarkdown(cleanId, meta.title, token)
      const content: NoteContent = {
        id: cleanId,
        title: meta.title,
        type: meta.type,
        content: md || "_(Empty database)_",
        relatedNodes: [],
      }
      cache.set(cleanId, { content, fetchedAt: now })
      return content
    }

    const topLevel = await fetchAllChildren(cleanId, token)
    const childrenMap = await prefetchNestedChildren(topLevel, token)
    const extracted = blocksToMarkdown(topLevel, { childrenMap })

    let extraSections = ""
    for (const cdb of extracted.childDatabaseIds.slice(0, 3)) {
      const dbMd = await fetchDatabaseMarkdown(cdb.id.replace(/-/g, ""), cdb.title, token)
      if (dbMd) extraSections += `\n\n#### ${cdb.title}\n${dbMd}`
    }

    const content: NoteContent = {
      id: cleanId,
      title: meta.title,
      type: meta.type,
      content: (extracted.markdown + extraSections).trim() || "_(No content yet)_",
      relatedNodes: extracted.mentionedIds.map(id => id.replace(/-/g, "")),
    }
    cache.set(cleanId, { content, fetchedAt: now })
    return content
  } catch (err) {
    console.error(`[v0] Failed to fetch page ${cleanId}:`, err)
    return NOTE_CONTENT[cleanId] ?? NOTE_CONTENT[pageId] ?? null
  }
}

async function fetchAllChildren(blockId: string, token?: string | null): Promise<NotionBlock[]> {
  const out: NotionBlock[] = []
  let cursor: string | undefined
  let safety = 0
  do {
    const path = `/blocks/${blockId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ""}`
    const res = await notionFetch<NotionBlockChildrenResponse>(path, undefined, token)
    out.push(...res.results)
    cursor = res.next_cursor ?? undefined
    safety++
  } while (cursor && safety < 5)
  return out
}

async function prefetchNestedChildren(
  blocks: NotionBlock[],
  token?: string | null,
): Promise<Map<string, NotionBlock[]>> {
  const map = new Map<string, NotionBlock[]>()
  const NEEDS_CHILDREN = new Set([
    "toggle","column_list","column","synced_block","table",
    "bulleted_list_item","numbered_list_item","callout","quote",
  ])

  const queue: { block: NotionBlock; depth: number }[] = blocks
    .filter(b => b.has_children && NEEDS_CHILDREN.has(b.type))
    .map(b => ({ block: b, depth: 0 }))

  let safety = 0
  while (queue.length > 0 && safety < 60) {
    const { block, depth } = queue.shift()!
    safety++
    if (map.has(block.id)) continue
    try {
      const kids = await fetchAllChildren(block.id, token)
      map.set(block.id, kids)
      if (depth < 2) {
        for (const k of kids) {
          if (k.has_children && NEEDS_CHILDREN.has(k.type)) {
            queue.push({ block: k, depth: depth + 1 })
          }
        }
      }
    } catch (e) {
      console.warn(`[v0] prefetch failed for ${block.id}:`, e)
    }
  }
  return map
}

async function fetchDatabaseMarkdown(
  databaseId: string,
  title: string,
  token?: string | null,
): Promise<string> {
  try {
    const res = await notionFetch<{ results: NotionPage[] }>(
      `/databases/${databaseId}/query`,
      { method: "POST", body: { page_size: 25 } },
      token,
    )
    if (!res.results.length) return ""
    const first = res.results[0]
    const propEntries = Object.entries(first.properties ?? {})
    const columns = propEntries.map(([name]) => name).slice(0, 6)
    if (columns.length === 0) return ""

    const header = `| ${columns.join(" | ")} |`
    const sep = `| ${columns.map(() => "---").join(" | ")} |`
    const rows = res.results
      .map(page => {
        const cells = columns.map(col => {
          const value = (page.properties ?? {})[col]
          return propValueToString(value).slice(0, 80) || " "
        })
        return `| ${cells.join(" | ")} |`
      })
      .join("\n")
    return `${header}\n${sep}\n${rows}`
  } catch (err) {
    console.warn(`[v0] Failed to query database ${databaseId} (${title}):`, err)
    return ""
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function propValueToString(prop: any): string {
  if (!prop) return ""
  switch (prop.type) {
    case "title": return richTextToPlain(prop.title)
    case "rich_text": return richTextToPlain(prop.rich_text)
    case "select": return prop.select?.name ?? ""
    case "status": return prop.status?.name ?? ""
    case "multi_select": return (prop.multi_select ?? []).map((s: { name: string }) => s.name).join(", ")
    case "number": return prop.number != null ? String(prop.number) : ""
    case "checkbox": return prop.checkbox ? "✓" : ""
    case "date": return prop.date?.start ?? ""
    case "people": return (prop.people ?? []).map((p: { name?: string }) => p.name ?? "").join(", ")
    case "url": return prop.url ?? ""
    case "email": return prop.email ?? ""
    case "phone_number": return prop.phone_number ?? ""
    case "files": return (prop.files ?? []).map((f: { name?: string }) => f.name ?? "").join(", ")
    case "formula": return prop.formula?.string ?? prop.formula?.number?.toString() ?? ""
    case "relation": return (prop.relation ?? []).length + " linked"
    default: return ""
  }
}

// ── Subgraph ────────────────────────────────────────────────────────────

export function buildSubgraph(seeds: NotionPageMeta[], snap: CachedSnapshot): KnowledgeGraph {
  const included = new Set<string>(seeds.map(s => s.id))
  const adjMap = new Map<string, Set<string>>()
  for (const e of snap.edges) {
    if (!adjMap.has(e.from)) adjMap.set(e.from, new Set())
    if (!adjMap.has(e.to)) adjMap.set(e.to, new Set())
    adjMap.get(e.from)!.add(e.to)
    adjMap.get(e.to)!.add(e.from)
  }
  for (const seed of seeds) {
    const neighbors = adjMap.get(seed.id)
    if (!neighbors) continue
    for (const n of neighbors) {
      if (included.size >= 14) break
      included.add(n)
    }
  }

  const nodes: GraphNode[] = []
  for (const id of included) {
    const meta = snap.pages.get(id)
    if (meta) nodes.push({ id, label: meta.title, type: meta.type, cluster: meta.cluster })
  }
  const edges = snap.edges.filter(e => included.has(e.from) && included.has(e.to))
  return { nodes, edges }
}

// ── Helpers ─────────────────────────────────────────────────────────────

function parseSearchResult(item: NotionPage | NotionDatabase): NotionPageMeta | null {
  if (item.archived || item.in_trash) return null

  if (item.object === "page") {
    const page = item as NotionPage
    // Notion treats every database row as a "page" with parent.type ===
    // "database_id". We only want real top-level pages, not the contents
    // *inside* databases — those are records, not pages.
    const parentType = page.parent?.type
    if (parentType === "database_id") return null
    // Pages with `block_id` parents are nested inside a column/toggle/etc.
    // and aren't standalone pages either.
    if (parentType === "block_id") return null

    const title = getPageTitle(page).trim()
    if (!title || title.toLowerCase() === "untitled") return null
    return {
      id: page.id.replace(/-/g, ""),
      title,
      type: guessPageType(page),
      parentId: extractParentId(page),
      url: page.url,
    }
  }
  if (item.object === "database") {
    const db = item as NotionDatabase
    const title = getDatabaseTitle(db).trim()
    if (!title || title.toLowerCase() === "untitled database" || title.toLowerCase() === "untitled") {
      return null
    }
    return {
      id: db.id.replace(/-/g, ""),
      title,
      type: "database",
      parentId: extractParentId(db),
      url: db.url,
    }
  }
  return null
}

function extractParentId(item: NotionPage | NotionDatabase): string | undefined {
  const parent = item.parent
  if (!parent) return undefined
  if (parent.type === "page_id" && parent.page_id) return parent.page_id.replace(/-/g, "")
  if (parent.type === "database_id" && (parent as { database_id?: string }).database_id) {
    return (parent as { database_id: string }).database_id.replace(/-/g, "")
  }
  return undefined
}

function guessPageType(page: NotionPage): NodeType {
  const props = page.properties
  if (!props) return "page"
  const keys = Object.keys(props).map(k => k.toLowerCase())
  if (keys.includes("status") || keys.includes("assignee") || keys.includes("due")) return "task"
  if (keys.includes("tags") || keys.includes("type") || keys.includes("category")) return "note"
  return "page"
}

function mockSnapshot(): CachedSnapshot {
  const pages = new Map<string, NotionPageMeta>()
  for (const [id, node] of Object.entries(WORKSPACE)) {
    pages.set(id, {
      id,
      title: node.label,
      type: (node.type as NodeType) || "page",
    })
  }
  assignClustersByConnectedComponent(pages, WORKSPACE_EDGES)
  return { pages, edges: WORKSPACE_EDGES, fetchedAt: Date.now(), source: "mock", usingMock: true }
}
