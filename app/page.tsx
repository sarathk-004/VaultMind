"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Sidebar } from "@/components/vaultmind/sidebar"
import { ChatPanel } from "@/components/vaultmind/chat-panel"
import { KnowledgeGraphPanel } from "@/components/vaultmind/knowledge-graph"
import type {
  ChatMessage,
  Intent,
  KnowledgeGraph,
  VaultmindResponse,
} from "@/lib/vaultmind-types"

const LOADING_STATUSES = [
  "Querying workspace…",
  "Fetching from MCP…",
  "Analyzing connections…",
  "Building knowledge graph…",
]

export default function VaultMindPage() {
  // Chat state
  const [chatTitle, setChatTitle] = useState("New conversation")
  const [activeChatId, setActiveChatId] = useState("0")
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [graph, setGraph] = useState<KnowledgeGraph | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingStatus, setLoadingStatus] = useState(LOADING_STATUSES[0])

  // Input state
  const [inputValue, setInputValue] = useState("")
  const [intent, setIntent] = useState<Intent>("search")

  // Cross-panel selection
  const [highlightedNodeId, setHighlightedNodeId] = useState<string | null>(null)

  // Track citation chip DOM nodes for scroll-into-view from graph clicks.
  // Map: messageId -> Map<nodeId, HTMLElement>
  const citationRefs = useRef<Map<string, Map<string, HTMLElement>>>(new Map())

  const registerCitationRef = useCallback(
    (messageId: string, nodeId: string, el: HTMLElement | null) => {
      let inner = citationRefs.current.get(messageId)
      if (!inner) {
        inner = new Map()
        citationRefs.current.set(messageId, inner)
      }
      if (el) inner.set(nodeId, el)
      else inner.delete(nodeId)
    },
    [],
  )

  // Cycle loading status text while loading
  useEffect(() => {
    if (!loading) return
    let i = 0
    setLoadingStatus(LOADING_STATUSES[0])
    const interval = setInterval(() => {
      i = (i + 1) % LOADING_STATUSES.length
      setLoadingStatus(LOADING_STATUSES[i])
    }, 800)
    return () => clearInterval(interval)
  }, [loading])

  // Submit message → call API
  const handleSubmit = useCallback(async () => {
    const trimmed = inputValue.trim()
    if (!trimmed || loading) return

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      content: trimmed,
      intent,
      createdAt: Date.now(),
    }

    setMessages(prev => [...prev, userMsg])
    setInputValue("")
    setLoading(true)
    setHighlightedNodeId(null)

    // If this is the first message, seed the chat title from it.
    if (messages.length === 0) {
      const seeded = trimmed.length > 40 ? trimmed.slice(0, 40) + "…" : trimmed
      setChatTitle(seeded)
    }

    try {
      const res = await fetch("/api/vaultmind", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed, intent }),
      })

      if (!res.ok) {
        throw new Error(`API error: ${res.status}`)
      }

      const data: VaultmindResponse = await res.json()

      const assistantMsg: ChatMessage = {
        id: `a-${Date.now()}`,
        role: "assistant",
        content: data.answer,
        graph: data.graph,
        createdAt: Date.now(),
      }

      setMessages(prev => [...prev, assistantMsg])
      setGraph(data.graph)
    } catch (err) {
      console.error("[v0] Failed to call /api/vaultmind:", err)
      const errorMsg: ChatMessage = {
        id: `a-${Date.now()}`,
        role: "assistant",
        content:
          "I couldn't reach your workspace just now. Please try again — the MCP connection may be reinitializing.",
        createdAt: Date.now(),
      }
      setMessages(prev => [...prev, errorMsg])
    } finally {
      setLoading(false)
    }
  }, [inputValue, intent, loading, messages.length])

  const handleClear = useCallback(() => {
    setMessages([])
    setGraph(null)
    setHighlightedNodeId(null)
    setChatTitle("New conversation")
    citationRefs.current.clear()
  }, [])

  // Citation chip clicked → highlight matching node in graph
  const handleCitationClick = useCallback((nodeId: string) => {
    setHighlightedNodeId(prev => (prev === nodeId ? null : nodeId))
  }, [])

  // Graph node clicked → highlight + scroll chat to citation
  const handleNodeClick = useCallback((nodeId: string) => {
    setHighlightedNodeId(nodeId)

    // Find the most recent citation chip with this nodeId and scroll to it
    let targetEl: HTMLElement | null = null
    // Iterate in insertion order; the latest message will be last
    citationRefs.current.forEach(inner => {
      const el = inner.get(nodeId)
      if (el) targetEl = el
    })

    if (targetEl) {
      ;(targetEl as HTMLElement).scrollIntoView({ behavior: "smooth", block: "center" })
      // Brief pulse via temporary class
      ;(targetEl as HTMLElement).animate(
        [
          { transform: "scale(1)" },
          { transform: "scale(1.08)" },
          { transform: "scale(1)" },
        ],
        { duration: 450, easing: "ease-out" },
      )
    }
  }, [])

  return (
    <main className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      <Sidebar activeChatId={activeChatId} onSelectChat={setActiveChatId} />

      <ChatPanel
        title={chatTitle}
        onTitleChange={setChatTitle}
        messages={messages}
        loading={loading}
        loadingStatus={loadingStatus}
        inputValue={inputValue}
        onInputChange={setInputValue}
        intent={intent}
        onIntentChange={setIntent}
        onSubmit={handleSubmit}
        onClear={handleClear}
        highlightedNodeId={highlightedNodeId}
        onCitationClick={handleCitationClick}
        registerCitationRef={registerCitationRef}
      />

      <KnowledgeGraphPanel
        graph={graph}
        highlightedNodeId={highlightedNodeId}
        onNodeClick={handleNodeClick}
      />
    </main>
  )
}
