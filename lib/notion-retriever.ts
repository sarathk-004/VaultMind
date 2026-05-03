import { getNotionClient } from "./notion-client"
import { blocksToMarkdown } from "./notion-blocks"
import type { GraphNode, GraphEdge, KnowledgeGraph, NodeType, NoteContent } from "./vaultmind-types"
import { WORKSPACE, WORKSPACE_EDGES, NOTE_CONTENT } from "./workspace-data"

interface NotionPageMeta {
  id: string
  title: string
  type: NodeType
  parentId?: string
  url?: string
}

interface CachedSnapshot {
  pages: Map<string, NotionPageMeta>
  edges: GraphEdge[]
  fetchedAt: number
}

interface CachedPageContent {
  content: NoteContent
  fetchedAt: number
}

let snapshot: CachedSnapshot | null = null
const SNAPSHOT_TTL = 5 * 60_000 // 5 minutes
const pageCache = new Map<string, CachedPageContent>()
const PAGE_CACHE_TTL = 10 * 60_000 // 10 minutes

/**
 * Fetch all accessible pages & databases from Notion. Returns a snapshot
 * with { pages, edges }. Falls back to local mock workspace if Notion is unavailable.
 */
export async function getWorkspaceSnapshot(): Promise<CachedSnapshot> {
  const client = getNotionClient()
  if (!client) {
    console.log("[v0] NOTION_API_KEY not set — using local mock workspace")
    return mockSnapshot()
  }

  const now = Date.now()
  if (snapshot && now - snapshot.fetchedAt < SNAPSHOT_TTL) {
    return snapshot
  }

  try {
    const pages = new Map<string, NotionPageMeta>()
    let cursor: string | undefined
    let safetyCount = 0

    // Notion search with empty query lists all accessible items
    do {
      const res = await client.search({
        page_size: 100,
        start_cursor: cursor,
        filter: undefined,
      } as any)

      for (const item of res.results) {
        const meta = parseSearchResult(item)
        if (meta) pages.set(meta.id, meta)
      }

      cursor = res.next_cursor ?? undefined
      safetyCount++
    } while (cursor && safetyCount < 10) // Cap at 10 pages = 1k items

    // Build parent-child edges
    const edges: GraphEdge[] = []
    for (const [id, meta] of pages) {
      if (meta.parentId && pages.has(meta.parentId)) {
        edges.push({ from: meta.parentId, to: id, relation: "contains" })
      }
    }

    snapshot = { pages, edges, fetchedAt: now }
    console.log(`[v0] Fetched Notion workspace: ${pages.size} items, ${edges.length} edges`)
    return snapshot
  } catch (err) {
    console.error("[v0] Failed to fetch Notion workspace, falling back to mock data:", err)
    return mockSnapshot()
  }
}

/**
 * Convert the workspace snapshot into KnowledgeGraph for rendering.
 */
export function snapshotToGraph(snap: CachedSnapshot): KnowledgeGraph {
  const nodes: GraphNode[] = []
  for (const [id, meta] of snap.pages) {
    nodes.push({ id, label: meta.title, type: meta.type })
  }
  return { nodes, edges: snap.edges }
}

/**
 * Rank pages by query match quality using token overlap.
 */
export function rankPages(
  query: string,
  snap: CachedSnapshot,
): Array<NotionPageMeta> {
  const tokens = tokenize(query)
  if (tokens.length === 0) {
    // No query — return first N pages
    return Array.from(snap.pages.values()).slice(0, 7)
  }

  const scored = Array.from(snap.pages.values())
    .map(page => {
      const haystack = `${page.title} ${page.id} ${page.type}`.toLowerCase()
      let score = 0
      for (const t of tokens) {
        if (haystack.includes(t)) score += 3
      }
      return { page, score }
    })
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)

  if (scored.length === 0) {
    // Fallback: return first N pages
    return Array.from(snap.pages.values()).slice(0, 7)
  }

  return scored.slice(0, 7).map(s => s.page)
}

/**
 * Fetch full content for a Notion page. Returns markdown + mentions.
 * Caches for 10 minutes.
 */
export async function fetchPageContent(pageId: string): Promise<NoteContent | null> {
  const cleanId = pageId.replace(/-/g, "")
  const cached = pageCache.get(cleanId)
  const now = Date.now()
  if (cached && now - cached.fetchedAt < PAGE_CACHE_TTL) {
    return cached.content
  }

  const client = getNotionClient()
  if (!client) {
    // Fallback to local mock data if available
    const mock = NOTE_CONTENT[cleanId] || NOTE_CONTENT[pageId]
    if (mock) return mock
    return null
  }

  try {
    // Fetch page metadata for title/type
    const snap = await getWorkspaceSnapshot()
    const meta = snap.pages.get(cleanId) ?? snap.pages.get(pageId)
    if (!meta) return null

    // Fetch blocks
    const res = await client.blocks.children.list({
      block_id: cleanId,
      page_size: 100,
    })

    const { markdown, mentionedIds } = blocksToMarkdown(res.results)

    const content: NoteContent = {
      id: cleanId,
      title: meta.title,
      type: meta.type,
      content: markdown || "_(No content yet)_",
      relatedNodes: mentionedIds,
    }

    pageCache.set(cleanId, { content, fetchedAt: now })
    return content
  } catch (err) {
    console.error(`[v0] Failed to fetch page ${cleanId}:`, err)
    // Try mock fallback
    const mock = NOTE_CONTENT[cleanId] || NOTE_CONTENT[pageId]
    if (mock) return mock
    return null
  }
}

/**
 * Build a subgraph around the top-ranked pages (seeds + 1-hop neighbors).
 */
export function buildSubgraph(seeds: NotionPageMeta[], snap: CachedSnapshot): KnowledgeGraph {
  const included = new Set<string>(seeds.map(s => s.id))
  const adjMap = new Map<string, Set<string>>()

  // Build adjacency
  for (const e of snap.edges) {
    if (!adjMap.has(e.from)) adjMap.set(e.from, new Set())
    if (!adjMap.has(e.to)) adjMap.set(e.to, new Set())
    adjMap.get(e.from)!.add(e.to)
    adjMap.get(e.to)!.add(e.from)
  }

  // Add 1-hop neighbors
  for (const seed of seeds) {
    const neighbors = adjMap.get(seed.id)
    if (!neighbors) continue
    for (const n of neighbors) {
      if (included.size >= 10) break
      included.add(n)
    }
  }

  const nodes: GraphNode[] = []
  for (const id of included) {
    const meta = snap.pages.get(id)
    if (meta) nodes.push({ id, label: meta.title, type: meta.type })
  }

  const edges = snap.edges.filter(e => included.has(e.from) && included.has(e.to))

  return { nodes, edges }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseSearchResult(item: any): NotionPageMeta | null {
  if (item.object === "page") {
    return {
      id: item.id.replace(/-/g, ""),
      title: extractPageTitle(item),
      type: guessPageType(item),
      parentId: extractParentId(item),
      url: item.url,
    }
  }
  if (item.object === "database") {
    return {
      id: item.id.replace(/-/g, ""),
      title: extractDatabaseTitle(item),
      type: "database",
      parentId: extractParentId(item),
      url: item.url,
    }
  }
  return null
}

function extractPageTitle(page: any): string {
  const props = page.properties
  if (!props) return "Untitled"
  const titleProp = Object.values(props).find((p: any) => p.type === "title") as any
  if (!titleProp || !titleProp.title || titleProp.title.length === 0) return "Untitled"
  return titleProp.title.map((t: any) => t.plain_text ?? "").join("")
}

function extractDatabaseTitle(db: any): string {
  if (db.title && db.title.length > 0) {
    return db.title.map((t: any) => t.plain_text ?? "").join("")
  }
  return "Untitled database"
}

function extractParentId(item: any): string | undefined {
  const parent = item.parent
  if (!parent) return undefined
  if (parent.type === "page_id") return parent.page_id?.replace(/-/g, "")
  if (parent.type === "database_id") return parent.database_id?.replace(/-/g, "")
  return undefined
}

function guessPageType(page: any): NodeType {
  // Heuristic: if "Status" or "Assigned" props → task; if "Name" or short → note; else page
  const props = page.properties
  if (!props) return "page"
  const keys = Object.keys(props).map(k => k.toLowerCase())
  if (keys.includes("status") || keys.includes("assignee")) return "task"
  if (keys.includes("tags") || keys.includes("type")) return "note"
  return "page"
}

const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "of",
  "to",
  "in",
  "on",
  "for",
  "with",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "this",
  "that",
  "what",
  "how",
  "why",
  "when",
  "where",
  "which",
  "who",
])

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(t => t.length > 2 && !STOPWORDS.has(t))
}

function mockSnapshot(): CachedSnapshot {
  const pages = new Map<string, NotionPageMeta>()
  for (const [id, node] of Object.entries(WORKSPACE)) {
    pages.set(id, {
      id,
      title: node.label,
      type: (node.type as NodeType) || "page",
      parentId: undefined,
    })
  }
  return { pages, edges: WORKSPACE_EDGES, fetchedAt: Date.now() }
}
