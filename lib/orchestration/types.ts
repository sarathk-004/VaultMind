import type { Intent, KnowledgeGraph } from "@/lib/vaultmind-types"
import type { StackerRetrievalHit } from "@/lib/stacker/types"

export type PlannerStepKind =
  | "notion"
  | "stacker"
  | "graph"
  | "vector"
  | "keyword"
  | "mcp"
  | "web"

export interface PlannerStep {
  kind: PlannerStepKind
  enabled: boolean
  reason: string
}

export interface PlannerPlan {
  intent: Intent
  contentLimit: number
  steps: PlannerStep[]
}

export interface OrchestrationDocument {
  id: string
  title: string
  type: string
  content: string
  url?: string
}

export interface OrchestrationResult {
  plan: PlannerPlan
  documents: OrchestrationDocument[]
  hits: StackerRetrievalHit[]
  graph: KnowledgeGraph
  topPages: Array<{ id: string; title: string; type: string }>
}
