import type { GraphEdge, GraphNode, KnowledgeGraph } from "@/lib/vaultmind-types"
import type {
  StackerCacheAdapter,
  StackerChunk,
  StackerGraphAdapter,
  StackerRetrievalHit,
  StackerVectorAdapter,
} from "./types"

const graphByUser = new Map<string, { nodes: Map<string, GraphNode>; edges: GraphEdge[] }>()
const chunksByUser = new Map<string, StackerChunk[]>()
const cache = new Map<string, { value: unknown; expiresAt: number }>()

const STOPWORDS = new Set([
  "the","a","an","and","or","but","of","to","in","on","for","with","is","are","was","were",
  "be","been","this","that","what","how","why","when","where","which","who","tell","show",
  "find","give","about","my","me","i","can","could","would","should","will","need","want",
])

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(token => token.length > 1 && !STOPWORDS.has(token))
}

function graphStore(userKey: string) {
  let store = graphByUser.get(userKey)
  if (!store) {
    store = { nodes: new Map(), edges: [] }
    graphByUser.set(userKey, store)
  }
  return store
}

export const memoryGraphAdapter: StackerGraphAdapter = {
  async upsertNodes(userKey: string, nodes: GraphNode[]) {
    const store = graphStore(userKey)
    for (const node of nodes) store.nodes.set(node.id, node)
  },

  async upsertEdges(userKey: string, edges: GraphEdge[]) {
    const store = graphStore(userKey)
    const seen = new Set(store.edges.map(edgeKey))
    for (const edge of edges) {
      const key = edgeKey(edge)
      if (seen.has(key)) continue
      seen.add(key)
      store.edges.push(edge)
    }
  },

  async expand(userKey: string, seedIds: string[], limit: number): Promise<KnowledgeGraph> {
    const store = graphStore(userKey)
    const included = new Set(seedIds)
    for (const edge of store.edges) {
      if (included.size >= limit) break
      if (included.has(edge.from)) included.add(edge.to)
      if (included.has(edge.to)) included.add(edge.from)
    }

    const nodes = Array.from(included)
      .map(id => store.nodes.get(id))
      .filter((node): node is GraphNode => Boolean(node))
      .slice(0, limit)
    const kept = new Set(nodes.map(node => node.id))
    const edges = store.edges.filter(edge => kept.has(edge.from) && kept.has(edge.to))
    return { nodes, edges }
  },
}

export const memoryVectorAdapter: StackerVectorAdapter = {
  async upsertChunks(chunks: StackerChunk[]) {
    if (chunks.length === 0) return
    const userKey = chunks[0].userKey
    const existing = chunksByUser.get(userKey) ?? []
    const byId = new Map(existing.map(chunk => [chunk.id, chunk]))
    for (const chunk of chunks) byId.set(chunk.id, chunk)
    chunksByUser.set(userKey, Array.from(byId.values()))
  },

  async search(userKey: string, query: string, limit: number): Promise<StackerRetrievalHit[]> {
    const chunks = chunksByUser.get(userKey) ?? []
    const qTokens = tokenize(query)
    if (qTokens.length === 0) return []

    const scored = chunks
      .map(chunk => {
        const textTokens = tokenize(`${chunk.title} ${chunk.text}`)
        let score = 0
        for (const token of qTokens) {
          const count = textTokens.reduce((sum, item) => sum + (item === token ? 1 : 0), 0)
          if (count > 0) score += count / Math.sqrt(textTokens.length || 1)
          if (chunk.title.toLowerCase().includes(token)) score += 0.5
        }
        return { chunk, score }
      })
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)

    return scored.map(item => ({
      documentId: item.chunk.documentId,
      chunkId: item.chunk.id,
      title: item.chunk.title,
      text: item.chunk.text,
      score: item.score,
      source: "vector",
    }))
  },
}

export const memoryCacheAdapter: StackerCacheAdapter = {
  async get<T>(key: string): Promise<T | null> {
    const hit = cache.get(key)
    if (!hit) return null
    if (Date.now() > hit.expiresAt) {
      cache.delete(key)
      return null
    }
    return hit.value as T
  },

  async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
    cache.set(key, { value, expiresAt: Date.now() + ttlMs })
  },
}

function edgeKey(edge: GraphEdge): string {
  const a = edge.from < edge.to ? edge.from : edge.to
  const b = edge.from < edge.to ? edge.to : edge.from
  return `${a}|${b}|${edge.relation ?? ""}`
}
