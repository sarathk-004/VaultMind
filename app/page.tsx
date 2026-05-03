"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Sidebar } from "@/components/vaultmind/sidebar"
import { ChatPanel } from "@/components/vaultmind/chat-panel"
import { KnowledgeGraphPanel } from "@/components/vaultmind/knowledge-graph"
import { CitationDrawer } from "@/components/vaultmind/citation-drawer"
import { SettingsDialog } from "@/components/vaultmind/settings-dialog"
import { ConnectDialog } from "@/components/vaultmind/connect-dialog"
import { Sheet, SheetContent } from "@/components/ui/sheet"
import type {
  ChatHistoryItem,
  ChatMessage,
  Intent,
  KnowledgeGraph,
  VaultmindResponse,
} from "@/lib/vaultmind-types"

const LOADING_STATUSES = [
  "Querying workspace via MCP…",
  "Fetching relevant pages from Notion…",
  "Sending context to model…",
  "Building knowledge graph…",
]

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

interface WorkspaceState {
  graph: KnowledgeGraph | null
  loading: boolean
  connected: boolean
}

export default function VaultMindPage() {
  // ── Workspace snapshot (fetched on mount via /api/vaultmind/workspace) ────
  const [workspace, setWorkspace] = useState<WorkspaceState>({
    graph: null,
    loading: true,
    connected: false,
  })

  const reloadWorkspace = useCallback(async () => {
    setWorkspace(prev => ({ ...prev, loading: true }))
    try {
      const res = await fetch("/api/vaultmind/workspace", { cache: "no-store" })
      if (!res.ok) throw new Error(`Status ${res.status}`)
      const data = await res.json()
      setWorkspace({
        graph: data.graph,
        loading: false,
        connected: Boolean(data.connected),
      })
    } catch (err) {
      console.error("[v0] Failed to load workspace:", err)
      setWorkspace({ graph: null, loading: false, connected: false })
    }
  }, [])

  useEffect(() => {
    void reloadWorkspace()
  }, [reloadWorkspace])

  // ── Conversations ────────────────────────────────────────────────────────
  const [history, setHistory] = useState<ChatHistoryItem[]>(SEED_HISTORY)
  const [activeChatId, setActiveChatId] = useState<string | null>(null)

  const [draftMessages, setDraftMessages] = useState<ChatMessage[]>([])
  const [draftTitle, setDraftTitle] = useState("New conversation")

  const activeChat = useMemo(
    () => (activeChatId ? history.find(h => h.id === activeChatId) ?? null : null),
    [activeChatId, history],
  )

  const messages: ChatMessage[] = activeChat ? activeChat.messages : draftMessages
  const chatTitle = activeChat ? activeChat.title : draftTitle

  // The focused graph = graph from the most recent assistant message
  const focusedGraph: KnowledgeGraph | null = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant" && messages[i].graph) return messages[i].graph!
    }
    return null
  }, [messages])

  // ── UI state ─────────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(false)
  const [loadingStatus, setLoadingStatus] = useState(LOADING_STATUSES[0])
  const [inputValue, setInputValue] = useState("")
  const [intent, setIntent] = useState<Intent>("search")

  const [highlightedNodeId, setHighlightedNodeId] = useState<string | null>(null)
  const [citationNodeId, setCitationNodeId] = useState<string | null>(null)

  const [settingsOpen, setSettingsOpen] = useState(false)
  const [connectOpen, setConnectOpen] = useState(false)
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const [mobileGraphOpen, setMobileGraphOpen] = useState(false)

  // Settings — these now actually drive the graph rendering
  const [showFullGraph, setShowFullGraph] = useState(true)
  const [graphMotion, setGraphMotion] = useState(true)

  // Track citation chip DOM nodes for scroll-into-view from graph clicks
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

  // Cycle loading status
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

  // ── Chat helpers ─────────────────────────────────────────────────────────
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

  // ── Submit ───────────────────────────────────────────────────────────────
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

    const chatId = ensureActiveChatFromDraft(trimmed)

    setHistory(prev =>
      prev.map(chat =>
        chat.id === chatId
          ? { ...chat, messages: [...chat.messages, userMsg], preview: trimmed }
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
          chat.id === chatId ? { ...chat, messages: [...chat.messages, assistantMsg] } : chat,
        ),
      )
    } catch (err) {
      console.error("[v0] Failed to call /api/vaultmind:", err)
      const errorMsg: ChatMessage = {
        id: makeId("a"),
        role: "assistant",
        content:
          "I couldn't reach your workspace just now. Make sure your `NOTION_API_KEY` is set and the integration has been shared with the pages you want to query.",
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

  // ── Clear / new chat / select chat ───────────────────────────────────────
  const handleClear = useCallback(() => {
    if (activeChatId) {
      setHistory(prev =>
        prev.map(chat =>
          chat.id === activeChatId
            ? { ...chat, messages: [], preview: "Cleared" }
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

  // ── Cross-panel interactions ─────────────────────────────────────────────
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

  // Suppress unused-var lint until we wire animation toggling through.
  void graphMotion

  // ── Render ───────────────────────────────────────────────────────────────
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
          onOpenConnect={() => setConnectOpen(true)}
          workspaceConnected={workspace.connected}
          workspaceLabel={workspace.connected ? "Notion (live)" : "Local sample"}
        />
      </div>

      {/* Mobile sidebar */}
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
            onOpenConnect={() => {
              setConnectOpen(true)
              setMobileSidebarOpen(false)
            }}
            workspaceConnected={workspace.connected}
            workspaceLabel={workspace.connected ? "Notion (live)" : "Local sample"}
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
          workspaceGraph={workspace.graph}
          focusedGraph={focusedGraph}
          highlightedNodeId={highlightedNodeId}
          showFullGraph={showFullGraph}
          onNodeClick={handleNodeClick}
          workspaceLoading={workspace.loading}
        />
      </div>

      {/* Mobile graph */}
      <Sheet open={mobileGraphOpen} onOpenChange={setMobileGraphOpen}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-md p-0 bg-sidebar border-border lg:hidden"
        >
          <KnowledgeGraphPanel
            workspaceGraph={workspace.graph}
            focusedGraph={focusedGraph}
            highlightedNodeId={highlightedNodeId}
            showFullGraph={showFullGraph}
            onNodeClick={handleNodeClick}
            workspaceLoading={workspace.loading}
          />
        </SheetContent>
      </Sheet>

      {/* Citation drawer */}
      <CitationDrawer
        nodeId={citationNodeId}
        workspaceGraph={workspace.graph}
        open={citationNodeId !== null}
        onOpenChange={open => {
          if (!open) setCitationNodeId(null)
        }}
        onJumpToNode={nodeId => {
          setCitationNodeId(nodeId)
          setHighlightedNodeId(nodeId)
        }}
      />

      {/* Settings dialog */}
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        showFullGraph={showFullGraph}
        onShowFullGraphChange={setShowFullGraph}
        graphMotion={graphMotion}
        onGraphMotionChange={setGraphMotion}
        workspaceLabel={workspace.connected ? "Notion (live)" : "Local sample"}
        workspaceConnected={workspace.connected}
      />

      {/* Connect dialog — bring-your-own Notion token */}
      <ConnectDialog
        open={connectOpen}
        onOpenChange={setConnectOpen}
        onConnectionChange={() => void reloadWorkspace()}
      />
    </main>
  )
}
