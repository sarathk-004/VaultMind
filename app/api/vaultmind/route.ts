import { type NextRequest, NextResponse } from "next/server"
import type {
  VaultmindRequest,
  VaultmindResponse,
  GraphNode,
  GraphEdge,
  Intent,
} from "@/lib/vaultmind-types"
import { WORKSPACE, WORKSPACE_EDGES, ALL_NODE_IDS, NOTE_CONTENT } from "@/lib/workspace-data"

// ──────────────────────────────────────────────────────────────────────────────
// Query → relevant subgraph
// ──────────────────────────────────────────────────────────────────────────────

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "for", "with", "is",
  "are", "was", "were", "be", "been", "being", "this", "that", "what", "how", "why",
  "when", "where", "which", "who", "i", "me", "my", "we", "us", "our", "you", "your",
  "it", "its", "do", "does", "did", "have", "has", "had", "should", "would", "could",
  "tell", "show", "give", "find", "about", "from", "into", "summarize", "summary",
  "connect", "brief", "search", "today", "now",
])

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(t => t.length > 2 && !STOPWORDS.has(t))
}

function scoreNode(query: string, node: GraphNode): number {
  const tokens = tokenize(query)
  if (tokens.length === 0) return 0
  const haystack = `${node.label} ${node.id} ${node.type ?? ""}`.toLowerCase()
  let score = 0
  for (const t of tokens) {
    if (haystack.includes(t)) score += 3
    // partial / fuzzy
    if (haystack.split(/\s+/).some(word => word.startsWith(t))) score += 1
  }
  return score
}

function buildAdjacency(edges: GraphEdge[]): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>()
  for (const e of edges) {
    if (!adj.has(e.from)) adj.set(e.from, new Set())
    if (!adj.has(e.to)) adj.set(e.to, new Set())
    adj.get(e.from)!.add(e.to)
    adj.get(e.to)!.add(e.from)
  }
  return adj
}

/**
 * Hash for deterministic fallback when nothing matches.
 */
function hashString(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i)
    hash = hash & hash
  }
  return Math.abs(hash)
}

/**
 * Pick seed nodes for a query:
 * 1. Score every node against the query, take top matches
 * 2. If nothing matches, fall back to a deterministic anchor based on intent
 */
function pickSeedNodes(query: string, intent: Intent | undefined): GraphNode[] {
  const scored = ALL_NODE_IDS
    .map(id => ({ node: WORKSPACE[id], score: scoreNode(query, WORKSPACE[id]) }))
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)

  if (scored.length > 0) {
    return scored.slice(0, 3).map(s => s.node)
  }

  // Intent-aware fallback anchors
  const intentAnchors: Record<Intent, string[]> = {
    search: ["product-strategy", "engineering-wiki"],
    summarize: ["roadmap-q1", "product-strategy"],
    connect: ["product-strategy", "engineering-wiki", "design-system-v3"],
    brief: ["sprint-board", "task-ship-2-4", "note-standup-0315"],
  }
  const anchors = intentAnchors[intent ?? "search"]
  // Add a deterministic third pick from the workspace for variety
  const seed = hashString(query)
  const extra = ALL_NODE_IDS[seed % ALL_NODE_IDS.length]
  return Array.from(new Set([...anchors, extra])).slice(0, 3).map(id => WORKSPACE[id])
}

/**
 * Build a focused subgraph: seed nodes + their 1-hop neighbors,
 * plus the edges between every node in that set.
 */
function buildSubgraph(seeds: GraphNode[], maxNodes: number): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const adj = buildAdjacency(WORKSPACE_EDGES)
  const included = new Set<string>(seeds.map(s => s.id))

  // Add 1-hop neighbors of each seed
  for (const seed of seeds) {
    const neighbors = adj.get(seed.id)
    if (!neighbors) continue
    for (const n of neighbors) {
      if (included.size >= maxNodes) break
      included.add(n)
    }
  }

  // If still small, expand to 2-hop
  if (included.size < Math.min(maxNodes, 6)) {
    const second = new Set<string>()
    for (const id of included) {
      const neighbors = adj.get(id)
      if (!neighbors) continue
      for (const n of neighbors) second.add(n)
    }
    for (const id of second) {
      if (included.size >= maxNodes) break
      included.add(id)
    }
  }

  const nodes = Array.from(included).map(id => WORKSPACE[id]).filter(Boolean)
  const edges = WORKSPACE_EDGES.filter(e => included.has(e.from) && included.has(e.to))

  return { nodes, edges }
}

// ──────────────────────────────────────────────────────────────────────────────
// Answer generators per intent (uses real note content)
// ──────────────────────────────────────────────────────────────────────────────

function listFmt(items: string[]): string {
  if (items.length === 0) return ""
  if (items.length === 1) return items[0]
  if (items.length === 2) return `${items[0]} and ${items[1]}`
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`
}

function answerForSearch(query: string, nodes: GraphNode[]): string {
  const top = nodes.slice(0, 5)
  const groupedByType: Record<string, string[]> = {}
  for (const n of top) {
    const t = n.type || "page"
    if (!groupedByType[t]) groupedByType[t] = []
    groupedByType[t].push(`**${n.label}**`)
  }

  const lines: string[] = []
  lines.push(`I searched your workspace for "${query}" and found ${nodes.length} relevant items.`)
  lines.push("")
  for (const [type, items] of Object.entries(groupedByType)) {
    lines.push(`**${capitalize(type)}s** — ${items.join(", ")}`)
  }
  lines.push("")
  lines.push("Open any citation below to read the source, or click a node in the graph to jump to it.")
  return lines.join("\n")
}

function answerForSummarize(query: string, nodes: GraphNode[]): string {
  const primary = nodes[0]
  if (!primary) return `I couldn't find anything to summarize for "${query}".`

  const note = NOTE_CONTENT[primary.id]
  const supportNames = nodes.slice(1, 4).map(n => `**${n.label}**`)

  const lines: string[] = []
  lines.push(`Here's a summary based on "${query}", grounded in **${primary.label}**:`)
  lines.push("")

  if (note) {
    // Pull the first non-heading bullet/paragraphs as the summary skeleton
    const condensed = condenseContent(note.content)
    lines.push(condensed)
  } else {
    lines.push(`${primary.label} is the central reference for this topic.`)
  }

  if (supportNames.length > 0) {
    lines.push("")
    lines.push(`**Cross-references**: ${listFmt(supportNames)}.`)
  }

  return lines.join("\n")
}

function answerForConnect(query: string, nodes: GraphNode[], edges: GraphEdge[]): string {
  const lines: string[] = []
  lines.push(`I traced ${edges.length} connection${edges.length === 1 ? "" : "s"} for "${query}" across ${nodes.length} item${nodes.length === 1 ? "" : "s"}.`)
  lines.push("")

  // Surface the strongest 4 relationships in plain English
  const interesting = edges.slice(0, 4)
  for (const e of interesting) {
    const a = WORKSPACE[e.from]
    const b = WORKSPACE[e.to]
    if (!a || !b) continue
    const verb = e.relation || "is related to"
    lines.push(`- **${a.label}** ${verb} **${b.label}**`)
  }

  if (edges.length > 4) {
    lines.push(`- …and ${edges.length - 4} more relationships in the graph.`)
  }

  lines.push("")
  lines.push("Hover any node on the right to see its direct neighbors highlighted.")
  return lines.join("\n")
}

function answerForBrief(query: string, nodes: GraphNode[]): string {
  const tasks = nodes.filter(n => n.type === "task")
  const notes = nodes.filter(n => n.type === "note")
  const dbs = nodes.filter(n => n.type === "database")
  const pages = nodes.filter(n => n.type === "page")

  const lines: string[] = []
  lines.push(`**Today's brief — ${query}**`)
  lines.push("")

  if (tasks.length > 0) {
    lines.push(`**In flight (${tasks.length})**`)
    for (const t of tasks.slice(0, 4)) {
      const note = NOTE_CONTENT[t.id]
      const status = note ? extractStatus(note.content) : null
      lines.push(`- ${t.label}${status ? ` — _${status}_` : ""}`)
    }
    lines.push("")
  }

  if (notes.length > 0) {
    lines.push(`**Recent notes**: ${notes.slice(0, 3).map(n => n.label).join(" · ")}`)
  }

  if (pages.length > 0 || dbs.length > 0) {
    const refs = [...pages, ...dbs].slice(0, 3).map(n => `**${n.label}**`)
    lines.push(`**Key references**: ${listFmt(refs)}.`)
  }

  lines.push("")
  lines.push("Click any citation to open the page, or tap a node to focus the graph.")
  return lines.join("\n")
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function condenseContent(md: string): string {
  // Strip headings and join the first 3 meaningful lines into a paragraph.
  const lines = md
    .split("\n")
    .map(l => l.trim())
    .filter(l => l.length > 0 && !l.startsWith("#"))
  const picked: string[] = []
  for (const l of lines) {
    if (picked.length >= 3) break
    picked.push(l.replace(/^[-*]\s*/, "• "))
  }
  return picked.join("\n")
}

function extractStatus(md: string): string | null {
  const match = md.match(/\*\*Status\*\*:\s*([^\n]+)/i)
  return match ? match[1].trim() : null
}

// ──────────────────────────────────────────────────────────────────────────────
// API Route Handler
// ──────────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const { message, intent }: VaultmindRequest = await req.json()

    if (!message || typeof message !== "string" || message.trim().length === 0) {
      return NextResponse.json({ error: "Message is required" }, { status: 400 })
    }

    // Simulate realistic latency (API processing + MCP fetch)
    await new Promise(resolve => setTimeout(resolve, 600 + Math.random() * 400))

    const seeds = pickSeedNodes(message, intent)
    const maxNodes = intent === "brief" ? 9 : intent === "connect" ? 10 : 7
    const graph = buildSubgraph(seeds, maxNodes)

    let answer: string
    switch (intent) {
      case "summarize":
        answer = answerForSummarize(message, graph.nodes)
        break
      case "connect":
        answer = answerForConnect(message, graph.nodes, graph.edges)
        break
      case "brief":
        answer = answerForBrief(message, graph.nodes)
        break
      case "search":
      default:
        answer = answerForSearch(message, graph.nodes)
        break
    }

    const response: VaultmindResponse = { answer, graph }
    return NextResponse.json(response)
  } catch (error) {
    console.error("[v0] VaultMind API error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
