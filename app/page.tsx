"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Sidebar } from "@/components/vaultmind/sidebar"
import { ChatPanel } from "@/components/vaultmind/chat-panel"
import { KnowledgeGraphPanel } from "@/components/vaultmind/knowledge-graph"
import { CitationDrawer } from "@/components/vaultmind/citation-drawer"
import { SettingsDialog } from "@/components/vaultmind/settings-dialog"
import { ConnectDialog } from "@/components/vaultmind/connect-dialog"
import { Sheet, SheetContent } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { useIsMobile } from "@/hooks/use-mobile"
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

const SEED_HISTORY: ChatHistoryItem[] = []
const WALKTHROUGH_STORAGE_KEY = "graphyne.walkthrough.v2.seen"
const CHAT_STORAGE_KEY = "graphyne.chat.v1"
const WORKSPACE_STORAGE_KEY = "graphyne.workspace.v1"
const WORKSPACE_CACHE_TTL = 5 * 60_000
const REQUIRE_NOTION_LOGIN = true

type StoredChatState = {
  history: ChatHistoryItem[]
  activeChatId: string | null
  draftMessages: ChatMessage[]
  draftTitle: string
}

type StoredWorkspaceState = {
  graph: KnowledgeGraph | null
  connected: boolean
  fetchedAt: number
}

function stripGraph(messages: ChatMessage[]): ChatMessage[] {
  return messages.map(message => {
    const { graph, ...rest } = message
    return rest
  })
}

function loadChatState(): StoredChatState | null {
  if (typeof window === "undefined") return null
  const raw = window.localStorage.getItem(CHAT_STORAGE_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<StoredChatState>
    if (!parsed || typeof parsed !== "object") return null
    const history = Array.isArray(parsed.history) ? parsed.history : []
    const draftMessages = Array.isArray(parsed.draftMessages) ? parsed.draftMessages : []
    const activeChatId = typeof parsed.activeChatId === "string" ? parsed.activeChatId : null
    const draftTitle = typeof parsed.draftTitle === "string" ? parsed.draftTitle : "New conversation"
    return { history, activeChatId, draftMessages, draftTitle }
  } catch {
    return null
  }
}

function saveChatState(state: StoredChatState) {
  if (typeof window === "undefined") return
  window.localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(state))
}

function loadWorkspaceState(): StoredWorkspaceState | null {
  if (typeof window === "undefined") return null
  const raw = window.localStorage.getItem(WORKSPACE_STORAGE_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<StoredWorkspaceState>
    if (!parsed || typeof parsed !== "object") return null
    if (typeof parsed.fetchedAt !== "number") return null
    if (Date.now() - parsed.fetchedAt > WORKSPACE_CACHE_TTL) return null
    return {
      graph: parsed.graph ?? null,
      connected: Boolean(parsed.connected),
      fetchedAt: parsed.fetchedAt,
    }
  } catch {
    return null
  }
}

function saveWorkspaceState(state: StoredWorkspaceState) {
  if (typeof window === "undefined") return
  window.localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(state))
}

type WalkthroughSurface = "main" | "sidebar" | "graph"

type WalkthroughStep = {
  target: string
  title: string
  body: string
  placement: "left" | "right" | "top" | "bottom"
  surface?: WalkthroughSurface
}

const DESKTOP_WALKTHROUGH_STEPS: WalkthroughStep[] = [
  {
    target: '[data-tour="sidebar"]',
    title: "Your workspace lives here",
    body: "Start new conversations, revisit chat history, connect Notion, and open settings from the sidebar.",
    placement: "right",
  },
  {
    target: '[data-tour="chat-input"]',
    title: "Ask with intent",
    body: "Choose search, summarize, connect, or brief, then ask Graphyne to work across your workspace.",
    placement: "top",
  },
  {
    target: '[data-tour="graph-panel"]',
    title: "Watch answers become a map",
    body: "The graph shows the pages and links behind the answer. Hover a node to fade unrelated nodes and reveal the neighborhood.",
    placement: "left",
  },
  {
    target: '[data-tour="graph-locate"]',
    title: "Jump back into context",
    body: "This locate control moves the graph to the active node set. With no active answer, it finds the densest area.",
    placement: "left",
  },
  {
    target: '[data-tour="settings-button"]',
    title: "Tune the experience",
    body: "Settings lets you switch theme, control graph display, choose model providers, and manage workspace behavior.",
    placement: "top",
  },
]

const MOBILE_WALKTHROUGH_STEPS: WalkthroughStep[] = [
  {
    target: '[data-tour="mobile-menu-button"]',
    title: "Workspace controls move into the menu",
    body: "On phones, chat history, Notion connection, new chats, and settings live behind this menu button.",
    placement: "bottom",
    surface: "main",
  },
  {
    target: '[data-tour="chat-input"]',
    title: "Ask from the bottom bar",
    body: "Choose an intent and send your question from the same composer, sized for thumb reach.",
    placement: "top",
    surface: "main",
  },
  {
    target: '[data-tour="mobile-graph-button"]',
    title: "Open the graph as a sheet",
    body: "Tap here any time to open the knowledge graph without leaving the chat.",
    placement: "bottom",
    surface: "main",
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

export default function GraphynePage() {
  const isMobile = useIsMobile()
  const searchParams = useSearchParams()
  const oauthConnected = searchParams.get("notion") === "connected"
  // ── Workspace snapshot (fetched on mount via /api/vaultmind/workspace) ────
  const [workspace, setWorkspace] = useState<WorkspaceState>({
    graph: null,
    loading: true,
    connected: false,
  })

  const reloadWorkspace = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setWorkspace(prev => ({ ...prev, loading: true }))
    try {
      const res = await fetch("/api/vaultmind/workspace", {
        cache: "no-store",
        credentials: "include",
      })
      if (!res.ok) throw new Error(`Status ${res.status}`)
      const data = await res.json()
      const next = {
        graph: data.graph,
        loading: false,
        connected: Boolean(data.connected),
      }
      setWorkspace(next)
      saveWorkspaceState({
        graph: data.graph,
        connected: Boolean(data.connected),
        fetchedAt: Date.now(),
      })
    } catch (err) {
      console.error("[v0] Failed to load workspace:", err)
      setWorkspace({ graph: null, loading: false, connected: false })
    }
  }, [])

  useEffect(() => {
    const cached = loadWorkspaceState()
    const canUseCache = cached && (!REQUIRE_NOTION_LOGIN || cached.connected)
    if (canUseCache && cached) {
      setWorkspace({ graph: cached.graph, loading: false, connected: cached.connected })
    }
    void reloadWorkspace({ silent: Boolean(canUseCache) })
  }, [reloadWorkspace])

  useEffect(() => {
    if (!oauthConnected) return
    try {
      window.localStorage.removeItem(WORKSPACE_STORAGE_KEY)
    } catch {
      // Ignore cache removal failures.
    }
    void reloadWorkspace()
  }, [oauthConnected, reloadWorkspace])

  useEffect(() => {
    if (!REQUIRE_NOTION_LOGIN) return
    if (workspace.loading || workspace.connected) return
    window.location.replace("/login")
  }, [workspace.connected, workspace.loading])

  // ── Conversations ────────────────────────────────────────────────────────
  const [history, setHistory] = useState<ChatHistoryItem[]>(SEED_HISTORY)
  const [activeChatId, setActiveChatId] = useState<string | null>(null)

  const [hydrated, setHydrated] = useState(false)

  const [draftMessages, setDraftMessages] = useState<ChatMessage[]>([])
  const [draftTitle, setDraftTitle] = useState("New conversation")

  useEffect(() => {
    const stored = loadChatState()
    if (!stored) {
      setHydrated(true)
      return
    }
    setHistory(stored.history)
    setDraftMessages(stored.draftMessages)
    setDraftTitle(stored.draftTitle || "New conversation")
    const knownIds = new Set(stored.history.map(chat => chat.id))
    setActiveChatId(stored.activeChatId && knownIds.has(stored.activeChatId) ? stored.activeChatId : null)
    setHydrated(true)
  }, [])

  useEffect(() => {
    if (!hydrated) return
    saveChatState({
      history: history.map(chat => ({
        ...chat,
        messages: stripGraph(chat.messages),
      })),
      activeChatId,
      draftMessages: stripGraph(draftMessages),
      draftTitle,
    })
  }, [hydrated, history, activeChatId, draftMessages, draftTitle])

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
  const [walkthroughOpen, setWalkthroughOpen] = useState(false)

  // Settings — these now actually drive the graph rendering
  const [showFullGraph, setShowFullGraph] = useState(true)
  const walkthroughSteps = isMobile ? MOBILE_WALKTHROUGH_STEPS : DESKTOP_WALKTHROUGH_STEPS

  useEffect(() => {
    try {
      if (window.localStorage.getItem(WALKTHROUGH_STORAGE_KEY) !== "true") {
        setWalkthroughOpen(true)
      }
    } catch {
      setWalkthroughOpen(true)
    }
  }, [])

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
        credentials: "include",
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
          "I couldn't reach your workspace just now. Reconnect Notion and make sure Graphyne has access to the pages you want to query.",
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

  const handleDeleteChat = useCallback((id: string) => {
    setHistory(prev => prev.filter(chat => chat.id !== id))
    if (activeChatId === id) {
      setActiveChatId(null)
      setDraftMessages([])
      setDraftTitle("New conversation")
      setHighlightedNodeId(null)
      setCitationNodeId(null)
      citationRefs.current.clear()
    }
  }, [activeChatId])

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

  const closeWalkthrough = useCallback(() => {
    try {
      window.localStorage.setItem(WALKTHROUGH_STORAGE_KEY, "true")
    } catch {
      // Ignore storage failures; closing the dialog should still work.
    }
    setWalkthroughOpen(false)
  }, [])

  const handleWalkthroughSurfaceChange = useCallback(
    (surface: WalkthroughSurface) => {
      if (!isMobile) return

      setMobileSidebarOpen(false)
      setMobileGraphOpen(false)
    },
    [isMobile],
  )

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <main className="flex h-[100dvh] w-screen overflow-hidden bg-background text-foreground">
      {/* Desktop sidebar */}
      <div className="hidden md:flex h-full" data-tour="sidebar">
        <Sidebar
          history={history}
          activeChatId={activeChatId}
          onSelectChat={handleSelectChat}
          onDeleteChat={handleDeleteChat}
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
          data-tour="mobile-sidebar"
        >
          <Sidebar
            history={history}
            activeChatId={activeChatId}
            onSelectChat={handleSelectChat}
            onDeleteChat={handleDeleteChat}
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
      <div className="flex flex-1 min-w-0" data-tour="chat-panel">
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
          workspaceGraph={workspace.graph}
        />
      </div>

      {/* Desktop graph */}
      <div className="hidden lg:flex h-full" data-tour="graph-panel">
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
          data-tour="mobile-graph-panel"
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
          if (!open) {
            setCitationNodeId(null)
            setHighlightedNodeId(null)
          }
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
        workspaceLabel={workspace.connected ? "Notion (live)" : "Local sample"}
        workspaceConnected={workspace.connected}
        onLlmSettingsChange={() => void reloadWorkspace()}
      />

      {/* Connect dialog - Notion OAuth */}
      <ConnectDialog
        open={connectOpen}
        onOpenChange={setConnectOpen}
        onConnectionChange={() => void reloadWorkspace()}
      />

      <WalkthroughTour
        open={walkthroughOpen}
        steps={walkthroughSteps}
        onOpenChange={open => {
          if (!open) closeWalkthrough()
          else setWalkthroughOpen(true)
        }}
        onDone={closeWalkthrough}
        onSurfaceChange={handleWalkthroughSurfaceChange}
      />
    </main>
  )
}

function WalkthroughTour({
  open,
  steps,
  onOpenChange,
  onDone,
  onSurfaceChange,
}: {
  open: boolean
  steps: WalkthroughStep[]
  onOpenChange: (open: boolean) => void
  onDone: () => void
  onSurfaceChange: (surface: WalkthroughSurface) => void
}) {
  const [stepIndex, setStepIndex] = useState(0)
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null)

  const step = steps[stepIndex] ?? steps[0]
  const isLast = stepIndex === steps.length - 1

  useEffect(() => {
    setStepIndex(0)
  }, [steps])

  useEffect(() => {
    if (!open || !step) return
    onSurfaceChange(step.surface ?? "main")
  }, [onSurfaceChange, open, step])

  useEffect(() => {
    if (!open || !step) return

    const updateTarget = () => {
      const target = document.querySelector(step.target)
      if (!target) {
        setTargetRect(null)
        return
      }
      const rect = target.getBoundingClientRect()
      setTargetRect(rect)
      target.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" })
    }

    const raf = window.requestAnimationFrame(updateTarget)
    window.addEventListener("resize", updateTarget)
    window.addEventListener("scroll", updateTarget, true)
    return () => {
      window.cancelAnimationFrame(raf)
      window.removeEventListener("resize", updateTarget)
      window.removeEventListener("scroll", updateTarget, true)
    }
  }, [open, step.target])

  if (!open || !step) return null

  const viewportWidth = typeof window === "undefined" ? 1024 : window.innerWidth
  const viewportHeight = typeof window === "undefined" ? 768 : window.innerHeight
  const cardWidth = Math.min(340, viewportWidth - 32)
  const fallbackRect = {
    top: viewportHeight / 2 - 40,
    left: viewportWidth / 2 - 80,
    width: 160,
    height: 80,
    right: viewportWidth / 2 + 80,
    bottom: viewportHeight / 2 + 40,
  } as DOMRect
  const safeRect = targetRect ?? fallbackRect
  const padding = 10
  const spotlight = {
    top: Math.max(8, safeRect.top - padding),
    left: Math.max(8, safeRect.left - padding),
    width: Math.min(viewportWidth - 16, safeRect.width + padding * 2),
    height: Math.min(viewportHeight - 16, safeRect.height + padding * 2),
  }
  const spotlightRight = Math.min(viewportWidth, spotlight.left + spotlight.width)
  const spotlightBottom = Math.min(viewportHeight, spotlight.top + spotlight.height)

  const placeLeft = step.placement === "left"
  const placeTop = step.placement === "top"
  const placeBottom = step.placement === "bottom"
  const cardLeft = placeLeft
    ? Math.max(16, safeRect.left - cardWidth - 18)
    : Math.min(viewportWidth - cardWidth - 16, Math.max(16, safeRect.right + 18))
  const topPlacementLeft = Math.min(
    viewportWidth - cardWidth - 16,
    Math.max(16, safeRect.left + safeRect.width / 2 - cardWidth / 2),
  )
  const cardTop = placeTop
    ? Math.max(16, safeRect.top - 210)
    : placeBottom
    ? Math.min(viewportHeight - 180, Math.max(16, safeRect.bottom + 18))
    : Math.min(viewportHeight - 260, Math.max(16, safeRect.top + safeRect.height / 2 - 120))

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-labelledby="walkthrough-title">
      <div
        className="absolute left-0 right-0 top-0 bg-background/70 backdrop-blur-[1px]"
        style={{ height: spotlight.top }}
        aria-hidden
      />
      <div
        className="absolute left-0 bg-background/70 backdrop-blur-[1px]"
        style={{
          top: spotlight.top,
          width: spotlight.left,
          height: spotlight.height,
        }}
        aria-hidden
      />
      <div
        className="absolute right-0 bg-background/70 backdrop-blur-[1px]"
        style={{
          top: spotlight.top,
          left: spotlightRight,
          height: spotlight.height,
        }}
        aria-hidden
      />
      <div
        className="absolute bottom-0 left-0 right-0 bg-background/70 backdrop-blur-[1px]"
        style={{ top: spotlightBottom }}
        aria-hidden
      />
      <div
        className="pointer-events-none absolute rounded-lg border-2 border-primary ring-4 ring-primary/15 transition-all duration-300"
        style={{
          top: spotlight.top,
          left: spotlight.left,
          width: spotlight.width,
          height: spotlight.height,
        }}
        aria-hidden
      />

      <div
        className="absolute rounded-md border border-border bg-popover p-4 text-popover-foreground shadow-xl transition-all duration-300"
        style={{
          width: cardWidth,
          left: placeTop ? topPlacementLeft : cardLeft,
          top: cardTop,
        }}
      >
        <div
          className={
            "absolute h-3 w-3 rotate-45 border border-border bg-popover " +
            (placeTop
              ? "left-1/2 -bottom-1.5 -translate-x-1/2 border-l-0 border-t-0"
              : placeBottom
                ? "left-1/2 -top-1.5 -translate-x-1/2 border-b-0 border-r-0"
              : placeLeft
                ? "-right-1.5 top-1/2 -translate-y-1/2 border-b-0 border-l-0"
                : "-left-1.5 top-1/2 -translate-y-1/2 border-r-0 border-t-0")
          }
          aria-hidden
        />
        <div className="relative">
          <div className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Step {stepIndex + 1} of {steps.length}
          </div>
          <h2 id="walkthrough-title" className="text-base font-semibold tracking-tight">
            {step.title}
          </h2>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{step.body}</p>

          <div className="mt-4 flex items-center justify-between gap-2">
            <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={() => onOpenChange(false)}>
              Skip
            </Button>
            <div className="flex items-center gap-1">
              {steps.map((item, index) => (
                <span
                  key={item.target}
                  className={
                    "h-1.5 rounded-full transition-all " +
                    (index === stepIndex ? "w-5 bg-primary" : "w-1.5 bg-muted-foreground/35")
                  }
                  aria-hidden
                />
              ))}
            </div>
            <Button
              size="sm"
              className="h-8 px-3 text-xs"
              onClick={() => {
                if (isLast) onDone()
                else setStepIndex(prev => prev + 1)
              }}
            >
              {isLast ? "Start" : "Next"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
