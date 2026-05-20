"use client"

import { Menu, Network, Trash2 } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { BrandMark } from "@/components/brand/brand-mark"
import { Button } from "@/components/ui/button"
import { ChatInput } from "./chat-input"
import { ChatMessageBubble } from "./chat-message"
import type { ChatMessage, Intent } from "@/lib/vaultmind-types"
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
  } = props

  const scrollRef = useRef<HTMLDivElement>(null)
  const [titleEditing, setTitleEditing] = useState(false)
  const [draftTitle, setDraftTitle] = useState(title)

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
            onClick={onClear}
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
          >
            <Network className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-3 sm:px-5 py-6 flex flex-col gap-6">
          {messages.length === 0 && !loading && <EmptyChatState intent={intent} />}

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
    </section>
  )
}

function EmptyChatState({ intent }: { intent: Intent }) {
  const intentText: Record<Intent, string> = {
    search: "Search across pages, databases, and notes.",
    summarize: "Get instant summaries of any topic in your vault.",
    connect: "Discover hidden relationships between ideas.",
    brief: "Get a daily brief of what matters now.",
  }

  return (
    <div className="flex flex-col items-center justify-center text-center py-10 sm:py-16">
      <BrandMark className="mb-4 h-12 w-12 rounded-lg" />
      <h3 className="text-base font-semibold tracking-tight">Ask anything about your workspace</h3>
      <p className="text-sm text-muted-foreground mt-1.5 max-w-md text-balance px-4">
        {intentText[intent]} Graphyne queries your Notion vault via MCP and visualizes connections live.
      </p>
      <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-md w-full px-4">
        {SAMPLE_PROMPTS.map(p => (
          <div
            key={p}
            className="text-xs text-muted-foreground border border-border rounded-md px-3 py-2 bg-card"
          >
            {p}
          </div>
        ))}
      </div>
    </div>
  )
}

const SAMPLE_PROMPTS = [
  "Summarize Q1 roadmap progress",
  "Connect customer feedback to features",
  "What's blocking the 2.4 release?",
  "Brief me on this week's priorities",
]

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
