import {
  notionFetch,
  isNotionConnected,
  getPageTitle,
  getDatabaseTitle,
  type NotionPage,
  type NotionDatabase,
  type NotionSearchResponse,
  type NotionBlockChildrenResponse,
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
}

interface CachedSnapshot {
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

let snapshot: CachedSnapshot | null = null
const SNAPSHOT_TTL = 5 * 60_000 // 5 minutes
const pageCache = new Map<string, CachedPageContent>()
const PAGE_CACHE_TTL = 10 * 60_000 // 10 minutes

/**
 * Fetch all accessible pages & databases from Notion. Returns a snapshot
 * with { pages, edges }. Falls back to local mock workspace if Notion is unavailable.
 */
export async function getWorkspaceSnapshot(): Promise<CachedSnapshot> {
  if (!isNotionConnected()) {
    console.log("[v0] NOTION_API_KEY not set — using local mock workspace")
    return mockSnapshot()
  }

  const now = Date.now()
  if (snapshot && snapshot.source === "notion" && now - snapshot.fetchedAt < SNAPSHOT_TTL) {
    return snapshot
  }

  try {
    const pages = new Map<string, NotionPageMeta>()
    let cursor: string | undefined
    let safetyCount = 0

    // Notion search with empty query lists everything the integration can see.
    do {
      const body: Record<string, unknown> = { page_size: 100 }
      if (cursor) body.start_cursor = cursor
      const res = await notionFetch<NotionSearchResponse>("/search", {
        method: "POST",
        body,
      })

      for (const item of res.results) {
        const meta = parseSearchResult(item)
        if (meta) pages.set(meta.id, meta)
      }

      cursor = res.next_cursor ?? undefined
      safetyCount++
    } while (cursor && safetyCount < 10) // up to 1000 items

    if (pages.size === 0) {
      // No pages shared with the integration — fall back so the UI isn't empty.
      console.log("[v0] Notion returned 0 pages — falling back to mock workspace")
      const mockSnap = mockSnapshot()
      mockSnap.usingMock = true
      return mockSnap
    }

    // Build parent-child edges
    const edges: GraphEdge[] = []
    for (const [id, meta] of pages) {
      if (meta.parentId && pages.has(meta.parentId)) {
        edges.push({ from: meta.parentId, to: id, relation: "contains" })
      }
    }

    snapshot = { pages, edges, fetchedAt: now, source: "notion", usingMock: false }
    console.log(`[v0] Fetched Notion workspace: ${pages.size} items, ${edges.length} edges`)
    return snapshot
  } catch (err) {
    console.error("[v0] Failed to fetch Notion workspace, falling back to mock data:", err)
    const mockSnap = mockSnapshot()
    mockSnap.usingMock = true
    return mockSnap
  }
}

/**
 * Convert the workspace snapshot into a KnowledgeGraph for rendering.
 */
export function snapshotToGraph(snap: CachedSnapshot): KnowledgeGraph {
  const nodes: GraphNode[] = []
  for (const [id, meta] of snap.pages) {
    nodes.push({ id, label: meta.title, type: meta.type })
  }
  return { nodes, edges: snap.edges }
}

/**
 * Rank pages by query token overlap.
 */
export function rankPages(query: string, snap: CachedSnapshot): NotionPageMeta[] {
  const tokens = tokenize(query)
  if (tokens.length === 0) {
    return Array.from(snap.pages.values()).slice(0, 7)
  }

  const scored = Array.from(snap.pages.values())
    .map(page => {
      const haystack = `${page.title} ${page.type}`.toLowerCase()
      let score = 0
      for (const t of tokens) {
        if (haystack.includes(t)) score += 3
      }
      return { page, score }
    })
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)

  if (scored.length === 0) {
    return Array.from(snap.pages.values()).slice(0, 7)
  }
  return scored.slice(0, 7).map(s => s.page)
}

/**
 * Fetch full markdown content for a Notion page (cached).
 */
export async function fetchPageContent(pageId: string): Promise<NoteContent | null> {
  const cleanId = pageId.replace(/-/g, "")
  const cached = pageCache.get(cleanId)
  const now = Date.now()
  if (cached && now - cached.fetchedAt < PAGE_CACHE_TTL) {
    return cached.content
  }

  if (!isNotionConnected()) {
    return NOTE_CONTENT[cleanId] ?? NOTE_CONTENT[pageId] ?? null
  }

  try {
    const snap = await getWorkspaceSnapshot()
    
    // If we're using mock data, don't try to fetch from Notion
    if (snap.usingMock) {
      return NOTE_CONTENT[cleanId] ?? NOTE_CONTENT[pageId] ?? null
    }
    
    const meta = snap.pages.get(cleanId) ?? snap.pages.get(pageId)
    if (!meta) {
      return NOTE_CONTENT[cleanId] ?? NOTE_CONTENT[pageId] ?? null
    }

    const res = await notionFetch<NotionBlockChildrenResponse>(
      `/blocks/${cleanId}/children?page_size=100`,
    )

    const { markdown, mentionedIds } = blocksToMarkdown(res.results)

    const content: NoteContent = {
      id: cleanId,
      title: meta.title,
      type: meta.type,
      content: markdown || "_(No content yet)_",
      relatedNodes: mentionedIds.map(id => id.replace(/-/g, "")),
    }

    pageCache.set(cleanId, { content, fetchedAt: now })
    return content
  } catch (err) {
    console.error(`[v0] Failed to fetch page ${cleanId}:`, err)
    return NOTE_CONTENT[cleanId] ?? NOTE_CONTENT[pageId] ?? null
  }
}

/**
 * Build a subgraph around the top-ranked pages (seeds + 1-hop neighbors).
 */
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

// ── Helpers ───────────────────────────────────────────────────────────────

function parseSearchResult(item: NotionPage | NotionDatabase): NotionPageMeta | null {
  if (item.archived || item.in_trash) return null

  if (item.object === "page") {
    const page = item as NotionPage
    return {
      id: page.id.replace(/-/g, ""),
      title: getPageTitle(page),
      type: guessPageType(page),
      parentId: extractParentId(page),
      url: page.url,
    }
  }
  if (item.object === "database") {
    const db = item as NotionDatabase
    return {
      id: db.id.replace(/-/g, ""),
      title: getDatabaseTitle(db),
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
  if (keys.includes("status") || keys.includes("assignee") || keys.includes("due"))
    return "task"
  if (keys.includes("tags") || keys.includes("type") || keys.includes("category"))
    return "note"
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
    })
  }
  return { pages, edges: WORKSPACE_EDGES, fetchedAt: Date.now(), source: "mock", usingMock: true }
}
