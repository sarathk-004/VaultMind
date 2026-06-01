import type { StackerConfig } from "./types"

export function getStackerConfig(): StackerConfig {
  return {
    enabled: process.env.VAULTMIND_STACKER_ENABLED === "true",
    store: process.env.VAULTMIND_STACKER_STORE === "postgres-pgvector"
      ? "postgres-pgvector"
      : "memory",
    graph: process.env.VAULTMIND_STACKER_GRAPH === "neo4j"
      ? "neo4j"
      : process.env.VAULTMIND_STACKER_GRAPH === "postgres"
        ? "postgres"
        : "memory",
    vector: process.env.VAULTMIND_STACKER_VECTOR === "chroma"
      ? "chroma"
      : process.env.VAULTMIND_STACKER_VECTOR === "pgvector"
        ? "pgvector"
        : "memory",
    cache: process.env.VAULTMIND_STACKER_CACHE === "redis" ? "redis" : "memory",
  }
}

export function stackerServiceHints(config = getStackerConfig()): string[] {
  const hints: string[] = []
  if (config.store === "postgres-pgvector" && !process.env.DATABASE_URL) {
    hints.push("DATABASE_URL is not set; falling back to the legacy in-process retriever.")
  }
  if (config.graph === "neo4j" && !process.env.NEO4J_URI) {
    hints.push("NEO4J_URI is not set; graph persistence will stay in memory.")
  }
  if (config.graph === "postgres" && !process.env.DATABASE_URL) {
    hints.push("DATABASE_URL is not set; Postgres graph persistence will stay in memory.")
  }
  if (config.vector === "chroma" && !process.env.CHROMA_URL) {
    hints.push("CHROMA_URL is not set; vector search will stay lexical/in memory.")
  }
  if (config.cache === "redis" && !process.env.REDIS_URL) {
    hints.push("REDIS_URL is not set; cache will stay in process memory.")
  }
  return hints
}
