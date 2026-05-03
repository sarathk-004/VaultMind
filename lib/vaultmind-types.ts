export type Intent = "search" | "summarize" | "connect" | "brief"

export type NodeType = "page" | "database" | "task" | "note"

export interface GraphNode {
  id: string
  label: string
  type?: NodeType | string
}

export interface GraphEdge {
  from: string
  to: string
  relation?: string
}

export interface KnowledgeGraph {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export interface VaultmindResponse {
  answer: string
  graph: KnowledgeGraph
}

export interface VaultmindRequest {
  message: string
  intent?: Intent
}

export interface ChatMessage {
  id: string
  role: "user" | "assistant"
  content: string
  intent?: Intent
  graph?: KnowledgeGraph
  createdAt: number
}
