"use client"

import { ArrowUp, GitMerge, Layers, Search, Sunrise } from "lucide-react"
import { useEffect, useRef, type KeyboardEvent } from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { Intent } from "@/lib/vaultmind-types"

interface ChatInputProps {
  value: string
  onChange: (v: string) => void
  intent: Intent
  onIntentChange: (i: Intent) => void
  onSubmit: () => void
  loading: boolean
}

const INTENT_CONFIG: Record<
  Intent,
  { label: string; placeholder: string; icon: typeof Search }
> = {
  search: {
    label: "Search",
    placeholder: "Search your workspace…",
    icon: Search,
  },
  summarize: {
    label: "Summarize",
    placeholder: "What should I summarize?",
    icon: Layers,
  },
  connect: {
    label: "Connect",
    placeholder: "What ideas should I connect?",
    icon: GitMerge,
  },
  brief: {
    label: "Brief",
    placeholder: "What matters today?",
    icon: Sunrise,
  },
}

const INTENTS: Intent[] = ["search", "summarize", "connect", "brief"]

export function ChatInput({
  value,
  onChange,
  intent,
  onIntentChange,
  onSubmit,
  loading,
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-grow textarea
  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = "auto"
    const next = Math.min(ta.scrollHeight, 200)
    ta.style.height = `${next}px`
  }, [value])

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      if (value.trim() && !loading) onSubmit()
    }
  }

  const placeholder = INTENT_CONFIG[intent].placeholder
  const canSubmit = value.trim().length > 0 && !loading

  return (
    <div className="border-t border-border bg-background/95 backdrop-blur-sm p-4">
      <div className="max-w-3xl mx-auto rounded-lg border border-border bg-card focus-within:border-ring/60 transition-colors">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={1}
          aria-label="Chat message"
          className={cn(
            "w-full resize-none bg-transparent px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground",
            "focus:outline-none",
            "min-h-[48px] max-h-[200px]",
          )}
        />

        <div className="flex items-center justify-between px-2 pb-2">
          {/* Intent selector */}
          <div
            role="radiogroup"
            aria-label="Intent mode"
            className="flex items-center gap-0.5 p-0.5 rounded-md bg-muted/40 border border-border"
          >
            {INTENTS.map(i => {
              const cfg = INTENT_CONFIG[i]
              const Icon = cfg.icon
              const active = i === intent
              return (
                <button
                  key={i}
                  role="radio"
                  aria-checked={active}
                  aria-label={cfg.label}
                  title={cfg.label}
                  onClick={() => onIntentChange(i)}
                  className={cn(
                    "flex items-center gap-1.5 h-7 px-2 rounded-sm text-xs font-medium transition-colors",
                    active
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent/40",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden />
                  <span className="hidden sm:inline">{cfg.label}</span>
                </button>
              )
            })}
          </div>

          {/* Send */}
          <Button
            onClick={onSubmit}
            disabled={!canSubmit}
            size="icon"
            className="h-8 w-8 rounded-md"
            aria-label="Send message"
          >
            <ArrowUp className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <p className="text-center text-[10px] text-muted-foreground mt-2 tracking-wide">
        VaultMind queries your workspace via MCP. Press
        <kbd className="mx-1 px-1.5 py-0.5 rounded border border-border bg-muted/40 font-mono text-[10px]">
          Enter
        </kbd>
        to send,
        <kbd className="mx-1 px-1.5 py-0.5 rounded border border-border bg-muted/40 font-mono text-[10px]">
          Shift + Enter
        </kbd>
        for newline.
      </p>
    </div>
  )
}
