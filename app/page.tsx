"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Sidebar } from "@/components/vaultmind/sidebar"
import { ChatPanel } from "@/components/vaultmind/chat-panel"
import { KnowledgeGraphPanel } from "@/components/vaultmind/knowledge-graph"
import { CitationDrawer } from "@/components/vaultmind/citation-drawer"
import { IntegrationsDialog } from "@/components/vaultmind/integrations-dialog"
import { SettingsDialog } from "@/components/vaultmind/settings-dialog"
import { Sheet, SheetContent } from "@/components/ui/sheet"
import { NOTE_CONTENT } from "@/lib/workspace-data"
import type {
  ChatHistoryItem,
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

// Initial mock chats users can browse — they're real ChatHistoryItems with messages.
const SEED_HISTORY: ChatHistoryItem[] = [
  {
    id: "seed-roadmap",
    title: "Q1 roadmap review",
    preview: "Summarize the engineering priorities…",
    createdAt: Date.now() - 1000 * 60 * 60 * 24 * 2,
    messages: [],
  },
  {
    id: "seed-feedback",
    title: "Customer feedback themes",
    preview: "Connect feedback to feature requests…",
    createdAt: Date.now() - 1000 * 60 * 60 * 24,
    messages: [],
  },
  {
    id: "seed-retro",
    title: "Sprint retro notes",
    preview: "What blockers came up last sprint?",
    createdAt: Date.now() - 1000 * 60 * 60 * 6,
    messages: [],
  },
]

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`
}

export default function VaultMindPage() {
  // ── Conversations ──────────────────────────────────────────────────────────
  const [history, setHistory] = useState<ChatHistoryItem[]>(SEED_HISTORY)
  const [activeChatId, setActiveChatId] = useState<string | null>(null)

  // The current draft chat — exists before any message is sent.
  const [draftMessages, setDraftMessages] = useState<ChatMessage[]>([])
  const [draftTitle, setDraftTitle] = useState("New conversation")

  const activeChat = useMemo(
    () => (activeChatId ? history.find(h => h.id === activeChatId) ?? null : null),
    [activeChatId, history],
  )

  const messages: ChatMessage[] = activeChat ? activeChat.messages : draftMessages
  const chatTitle = activeChat ? activeChat.title : draftTitle

  // The graph displayed = graph from the most recent assistant message
  const graph: KnowledgeGraph | null = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant" && messages[i].graph) return messages[i].graph!
    }
    return null
  }, [messages])

  const focusedNodeIds: Set<string> = useMemo(() => {
    if (!graph) return new Set()
    return new Set(graph.nodes.map(n => n.id))
  }, [graph])

  // ── UI state ───────────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(false)
  const [loadingStatus, setLoadingStatus] = useState(LOADING_STATUSES[0])
  const [inputValue, setInputValue] = useState("")
  const [intent, setIntent] = useState<Intent>("search")

  const [highlightedNodeId, setHighlightedNodeId] = useState<string | null>(null)
  const [citationNodeId, setCitationNodeId] = useState<string | null>(null)

  const [integrationsOpen, setIntegrationsOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const [mobileGraphOpen, setMobileGraphOpen] = useState(false)

  // Settings (currently informational — kept here so they're easy to wire up later)
  const [showFullGraph, setShowFullGraph] = useState(true)
  const [graphMotion, setGraphMotion] = useState(true)

  // Track citation chip DOM nodes for scroll-into-view from graph clicks.
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

  // ── Chat persistence helpers ───────────────────────────────────────────────
  const renameCurrentChat = useCallback(
    (title: string) => {
      const next = title.trim() || "Untitled chat"
      if (activeChatId) {
        setHistory(prev =>
          prev.map(chat => (chat.id === activeChatId ? { ...chat, title: next } : chat)),
        )
      } else {
        setDraftTitle(next)
      }
    },
    [activeChatId],
  )

  const ensureActiveChatFromDraft = useCallback(
    (firstUserMessage: string) => {
      if (activeChatId) return activeChatId
      const id = makeId("chat")
      const seededTitle =
        firstUserMessage.length > 40 ? firstUserMessage.slice(0, 40) + "…" : firstUserMessage
      const newItem: ChatHistoryItem = {
        id,
        title: draftTitle === "New conversation" ? seededTitle : draftTitle,
        preview: firstUserMessage,
        createdAt: Date.now(),
        messages: [...draftMessages],
      }
      setHistory(prev => [newItem, ...prev])
      setActiveChatId(id)
      setDraftMessages([])
      setDraftTitle("New conversation")
      return id
    },
    [activeChatId, draftMessages, draftTitle],
  )

  // ── Submit ─────────────────────────────────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    const trimmed = inputValue.trim()
    if (!trimmed || loading) return

    const userMsg: ChatMessage = {
      id: makeId("u"),
      role: "user",
      content: trimmed,
      intent,
      createdAt: Date.now(),
    }

    // Promote draft → real chat on first message if needed
    const chatId = ensureActiveChatFromDraft(trimmed)

    // Append the user message to the (now-active) chat
    setHistory(prev =>
      prev.map(chat =>
        chat.id === chatId
          ? {
              ...chat,
              messages: [...chat.messages, userMsg],
              preview: trimmed,
            }
          : chat,
      ),
    )

    setInputValue("")
    setLoading(true)
    setHighlightedNodeId(null)

    try {
      const res = await fetch("/api/vaultmind", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed, intent }),
      })
      if (!res.ok) throw new Error(`API error: ${res.status}`)
      const data: VaultmindResponse = await res.json()

      const assistantMsg: ChatMessage = {
        id: makeId("a"),
        role: "assistant",
        content: data.answer,
        graph: data.graph,
        createdAt: Date.now(),
      }

      setHistory(prev =>
        prev.map(chat =>
          chat.id === chatId
            ? { ...chat, messages: [...chat.messages, assistantMsg] }
            : chat,
        ),
      )
    } catch (err) {
      console.error("[v0] Failed to call /api/vaultmind:", err)
      const errorMsg: ChatMessage = {
        id: makeId("a"),
        role: "assistant",
        content:
          "I couldn't reach your workspace just now. Please try again — the MCP connection may be reinitializing.",
        createdAt: Date.now(),
      }
      setHistory(prev =>
        prev.map(chat =>
          chat.id === chatId ? { ...chat, messages: [...chat.messages, errorMsg] } : chat,
        ),
      )
    } finally {
      setLoading(false)
    }
  }, [inputValue, intent, loading, ensureActiveChatFromDraft])

  // ── Clear / new chat ───────────────────────────────────────────────────────
  const handleClear = useCallback(() => {
    if (activeChatId) {
      setHistory(prev =>
        prev.map(chat =>
          chat.id === activeChatId
            ? { ...chat, messages: [], preview: "Cleared", title: chat.title }
            : chat,
        ),
      )
    } else {
      setDraftMessages([])
      setDraftTitle("New conversation")
    }
    setHighlightedNodeId(null)
    setCitationNodeId(null)
    citationRefs.current.clear()
  }, [activeChatId])

  const handleNewChat = useCallback(() => {
    setActiveChatId(null)
    setDraftMessages([])
    setDraftTitle("New conversation")
    setHighlightedNodeId(null)
    setCitationNodeId(null)
    setMobileSidebarOpen(false)
    citationRefs.current.clear()
  }, [])

  const handleSelectChat = useCallback((id: string) => {
    setActiveChatId(id)
    setHighlightedNodeId(null)
    setCitationNodeId(null)
    setMobileSidebarOpen(false)
  }, [])

  // ── Cross-panel interactions ───────────────────────────────────────────────
  const handleCitationClick = useCallback((nodeId: string) => {
    setHighlightedNodeId(prev => (prev === nodeId ? null : nodeId))
  }, [])

  const handleCitationOpen = useCallback((nodeId: string) => {
    setCitationNodeId(nodeId)
  }, [])

  const handleNodeClick = useCallback((nodeId: string) => {
    setHighlightedNodeId(nodeId)
    setCitationNodeId(nodeId)
    setMobileGraphOpen(false)

    // Find the most recent citation chip with this nodeId and scroll to it
    let targetEl: HTMLElement | null = null
    citationRefs.current.forEach(inner => {
      const el = inner.get(nodeId)
      if (el) targetEl = el
    })
    if (targetEl) {
      const el = targetEl as HTMLElement
      el.scrollIntoView({ behavior: "smooth", block: "center" })
      el.animate(
        [{ transform: "scale(1)" }, { transform: "scale(1.08)" }, { transform: "scale(1)" }],
        { duration: 450, easing: "ease-out" },
      )
    }
  }, [])

  // The note for the currently open citation, if any
  const activeNote = citationNodeId ? NOTE_CONTENT[citationNodeId] ?? null : null

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <main className="flex h-[100dvh] w-screen overflow-hidden bg-background text-foreground">
      {/* Desktop sidebar */}
      <div className="hidden md:flex h-full">
        <Sidebar
          history={history}
          activeChatId={activeChatId}
          onSelectChat={handleSelectChat}
          onNewChat={handleNewChat}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenIntegrations={() => setIntegrationsOpen(true)}
        />
      </div>

      {/* Mobile sidebar (sheet) */}
      <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
        <SheetContent
          side="left"
          className="w-[280px] p-0 bg-sidebar border-border md:hidden"
        >
          <Sidebar
            history={history}
            activeChatId={activeChatId}
            onSelectChat={handleSelectChat}
            onNewChat={handleNewChat}
            onOpenSettings={() => {
              setSettingsOpen(true)
              setMobileSidebarOpen(false)
            }}
            onOpenIntegrations={() => {
              setIntegrationsOpen(true)
              setMobileSidebarOpen(false)
            }}
          />
        </SheetContent>
      </Sheet>

      {/* Center chat */}
      <ChatPanel
        title={chatTitle}
        onTitleChange={renameCurrentChat}
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
        onCitationOpen={handleCitationOpen}
        registerCitationRef={registerCitationRef}
        onOpenMobileSidebar={() => setMobileSidebarOpen(true)}
        onOpenMobileGraph={() => setMobileGraphOpen(true)}
      />

      {/* Desktop graph */}
      <div className="hidden lg:flex h-full">
        <KnowledgeGraphPanel
          graph={graph}
          highlightedNodeId={highlightedNodeId}
          focusedNodeIds={focusedNodeIds}
          onNodeClick={handleNodeClick}
        />
      </div>

      {/* Mobile graph (sheet) */}
      <Sheet open={mobileGraphOpen} onOpenChange={setMobileGraphOpen}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-md p-0 bg-sidebar border-border lg:hidden"
        >
          <KnowledgeGraphPanel
            graph={graph}
            highlightedNodeId={highlightedNodeId}
            focusedNodeIds={focusedNodeIds}
            onNodeClick={handleNodeClick}
          />
        </SheetContent>
      </Sheet>

      {/* Citation drawer */}
      <CitationDrawer
        note={activeNote}
        open={citationNodeId !== null}
        onOpenChange={open => {
          if (!open) setCitationNodeId(null)
        }}
        onJumpToNode={nodeId => {
          setCitationNodeId(nodeId)
          setHighlightedNodeId(nodeId)
        }}
      />

      {/* Integrations dialog */}
      <IntegrationsDialog open={integrationsOpen} onOpenChange={setIntegrationsOpen} />

      {/* Settings dialog */}
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        showFullGraph={showFullGraph}
        onShowFullGraphChange={setShowFullGraph}
        graphMotion={graphMotion}
        onGraphMotionChange={setGraphMotion}
      />
    </main>
  )
}
