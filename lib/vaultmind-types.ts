export type Intent = "search" | "summarize" | "connect" | "brief"

export type NodeType = "page" | "database" | "task" | "note"

export interface GraphNode {
  id: string
  label: string
  type?: NodeType | string
  /** Group/cluster id — nodes with the same cluster are visually grouped. */
  cluster?: string
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

export interface ChatHistoryItem {
  id: string
  title: string
  preview: string
  createdAt: number
  messages: ChatMessage[]
}

export interface NoteContent {
  id: string
  title: string
  content: string
  type: NodeType
  relatedNodes: string[]
  url?: string
}
