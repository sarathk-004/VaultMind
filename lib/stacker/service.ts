import type { CachedSnapshot } from "@/lib/notion-retriever"
import { buildSubgraph, fetchPageContent, rankPages, snapshotToGraph } from "@/lib/notion-retriever"
import type { Intent, KnowledgeGraph } from "@/lib/vaultmind-types"
import { getStackerAdapters } from "./adapters"
import { chunkDocument, extractLightweightEntities } from "./chunking"
import { getStackerConfig, stackerServiceHints } from "./config"
import { resolveWorkspaceIdentity } from "./identity"
import { memoryCacheAdapter, memoryGraphAdapter, memoryVectorAdapter } from "./memory"
import type {
  StackerChunk,
  StackerConfig,
  StackerDocument,
  StackerRetrievalHit,
  StackerRetrievalContext,
} from "./types"

const INDEX_TTL_MS = 5 * 60_000
const RETRIEVAL_CACHE_TTL_MS = 60_000
const ADAPTER_TIMEOUT_MS = 2_000

interface StackerRetrieveOptions {
  query: string
  intent: Intent
  snapshot: CachedSnapshot
  token?: string | null
  contentLimit: number
  config?: StackerConfig
  workspaceId?: string | null
}

interface StackerWorkspaceOptions {
  snapshot: CachedSnapshot
  token?: string | null
  config?: StackerConfig
  workspaceId?: string | null
}

interface StackerSyncOptions extends StackerWorkspaceOptions {
  maxDocuments?: number
}

export function isStackerEnabled(config = getStackerConfig()): boolean {
  return config.enabled
}

export function getStackerRuntimeWarnings(config = getStackerConfig()): string[] {
  const warnings = stackerServiceHints(config)
  return warnings
}

export async function getStackerWorkspaceGraph({
  snapshot,
  token,
  config = getStackerConfig(),
  workspaceId,
}: StackerWorkspaceOptions): Promise<KnowledgeGraph> {
  const identity = resolveWorkspaceIdentity({
    workspaceId,
    token,
    source: snapshot.source,
  })
  const userKey = identity.userKey
  const adapters = getStackerAdapters(config)
  const graph = snapshotToGraph(snapshot)
  await withMemoryFallback(
    "graph workspace upsert",
    () => adapters.graph.upsertNodes(userKey, graph.nodes),
    () => memoryGraphAdapter.upsertNodes(userKey, graph.nodes),
  )
  await withMemoryFallback(
    "graph workspace edge upsert",
    () => adapters.graph.upsertEdges(userKey, graph.edges),
    () => memoryGraphAdapter.upsertEdges(userKey, graph.edges),
  )
  await withMemoryFallback(
    "workspace graph cache",
    () => adapters.cache.set(cacheKey(userKey, "workspace-graph"), graph, INDEX_TTL_MS),
    () => memoryCacheAdapter.set(cacheKey(userKey, "workspace-graph"), graph, INDEX_TTL_MS),
  )
  logStackerWarnings(config)
  return graph
}

export async function syncStackerWorkspace({
  snapshot,
  token,
  config = getStackerConfig(),
  maxDocuments = 50,
  workspaceId,
}: StackerSyncOptions) {
  const identity = resolveWorkspaceIdentity({
    workspaceId,
    token,
    source: snapshot.source,
  })
  const userKey = identity.userKey
  const adapters = getStackerAdapters(config)
  const graph = await getStackerWorkspaceGraph({ snapshot, token, config, workspaceId })
  const pages = Array.from(snapshot.pages.values()).slice(0, maxDocuments)
  const contents = await Promise.all(
    pages.map(page => fetchPageContent(page.id, token).catch(() => null)),
  )
  const documents = contents
    .filter((content): content is NonNullable<typeof content> => content !== null)
    .map(content => ({
      id: content.id,
      userKey,
      workspaceId: identity.workspaceId,
      source: snapshot.usingMock ? "mock" : "notion",
      title: content.title,
      type: content.type,
      url: content.url,
      content: content.content,
    } satisfies StackerDocument))
  const chunks = documents.flatMap(chunkDocument)
  await withMemoryFallback(
    "document store upsert",
    () => adapters.store.upsertDocuments(documents),
    () => Promise.resolve(),
  )
  await withMemoryFallback(
    "vector chunk upsert",
    () => adapters.vector.upsertChunks(chunks),
    () => memoryVectorAdapter.upsertChunks(chunks),
  )
  await withMemoryFallback(
    "sync cache",
    () => adapters.cache.set(cacheKey(userKey, "last-sync"), {
      syncedAt: Date.now(),
      documentCount: documents.length,
      chunkCount: chunks.length,
      graph,
    }, INDEX_TTL_MS),
    () => memoryCacheAdapter.set(cacheKey(userKey, "last-sync"), {
      syncedAt: Date.now(),
      documentCount: documents.length,
      chunkCount: chunks.length,
      graph,
    }, INDEX_TTL_MS),
  )

  return {
    syncedAt: Date.now(),
    documentCount: documents.length,
    chunkCount: chunks.length,
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    store: config.store,
    graph: config.graph,
    vector: config.vector,
    cache: config.cache,
    warnings: getStackerRuntimeWarnings(config),
  }
}

export async function retrieveWithStacker({
  query,
  intent,
  snapshot,
  token,
  contentLimit,
  config = getStackerConfig(),
  workspaceId,
}: StackerRetrieveOptions): Promise<StackerRetrievalContext> {
  const identity = resolveWorkspaceIdentity({
    workspaceId,
    token,
    source: snapshot.source,
  })
  const userKey = identity.userKey
  const adapters = getStackerAdapters(config)
  const retrievalKey = cacheKey(userKey, `retrieval:${intent}:${query}:${contentLimit}`)
  const cached = await withMemoryFallback(
    "retrieval cache read",
    () => adapters.cache.get<StackerRetrievalContext>(retrievalKey),
    () => memoryCacheAdapter.get<StackerRetrievalContext>(retrievalKey),
  )
  if (cached) return cached

  const ranked = await rankPages(query, snapshot, token)
  const seeds = ranked.slice(0, Math.max(contentLimit, 6))
  const contents = await Promise.all(
    ranked.slice(0, Math.max(contentLimit, 8)).map(page => fetchPageContent(page.id, token)),
  )
  const documents = contents
    .filter((content): content is NonNullable<typeof content> => content !== null)
    .map(content => ({
      id: content.id,
      userKey,
      workspaceId: identity.workspaceId,
      source: snapshot.usingMock ? "mock" : "notion",
      title: content.title,
      type: content.type,
      url: content.url,
      content: content.content,
    } satisfies StackerDocument))

  const chunks = documents.flatMap(chunkDocument)
  const baseGraph = buildSubgraph(seeds, snapshot)
  await withMemoryFallback(
    "document store upsert",
    () => adapters.store.upsertDocuments(documents),
    () => Promise.resolve(),
  )
  await withMemoryFallback(
    "graph node upsert",
    () => adapters.graph.upsertNodes(userKey, baseGraph.nodes),
    () => memoryGraphAdapter.upsertNodes(userKey, baseGraph.nodes),
  )
  await withMemoryFallback(
    "graph edge upsert",
    () => adapters.graph.upsertEdges(userKey, baseGraph.edges),
    () => memoryGraphAdapter.upsertEdges(userKey, baseGraph.edges),
  )
  await withMemoryFallback(
    "vector chunk upsert",
    () => adapters.vector.upsertChunks(chunks),
    () => memoryVectorAdapter.upsertChunks(chunks),
  )

  const vectorHits = await withMemoryFallback(
    "vector search",
    () => adapters.vector.search(userKey, query, Math.max(contentLimit, 8)),
    () => memoryVectorAdapter.search(userKey, query, Math.max(contentLimit, 8)),
  )
  const indexedDocuments = await withMemoryFallback(
    "document store read",
    () => adapters.store.getDocuments(
      userKey,
      Array.from(new Set(vectorHits.map(hit => hit.documentId))),
    ),
    () => Promise.resolve([]),
  )
  const contextDocuments = mergeDocuments(documents, indexedDocuments)
  const keywordHits = buildKeywordHits(query, contextDocuments, Math.max(contentLimit, 8))
  const hits = mergeHits(vectorHits, keywordHits).slice(0, Math.max(contentLimit, 8))

  const seedIds = hits.length > 0
    ? hits.map(hit => hit.documentId)
    : seeds.map(seed => seed.id)
  const graph = seedIds.length > 0
    ? await withMemoryFallback(
      "graph expansion",
      () => adapters.graph.expand(userKey, seedIds, 14),
      () => memoryGraphAdapter.expand(userKey, seedIds, 14),
    )
    : baseGraph

  const context: StackerRetrievalContext = {
    intent,
    query,
    documents: contextDocuments,
    chunks,
    hits,
    graph: graph.nodes.length > 0 ? graph : baseGraph,
    stats: {
      source: "stacker",
      store: config.store,
      graph: config.graph,
      vector: config.vector,
      cache: config.cache,
      documentCount: contextDocuments.length,
      chunkCount: chunks.length,
      hitCount: hits.length,
    },
  }

  // The current entity extraction is intentionally light, but it gives the
  // worker a stable place to grow into richer Neo4j relationship discovery.
  extractLightweightEntities(contextDocuments)

  await withMemoryFallback(
    "retrieval cache write",
    () => adapters.cache.set(retrievalKey, context, RETRIEVAL_CACHE_TTL_MS),
    () => memoryCacheAdapter.set(retrievalKey, context, RETRIEVAL_CACHE_TTL_MS),
  )
  logStackerWarnings(config)
  return context
}

function buildKeywordHits(
  query: string,
  documents: StackerDocument[],
  limit: number,
): StackerRetrievalHit[] {
  const tokens = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)

  return documents
    .map(doc => {
      const haystack = `${doc.title} ${doc.content}`.toLowerCase()
      const score = tokens.reduce((sum, token) => sum + (haystack.includes(token) ? 1 : 0), 0)
      return {
        documentId: doc.id,
        title: doc.title,
        text: doc.content.slice(0, 1200),
        score,
        source: "keyword" as const,
      }
    })
    .filter(hit => hit.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

function mergeHits(
  primary: StackerRetrievalHit[],
  secondary: StackerRetrievalHit[],
) {
  const byDocument = new Map<string, StackerRetrievalHit>()
  for (const hit of [...primary, ...secondary]) {
    const existing = byDocument.get(hit.documentId)
    if (!existing || hit.score > existing.score) byDocument.set(hit.documentId, hit)
  }
  return Array.from(byDocument.values()).sort((a, b) => b.score - a.score)
}

function mergeDocuments(
  primary: StackerDocument[],
  secondary: StackerDocument[],
): StackerDocument[] {
  const byId = new Map<string, StackerDocument>()
  for (const doc of [...primary, ...secondary]) byId.set(doc.id, doc)
  return Array.from(byId.values())
}

function cacheKey(userKey: string, key: string): string {
  return `stacker:${userKey}:${key}`
}

function logStackerWarnings(config: StackerConfig): void {
  const warnings = getStackerRuntimeWarnings(config)
  for (const warning of warnings) console.warn(`[stacker] ${warning}`)
}

async function withMemoryFallback<T>(
  label: string,
  operation: () => Promise<T>,
  fallback: () => Promise<T>,
): Promise<T> {
  try {
    return await withTimeout(operation(), ADAPTER_TIMEOUT_MS, label)
  } catch (error) {
    console.warn(
      `[stacker] ${label} failed; using memory fallback:`,
      error instanceof Error ? error.message : error,
    )
    return fallback()
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    promise.then(
      value => {
        clearTimeout(timer)
        resolve(value)
      },
      error => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}
