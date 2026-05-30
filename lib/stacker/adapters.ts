import { memoryCacheAdapter, memoryGraphAdapter, memoryVectorAdapter } from "./memory"
import { neo4jGraphAdapter } from "./neo4j"
import { pgvectorAdapter, postgresStoreAdapter } from "./postgres"
import { redisCacheAdapter } from "./redis"
import type {
  StackerCacheAdapter,
  StackerConfig,
  StackerGraphAdapter,
  StackerStoreAdapter,
  StackerVectorAdapter,
} from "./types"

const memoryStoreAdapter: StackerStoreAdapter = {
  async upsertDocuments() {
    return undefined
  },
  async getDocuments() {
    return []
  },
}

export function getStackerAdapters(config: StackerConfig): {
  store: StackerStoreAdapter
  graph: StackerGraphAdapter
  vector: StackerVectorAdapter
  cache: StackerCacheAdapter
} {
  return {
    store: config.store === "postgres-pgvector" || config.vector === "pgvector"
      ? postgresStoreAdapter
      : memoryStoreAdapter,
    graph: config.graph === "neo4j" ? neo4jGraphAdapter : memoryGraphAdapter,
    vector: config.vector === "pgvector" || config.store === "postgres-pgvector"
      ? pgvectorAdapter
      : memoryVectorAdapter,
    cache: config.cache === "redis" ? redisCacheAdapter : memoryCacheAdapter,
  }
}
