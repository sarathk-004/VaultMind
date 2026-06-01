import type { KnowledgeGraph } from "@/lib/vaultmind-types"
import type { StackerRetrievalHit } from "@/lib/stacker/types"
import type { OrchestrationDocument } from "./types"

export function mergeDocuments(
  primary: OrchestrationDocument[],
  secondary: OrchestrationDocument[],
): OrchestrationDocument[] {
  const byId = new Map<string, OrchestrationDocument>()
  for (const doc of [...primary, ...secondary]) byId.set(doc.id, doc)
  return Array.from(byId.values())
}

export function mergeHits(
  primary: StackerRetrievalHit[],
  secondary: StackerRetrievalHit[],
): StackerRetrievalHit[] {
  const byDocument = new Map<string, StackerRetrievalHit>()
  for (const hit of [...primary, ...secondary]) {
    const existing = byDocument.get(hit.documentId)
    if (!existing || hit.score > existing.score) byDocument.set(hit.documentId, hit)
  }
  return Array.from(byDocument.values()).sort((a, b) => b.score - a.score)
}

export function selectGraph(
  stackerGraph: KnowledgeGraph | null,
  fallbackGraph: KnowledgeGraph,
): KnowledgeGraph {
  if (stackerGraph && stackerGraph.nodes.length > 0) return stackerGraph
  return fallbackGraph
}
