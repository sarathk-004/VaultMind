import type { GraphEdge, GraphNode, Intent, KnowledgeGraph, NodeType } from "@/lib/vaultmind-types"

export type StackerStoreKind = "memory" | "postgres-pgvector"
export type StackerGraphKind = "memory" | "neo4j"
export type StackerVectorKind = "memory" | "chroma" | "pgvector"
export type StackerCacheKind = "memory" | "redis"

export interface StackerConfig {
  enabled: boolean
  store: StackerStoreKind
  graph: StackerGraphKind
  vector: StackerVectorKind
  cache: StackerCacheKind
}

export interface StackerDocument {
  id: string
  userKey: string
  source: "notion" | "mock"
  title: string
  type: NodeType | string
  url?: string
  content: string
  updatedAt?: string
}

export interface StackerChunk {
  id: string
  documentId: string
  userKey: string
  title: string
  text: string
  index: number
  tokenEstimate: number
}

export interface StackerEntity {
  id: string
  userKey: string
  name: string
  kind: "topic" | "page" | "date" | "person" | "project" | "unknown"
  documentIds: string[]
}

export interface StackerRetrievalHit {
  documentId: string
  chunkId?: string
  title: string
  text: string
  score: number
  source: "vector" | "graph" | "keyword" | "date"
}

export interface StackerRetrievalContext {
  intent: Intent
  query: string
  documents: StackerDocument[]
  chunks: StackerChunk[]
  hits: StackerRetrievalHit[]
  graph: KnowledgeGraph
  stats: {
    source: "stacker" | "legacy"
    store: StackerStoreKind
    graph: StackerGraphKind
    vector: StackerVectorKind
    cache: StackerCacheKind
    documentCount: number
    chunkCount: number
    hitCount: number
  }
}

export interface StackerStoreAdapter {
  upsertDocuments(documents: StackerDocument[]): Promise<void>
  getDocuments(userKey: string, ids: string[]): Promise<StackerDocument[]>
}

export interface StackerGraphAdapter {
  upsertNodes(userKey: string, nodes: GraphNode[]): Promise<void>
  upsertEdges(userKey: string, edges: GraphEdge[]): Promise<void>
  expand(userKey: string, seedIds: string[], limit: number): Promise<KnowledgeGraph>
}

export interface StackerVectorAdapter {
  upsertChunks(chunks: StackerChunk[]): Promise<void>
  search(userKey: string, query: string, limit: number): Promise<StackerRetrievalHit[]>
}

export interface StackerCacheAdapter {
  get<T>(key: string): Promise<T | null>
  set<T>(key: string, value: T, ttlMs: number): Promise<void>
}
