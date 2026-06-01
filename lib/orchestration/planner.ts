import type { Intent } from "@/lib/vaultmind-types"
import type { PlannerPlan, PlannerStep } from "./types"

interface PlannerOptions {
  contentLimit: number
  stackerEnabled: boolean
}

export function planQuery(intent: Intent, options: PlannerOptions): PlannerPlan {
  const steps: PlannerStep[] = []

  const add = (kind: PlannerStep["kind"], enabled: boolean, reason: string) => {
    steps.push({ kind, enabled, reason })
  }

  add("notion", true, "Notion remains the source of truth")
  add("stacker", options.stackerEnabled, "Use vector + graph retrieval when enabled")

  if (intent === "connect") {
    add("graph", true, "Relationship queries need graph traversal")
  }

  if (intent === "brief") {
    add("keyword", true, "Briefing prefers explicit date tokens")
  }

  add("mcp", false, "MCP tools are not wired into orchestration yet")
  add("web", false, "Web search is gated by policy")

  return {
    intent,
    contentLimit: options.contentLimit,
    steps,
  }
}
