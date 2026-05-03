import { NextRequest, NextResponse } from "next/server"
import type { VaultmindRequest, VaultmindResponse, GraphNode, GraphEdge } from "@/lib/vaultmind-types"

// ──────────────────────────────────────────────────────────────────────────────
// Simulated workspace corpus — realistic Notion pages/tasks/databases/notes
// ──────────────────────────────────────────────────────────────────────────────

const WORKSPACE: Record<string, GraphNode> = {
  "roadmap-q1": { id: "roadmap-q1", label: "Roadmap Q1 2026", type: "page" },
  "product-strategy": { id: "product-strategy", label: "Product Strategy", type: "page" },
  "design-system-v3": { id: "design-system-v3", label: "Design System v3", type: "page" },
  "engineering-wiki": { id: "engineering-wiki", label: "Engineering Wiki", type: "page" },
  "api-documentation": { id: "api-documentation", label: "API Documentation", type: "page" },
  "onboarding-guide": { id: "onboarding-guide", label: "Onboarding Guide", type: "page" },
  "security-policies": { id: "security-policies", label: "Security & Policies", type: "page" },
  "brand-guidelines": { id: "brand-guidelines", label: "Brand Guidelines", type: "page" },
  "analytics-dashboard": { id: "analytics-dashboard", label: "Analytics Dashboard", type: "page" },
  "go-to-market-plan": { id: "go-to-market-plan", label: "Go-to-Market Plan", type: "page" },

  "team-okrs": { id: "team-okrs", label: "Team OKRs", type: "database" },
  "bug-tracker": { id: "bug-tracker", label: "Bug Tracker", type: "database" },
  "customer-feedback": { id: "customer-feedback", label: "Customer Feedback", type: "database" },
  "content-calendar": { id: "content-calendar", label: "Content Calendar", type: "database" },
  "feature-requests": { id: "feature-requests", label: "Feature Requests", type: "database" },
  "hiring-pipeline": { id: "hiring-pipeline", label: "Hiring Pipeline", type: "database" },
  "sprint-board": { id: "sprint-board", label: "Sprint Board", type: "database" },

  "task-ship-2-4": { id: "task-ship-2-4", label: "Ship Release 2.4", type: "task" },
  "task-review-pr-284": { id: "task-review-pr-284", label: "Review PR #284", type: "task" },
  "task-update-docs": { id: "task-update-docs", label: "Update API Docs", type: "task" },
  "task-prep-launch": { id: "task-prep-launch", label: "Prep Launch Email", type: "task" },
  "task-fix-auth-bug": { id: "task-fix-auth-bug", label: "Fix Auth Bug", type: "task" },
  "task-design-review": { id: "task-design-review", label: "Design Review Q1", type: "task" },
  "task-refactor-api": { id: "task-refactor-api", label: "Refactor API Layer", type: "task" },

  "note-standup-0315": { id: "note-standup-0315", label: "Standup 03/15", type: "note" },
  "note-sprint-retro": { id: "note-sprint-retro", label: "Sprint Retro", type: "note" },
  "note-brainstorm": { id: "note-brainstorm", label: "Brainstorm Session", type: "note" },
  "note-1-1-sam": { id: "note-1-1-sam", label: "1:1 with Sam", type: "note" },
  "note-design-critique": { id: "note-design-critique", label: "Design Critique", type: "note" },
  "note-qa-findings": { id: "note-qa-findings", label: "QA Findings", type: "note" },
  "note-planning-meeting": { id: "note-planning-meeting", label: "Planning Meeting", type: "note" },
}

const ALL_IDS = Object.keys(WORKSPACE)

// ──────────────────────────────────────────────────────────────────────────────
// Graph generator: deterministic subgraph per query
// ──────────────────────────────────────────────────────────────────────────────

function hashString(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash = hash & hash
  }
  return Math.abs(hash)
}

function selectNodes(message: string, count: number): string[] {
  const seed = hashString(message.toLowerCase().trim())
  const shuffled = [...ALL_IDS].sort((a, b) => {
    const ha = hashString(a + seed.toString())
    const hb = hashString(b + seed.toString())
    return ha - hb
  })
  return shuffled.slice(0, count)
}

function generateGraph(message: string, intent?: string): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodeCount = 5 + Math.floor(hashString(message + (intent || "")) % 5)
  const selectedIds = selectNodes(message, nodeCount)
  const nodes = selectedIds.map(id => WORKSPACE[id])

  const edges: GraphEdge[] = []
  const edgeCount = Math.max(nodeCount - 2, 2)

  for (let i = 0; i < edgeCount; i++) {
    const fromIdx = i % nodes.length
    const toIdx = (i + 1 + Math.floor(i / 2)) % nodes.length
    if (fromIdx !== toIdx) {
      edges.push({
        from: nodes[fromIdx].id,
        to: nodes[toIdx].id,
        relation: ["references", "links to", "depends on", "related to"][i % 4],
      })
    }
  }

  return { nodes, edges }
}

// ──────────────────────────────────────────────────────────────────────────────
// Answer generator: realistic AI responses
// ──────────────────────────────────────────────────────────────────────────────

function generateAnswer(message: string, intent: string | undefined, nodes: GraphNode[]): string {
  const nodeNames = nodes.slice(0, 3).map(n => `**${n.label}**`).join(", ")

  switch (intent) {
    case "search":
      return `I found ${nodes.length} relevant items in your workspace matching "${message}":\n\n${nodeNames}${
        nodes.length > 3 ? ", and others" : ""
      }.\n\nThe graph shows how these pages, databases, and notes are interconnected.`

    case "summarize":
      return `Here's a summary based on "${message}":\n\nYour workspace contains ${nodes.length} related items including ${nodeNames}. The primary focus is on cross-functional alignment and strategic planning. Key action items include updating documentation, tracking progress, and maintaining communication across teams.`

    case "connect":
      return `I've identified ${nodes.length} connections related to "${message}":\n\n${nodeNames} are all linked through shared objectives and dependencies. The graph visualizes how these concepts flow through your workspace, revealing hidden relationships between strategy, execution, and documentation.`

    case "brief":
      return `Today's brief for "${message}":\n\n**Active work**: ${nodes.filter(n => n.type === "task").length} tasks in progress.\n**Key resources**: ${nodeNames}.\n**Status**: On track. Recent updates in sprint planning and design reviews show steady momentum. Check the graph for dependencies.`

    default:
      return `Analyzed "${message}" across your workspace.\n\nFound ${nodes.length} relevant items: ${nodeNames}${
        nodes.length > 3 ? ", plus additional resources" : ""
      }. The knowledge graph shows their relationships and dependencies, helping you understand how these pieces fit together in your vault.`
  }
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

    const graph = generateGraph(message, intent)
    const answer = generateAnswer(message, intent, graph.nodes)

    const response: VaultmindResponse = {
      answer,
      graph,
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error("[v0] VaultMind API error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
