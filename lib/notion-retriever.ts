import {
  notionFetch,
  isNotionConnected,
  getPageTitle,
  getDatabaseTitle,
  richTextToPlain,
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

export function snapshotToGraph(snap: CachedSnapshot, maxNodes = 60): KnowledgeGraph {
  // Compute degree for every node and keep the most connected (hubs).
  const degree = new Map<string, number>()
  for (const e of snap.edges) {
    degree.set(e.from, (degree.get(e.from) ?? 0) + 1)
    degree.set(e.to, (degree.get(e.to) ?? 0) + 1)
  }

  const allMetas = Array.from(snap.pages.values())
  if (allMetas.length <= maxNodes) {
    const nodes: GraphNode[] = allMetas.map(m => ({ id: m.id, label: m.title, type: m.type }))
    return { nodes, edges: snap.edges }
  }

  const sorted = allMetas.slice().sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0))
  const kept = new Set<string>(sorted.slice(0, maxNodes).map(m => m.id))
  const nodes: GraphNode[] = sorted.slice(0, maxNodes).map(m => ({
    id: m.id,
    label: m.title,
    type: m.type,
  }))
  const edges = snap.edges.filter(e => kept.has(e.from) && kept.has(e.to))
  return { nodes, edges }
}

// ── Ranking ─────────────────────────────────────────────────────────────

const STOPWORDS = new Set([
  "the","a","an","and","or","but","of","to","in","on","for","with","is","are","was","were",
  "be","been","being","this","that","what","how","why","when","where","which","who","tell",
  "show","find","give","please","about","my","me","i","do","does","did","can","could","would",
])

/** Tokenize for scoring. Keeps short technical acronyms (ML, AI, JS) and numbers. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(t => t.length >= 2 && !STOPWORDS.has(t))
}

/** Word-boundary regex match — prevents "ML" from matching "small". */
function wordMatch(haystack: string, token: string): boolean {
  const re = new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i")
  return re.test(haystack)
}

interface ScoredPage {
  page: NotionPageMeta
  score: number
}

/**
 * Rank by:
 *   1. Notion's own `/search` (content-aware, server-side ranking)
 *   2. Token-based title scoring with word-boundary matching
 * Results are merged with Notion's results boosted (they search content too).
 */
export async function rankPages(query: string, snap: CachedSnapshot): Promise<NotionPageMeta[]> {
  const tokens = tokenize(query)
  if (tokens.length === 0) {
    return Array.from(snap.pages.values()).slice(0, 5)
  }

  // Score against the snapshot using word-boundary matching
  const scored: ScoredPage[] = Array.from(snap.pages.values())
    .map(page => {
      const title = page.title.toLowerCase()
      let score = 0
      for (const t of tokens) {
        if (wordMatch(title, t)) score += 10 // exact title word match
        else if (title.includes(t)) score += 2 // partial title contains
      }
      // Type bonus
      if (tokens.some(t => wordMatch(page.type, t))) score += 1
      return { page, score }
    })
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)

  // 2. Ask Notion for content-aware results (it indexes page bodies)
  let notionRanked: NotionPageMeta[] = []
  if (!snap.usingMock) {
    try {
      const res = await notionFetch<NotionSearchResponse>("/search", {
        method: "POST",
        body: { query, page_size: 12 },
      })
      for (const item of res.results) {
        const id = item.id.replace(/-/g, "")
        const meta = snap.pages.get(id) ?? parseSearchResult(item) ?? null
        if (meta) notionRanked.push(meta)
      }
      console.log(`[v0] Notion content search returned ${notionRanked.length} results for "${query}"`)
    } catch (err) {
      console.warn("[v0] Notion content search failed, using local scoring only:", err)
    }
  }

  // Merge: Notion results first (content-aware) then title-scored (deduped)
  const seen = new Set<string>()
  const merged: NotionPageMeta[] = []
  for (const p of notionRanked) {
    if (!seen.has(p.id)) {
      seen.add(p.id)
      merged.push(p)
    }
    if (merged.length >= 8) break
  }
  for (const s of scored) {
    if (merged.length >= 8) break
    if (!seen.has(s.page.id)) {
      seen.add(s.page.id)
      merged.push(s.page)
    }
  }

  // No matches at all → empty (do NOT fall back to random pages, that was the bug)
  return merged
}

// ── Page content ────────────────────────────────────────────────────────

/**
 * Fetch full markdown content for a Notion page or database. Recurses into
 * nested blocks (toggles, columns, tables) and inlines child_database rows.
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
    if (snap.usingMock) {
      return NOTE_CONTENT[cleanId] ?? NOTE_CONTENT[pageId] ?? null
    }

    const meta = snap.pages.get(cleanId) ?? snap.pages.get(pageId)
    if (!meta) return NOTE_CONTENT[cleanId] ?? NOTE_CONTENT[pageId] ?? null

    // If the page is itself a database, query its rows directly
    if (meta.type === "database") {
      const md = await fetchDatabaseMarkdown(cleanId, meta.title)
      const content: NoteContent = {
        id: cleanId,
        title: meta.title,
        type: meta.type,
        content: md || "_(Empty database)_",
        relatedNodes: [],
      }
      pageCache.set(cleanId, { content, fetchedAt: now })
      return content
    }

    // Regular page: fetch top-level blocks + recurse into nested children
    const topLevel = await fetchAllChildren(cleanId)
    const childrenMap = await prefetchNestedChildren(topLevel)

    const extracted = blocksToMarkdown(topLevel, { childrenMap })

    // Inline child_database rows
    let extraSections = ""
    for (const cdb of extracted.childDatabaseIds.slice(0, 3)) {
      const dbMd = await fetchDatabaseMarkdown(cdb.id.replace(/-/g, ""), cdb.title)
      if (dbMd) extraSections += `\n\n#### ${cdb.title}\n${dbMd}`
    }

    const content: NoteContent = {
      id: cleanId,
      title: meta.title,
      type: meta.type,
      content: (extracted.markdown + extraSections).trim() || "_(No content yet)_",
      relatedNodes: extracted.mentionedIds.map(id => id.replace(/-/g, "")),
    }

    pageCache.set(cleanId, { content, fetchedAt: now })
    return content
  } catch (err) {
    console.error(`[v0] Failed to fetch page ${cleanId}:`, err)
    return NOTE_CONTENT[cleanId] ?? NOTE_CONTENT[pageId] ?? null
  }
}

/** Fetch all top-level block children for a page (handles pagination). */
async function fetchAllChildren(blockId: string): Promise<NotionBlock[]> {
  const out: NotionBlock[] = []
  let cursor: string | undefined
  let safety = 0
  do {
    const path = `/blocks/${blockId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ""}`
    const res = await notionFetch<NotionBlockChildrenResponse>(path)
    out.push(...res.results)
    cursor = res.next_cursor ?? undefined
    safety++
  } while (cursor && safety < 5)
  return out
}

/**
 * For blocks that have children (toggle, column_list, column, synced_block,
 * table), fetch their child blocks once so the markdown converter can recurse.
 */
async function prefetchNestedChildren(
  blocks: NotionBlock[],
): Promise<Map<string, NotionBlock[]>> {
  const map = new Map<string, NotionBlock[]>()
  const NEEDS_CHILDREN = new Set([
    "toggle",
    "column_list",
    "column",
    "synced_block",
    "table",
    "bulleted_list_item",
    "numbered_list_item",
    "callout",
    "quote",
  ])

  // BFS one level deep, then for column_list go one more (to hit columns→content)
  const queue: { block: NotionBlock; depth: number }[] = blocks
    .filter(b => b.has_children && NEEDS_CHILDREN.has(b.type))
    .map(b => ({ block: b, depth: 0 }))

  let safety = 0
  while (queue.length > 0 && safety < 50) {
    const { block, depth } = queue.shift()!
    safety++
    if (map.has(block.id)) continue
    try {
      const kids = await fetchAllChildren(block.id)
      map.set(block.id, kids)
      if (depth < 2) {
        for (const k of kids) {
          if (k.has_children && NEEDS_CHILDREN.has(k.type)) {
            queue.push({ block: k, depth: depth + 1 })
          }
        }
      }
    } catch (e) {
      console.warn(`[v0] prefetch nested children failed for ${block.id}:`, e)
    }
  }
  return map
}

/** Query a Notion database and render its rows as a markdown table. */
async function fetchDatabaseMarkdown(databaseId: string, title: string): Promise<string> {
  try {
    const res = await notionFetch<{ results: NotionPage[] }>(
      `/databases/${databaseId}/query`,
      { method: "POST", body: { page_size: 25 } },
    )
    if (!res.results.length) return ""

    // Determine columns from the first row's properties
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
    case "title":
      return richTextToPlain(prop.title)
    case "rich_text":
      return richTextToPlain(prop.rich_text)
    case "select":
      return prop.select?.name ?? ""
    case "status":
      return prop.status?.name ?? ""
    case "multi_select":
      return (prop.multi_select ?? []).map((s: { name: string }) => s.name).join(", ")
    case "number":
      return prop.number != null ? String(prop.number) : ""
    case "checkbox":
      return prop.checkbox ? "✓" : ""
    case "date":
      return prop.date?.start ?? ""
    case "people":
      return (prop.people ?? []).map((p: { name?: string }) => p.name ?? "").join(", ")
    case "url":
      return prop.url ?? ""
    case "email":
      return prop.email ?? ""
    case "phone_number":
      return prop.phone_number ?? ""
    case "files":
      return (prop.files ?? []).map((f: { name?: string }) => f.name ?? "").join(", ")
    case "formula":
      return prop.formula?.string ?? prop.formula?.number?.toString() ?? ""
    case "relation":
      return (prop.relation ?? []).length + " linked"
    default:
      return ""
  }
}

// ── Subgraph builder ────────────────────────────────────────────────────

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
    if (meta) nodes.push({ id, label: meta.title, type: meta.type })
  }

  const edges = snap.edges.filter(e => included.has(e.from) && included.has(e.to))

  return { nodes, edges }
}

// ── Helpers ─────────────────────────────────────────────────────────────

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
