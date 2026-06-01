"use client"

import { Menu, Network, Trash2 } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { BrandMark } from "@/components/brand/brand-mark"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/vaultmind/confirm-dialog"
import { ChatInput } from "./chat-input"
import { ChatMessageBubble } from "./chat-message"
import type { ChatMessage, Intent, KnowledgeGraph } from "@/lib/vaultmind-types"
import { cn } from "@/lib/utils"

interface ChatPanelProps {
  title: string
  onTitleChange: (title: string) => void
  messages: ChatMessage[]
  loading: boolean
  loadingStatus: string
  inputValue: string
  onInputChange: (v: string) => void
  intent: Intent
  onIntentChange: (i: Intent) => void
  onSubmit: () => void
  onClear: () => void
  highlightedNodeId: string | null
  onCitationClick: (nodeId: string) => void
  onCitationOpen: (nodeId: string) => void
  registerCitationRef: (messageId: string, nodeId: string, el: HTMLElement | null) => void
  onOpenMobileSidebar: () => void
  onOpenMobileGraph: () => void
  workspaceGraph: KnowledgeGraph | null
}

export function ChatPanel(props: ChatPanelProps) {
  const {
    title,
    onTitleChange,
    messages,
    loading,
    loadingStatus,
    inputValue,
    onInputChange,
    intent,
    onIntentChange,
    onSubmit,
    onClear,
    highlightedNodeId,
    onCitationClick,
    onCitationOpen,
    registerCitationRef,
    onOpenMobileSidebar,
    onOpenMobileGraph,
    workspaceGraph,
  } = props

  const [suggestionSeed] = useState(() => Math.random())

  const suggestions = useMemo(
    () => buildIntentSuggestions(intent, workspaceGraph, suggestionSeed),
    [intent, workspaceGraph, suggestionSeed],
  )

  const scrollRef = useRef<HTMLDivElement>(null)
  const [titleEditing, setTitleEditing] = useState(false)
  const [draftTitle, setDraftTitle] = useState(title)
  const [clearDialogOpen, setClearDialogOpen] = useState(false)

  // Auto-scroll to bottom on new messages or loading state change
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" })
  }, [messages.length, loading])

  useEffect(() => {
    setDraftTitle(title)
  }, [title])

  const commitTitle = () => {
    const next = draftTitle.trim() || "Untitled chat"
    onTitleChange(next)
    setDraftTitle(next)
    setTitleEditing(false)
  }

  return (
    <section className="flex flex-col h-full flex-1 min-w-0 bg-background">
      {/* Top bar */}
      <header className="flex items-center justify-between gap-2 px-3 sm:px-5 h-14 border-b border-border shrink-0">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {/* Mobile sidebar trigger */}
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden h-8 w-8 shrink-0"
            aria-label="Open menu"
            onClick={onOpenMobileSidebar}
            data-tour="mobile-menu-button"
          >
            <Menu className="h-4 w-4" />
          </Button>

          {titleEditing ? (
            <input
              autoFocus
              value={draftTitle}
              onChange={e => setDraftTitle(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={e => {
                if (e.key === "Enter") commitTitle()
                if (e.key === "Escape") {
                  setDraftTitle(title)
                  setTitleEditing(false)
                }
              }}
              className="text-sm font-medium bg-transparent border-b border-ring focus:outline-none px-0 py-0.5 min-w-0 flex-1 max-w-md"
              aria-label="Chat title"
            />
          ) : (
            <button
              onClick={() => setTitleEditing(true)}
              className="text-sm font-medium tracking-tight hover:text-muted-foreground transition-colors truncate min-w-0"
              aria-label="Edit chat title"
            >
              {title}
            </button>
          )}
        </div>

          <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setClearDialogOpen(true)}
            disabled={messages.length === 0 && !loading}
            className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Clear</span>
          </Button>
          {/* Mobile graph trigger */}
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden h-8 w-8"
            aria-label="Open knowledge graph"
            onClick={onOpenMobileGraph}
            data-tour="mobile-graph-button"
          >
            <Network className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-3 sm:px-5 py-6 flex flex-col gap-6">
          {messages.length === 0 && !loading && (
            <EmptyChatState
              intent={intent}
              suggestions={suggestions}
              onSuggestionSelect={onInputChange}
              suggestionSeed={suggestionSeed}
              workspaceGraph={workspaceGraph}
            />
          )}

          {messages.map(msg => (
            <ChatMessageBubble
              key={msg.id}
              message={msg}
              highlightedNodeId={highlightedNodeId}
              onCitationClick={onCitationClick}
              onCitationOpen={onCitationOpen}
              registerCitationRef={registerCitationRef}
            />
          ))}

          {loading && <TypingIndicator status={loadingStatus} />}
        </div>
      </div>

      {/* Input */}
      <div data-tour="chat-input">
        <ChatInput
          value={inputValue}
          onChange={onInputChange}
          intent={intent}
          onIntentChange={onIntentChange}
          onSubmit={onSubmit}
          loading={loading}
        />
      </div>

      <ConfirmDialog
        open={clearDialogOpen}
        onOpenChange={setClearDialogOpen}
        title="Clear conversation?"
        description="This will remove all messages from the current chat. You cannot undo this action."
        confirmLabel="Clear"
        confirmVariant="destructive"
        onConfirm={() => {
          onClear()
          setClearDialogOpen(false)
        }}
      />
    </section>
  )
}

function EmptyChatState({
  intent,
  suggestions,
  onSuggestionSelect,
  suggestionSeed,
  workspaceGraph,
}: {
  intent: Intent
  suggestions: string[]
  onSuggestionSelect: (value: string) => void
  suggestionSeed: number
  workspaceGraph: KnowledgeGraph | null
}) {
  const intentText: Record<Intent, string> = {
    search: "Search across pages, databases, and notes.",
    summarize: "Get instant summaries of any topic in your vault.",
    connect: "Discover hidden relationships between ideas.",
    brief: "Get a daily brief of what matters now.",
  }

  const fallbackPrompts = useMemo(
    () => buildIntentSuggestions(intent, workspaceGraph, suggestionSeed),
    [intent, workspaceGraph, suggestionSeed],
  )
  const prompts = suggestions.length > 0 ? suggestions : fallbackPrompts

  return (
    <div className="flex flex-col items-center justify-center text-center py-10 sm:py-16">
      <BrandMark className="mb-4 h-12 w-12 rounded-lg" />
      <h3 className="text-base font-semibold tracking-tight">Ask anything about your workspace</h3>
      <p className="text-sm text-muted-foreground mt-1.5 max-w-md text-balance px-4">
        {intentText[intent]} Graphyne queries your Notion vault via MCP and visualizes connections live.
      </p>
      <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-md w-full px-4">
        {prompts.map(p => (
          <Button
            key={p}
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onSuggestionSelect(p)}
            className="h-auto min-h-8 w-full justify-start whitespace-normal break-words px-3 py-2 text-left text-xs leading-snug"
            title={p}
          >
            <span className="min-w-0">{p}</span>
          </Button>
        ))}
      </div>
    </div>
  )
}

const INTENT_FALLBACKS: Record<Intent, string[]> = {
  search: [
    "Search the Q1 roadmap",
    "Find mentions of launch blockers",
    "Search recent customer feedback",
  ],
  summarize: [
    "Summarize Q1 roadmap progress",
    "Summarize this week's priorities",
    "Key takeaways from recent updates",
  ],
  connect: [
    "Connect customer feedback to features",
    "Find shared topics across initiatives",
    "How are roadmap items related?",
  ],
  brief: [
    "Brief me on this week's priorities",
    "What matters most today?",
    "Daily brief for the release",
  ],
}

function buildIntentSuggestions(
  intent: Intent,
  workspaceGraph: KnowledgeGraph | null,
  seed: number,
): string[] {
  const nodes = workspaceGraph?.nodes ?? []
  const intentSeed = mixSeed(seed, intent)
  const labels = pickSuggestionLabels(nodes, 3, intentSeed, intent)
  const [first, second, third] = labels
  const fallback = shuffleWithSeed(INTENT_FALLBACKS[intent], intentSeed).slice(0, 3)
  const limit = (text: string) => limitSuggestion(text, 52)

  switch (intent) {
    case "search":
      return [
        limit(first ? `Search for ${first}` : fallback[0]),
        limit(second ? `Find mentions of ${second}` : fallback[1]),
        limit(third ? `Search for ${third} updates` : fallback[2]),
      ]
    case "summarize":
      return [
        limit(first ? `Summarize ${first}` : fallback[0]),
        limit(second ? `Summarize updates to ${second}` : fallback[1]),
        limit(third ? `Key takeaways for ${third}` : fallback[2]),
      ]
    case "connect":
      return [
        limit(first && second ? `Connect ${first} to ${second}` : fallback[0]),
        limit(first ? `How is ${first} related to other pages?` : fallback[1]),
        limit(third ? `Find shared topics with ${third}` : fallback[2]),
      ]
    case "brief":
      return [
        limit(first ? `Brief me on ${first}` : fallback[0]),
        limit(second ? `What matters now about ${second}?` : fallback[1]),
        limit(third ? `Daily brief for ${third}` : fallback[2]),
      ]
    default:
      return fallback.map(limit)
  }
}

function pickSuggestionLabels(
  nodes: KnowledgeGraph["nodes"],
  count: number,
  seed: number,
  intent: Intent,
): string[] {
  const rng = makeRng(seed)
  const seen = new Set<string>()
  const picks: string[] = []

  const byType = new Map<string, string[]>()
  for (const node of nodes) {
    const label = node.label?.trim()
    if (!label) continue
    const type = node.type ?? "page"
    const list = byType.get(type) ?? []
    list.push(label)
    byType.set(type, list)
  }

  const intentTypeOrder: Record<Intent, string[]> = {
    search: ["database", "page", "note", "task"],
    summarize: ["page", "note", "database", "task"],
    connect: ["page", "database", "task", "note"],
    brief: ["task", "page", "note", "database"],
  }
  const typeOrder = intentTypeOrder[intent]
  for (const type of typeOrder) {
    const list = shuffleWithRng(byType.get(type) ?? [], rng)
    for (const label of list) {
      if (picks.length >= count) break
      if (seen.has(label)) continue
      seen.add(label)
      picks.push(label)
      break
    }
    if (picks.length >= count) break
  }

  if (picks.length < count) {
    const labels = shuffleWithRng(
      nodes.map(node => node.label?.trim()).filter(Boolean) as string[],
      rng,
    )
    for (const label of labels) {
      if (picks.length >= count) break
      if (!label || seen.has(label)) continue
      seen.add(label)
      picks.push(label)
    }
  }

  return picks
}

function makeRng(seed: number) {
  let t = Math.floor(seed * 1_000_000_000) || 1
  return () => {
    t += 0x6d2b79f5
    let x = t
    x = Math.imul(x ^ (x >>> 15), x | 1)
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61)
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}

function mixSeed(seed: number, intent: Intent): number {
  const base = Math.floor(seed * 1_000_000_000) || 1
  let h = base
  for (let i = 0; i < intent.length; i++) {
    h = (h * 31 + intent.charCodeAt(i)) | 0
  }
  return Math.abs(h % 1_000_000) / 1_000_000
}

function limitSuggestion(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  const trimmed = text.slice(0, maxLen - 1)
  const lastSpace = trimmed.lastIndexOf(" ")
  if (lastSpace > 20) return trimmed.slice(0, lastSpace) + "…"
  return trimmed + "…"
}

function shuffleWithSeed<T>(items: T[], seed: number): T[] {
  const rng = makeRng(seed)
  return shuffleWithRng(items, rng)
}

function shuffleWithRng<T>(items: T[], rng: () => number): T[] {
  const arr = items.slice()
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

function TypingIndicator({ status }: { status: string }) {
  return (
    <div className="flex gap-3">
      <BrandMark className="mt-0.5 h-7 w-7 shrink-0" />
      <div className="flex flex-col gap-2 pt-1.5">
        <div className="flex items-center gap-1.5">
          <span className="vm-dot h-1.5 w-1.5 rounded-full bg-primary" />
          <span className="vm-dot h-1.5 w-1.5 rounded-full bg-primary" />
          <span className="vm-dot h-1.5 w-1.5 rounded-full bg-primary" />
        </div>
        <p className={cn("text-xs text-muted-foreground transition-opacity")}>{status}</p>
      </div>
    </div>
  )
}
