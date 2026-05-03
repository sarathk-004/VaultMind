"use client"

import { BrainCircuit } from "lucide-react"
import { useMemo } from "react"
import { cn } from "@/lib/utils"
import { getNodeColor } from "@/lib/graph-layout"
import type { ChatMessage } from "@/lib/vaultmind-types"

interface ChatMessageProps {
  message: ChatMessage
  highlightedNodeId: string | null
  onCitationClick: (nodeId: string) => void
  onCitationOpen: (nodeId: string) => void
  registerCitationRef: (messageId: string, nodeId: string, el: HTMLElement | null) => void
}

/**
 * Minimal markdown renderer — supports **bold**, *italic*, `code`, and newlines.
 * Avoids pulling a markdown library to keep the bundle minimal.
 */
function renderMarkdown(text: string): React.ReactNode {
  const lines = text.split("\n")
  return lines.map((line, i) => (
    <span key={i}>
      {parseInline(line)}
      {i < lines.length - 1 && <br />}
    </span>
  ))
}

function parseInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = []
  // Match **bold**, *italic*, or `code`
  const regex = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  let key = 0

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }
    const token = match[0]
    if (token.startsWith("**")) {
      parts.push(
        <strong key={key++} className="font-semibold text-foreground">
          {token.slice(2, -2)}
        </strong>,
      )
    } else if (token.startsWith("`")) {
      parts.push(
        <code
          key={key++}
          className="px-1 py-0.5 rounded bg-muted/60 border border-border font-mono text-[12px]"
        >
          {token.slice(1, -1)}
        </code>,
      )
    } else {
      parts.push(
        <em key={key++} className="italic">
          {token.slice(1, -1)}
        </em>,
      )
    }
    lastIndex = match.index + token.length
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }
  return parts
}

export function ChatMessageBubble({
  message,
  highlightedNodeId,
  onCitationClick,
  onCitationOpen,
  registerCitationRef,
}: ChatMessageProps) {
  const isUser = message.role === "user"
  const citations = useMemo(() => message.graph?.nodes || [], [message.graph])

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-primary text-primary-foreground px-4 py-2.5 text-sm leading-relaxed">
          {message.content}
        </div>
      </div>
    )
  }

  return (
    <div className="flex gap-3">
      <div className="h-7 w-7 shrink-0 rounded-md bg-primary/10 border border-primary/20 flex items-center justify-center mt-0.5">
        <BrainCircuit className="h-3.5 w-3.5 text-primary" aria-hidden />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium text-muted-foreground mb-1.5">VaultMind</div>
        <div className="text-sm leading-relaxed text-foreground/95 whitespace-pre-wrap">
          {renderMarkdown(message.content)}
        </div>

        {citations.length > 0 && (
          <div className="mt-3 flex flex-col gap-2">
            <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Citations · {citations.length}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {citations.map(node => {
                const colors = getNodeColor(node.type)
                const active = node.id === highlightedNodeId
                return (
                  <button
                    key={node.id}
                    ref={el => registerCitationRef(message.id, node.id, el)}
                    onClick={() => {
                      onCitationClick(node.id)
                      onCitationOpen(node.id)
                    }}
                    className={cn(
                      "inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-[11px] font-medium transition-all",
                      "hover:scale-[1.02] cursor-pointer",
                      active ? "ring-1 ring-offset-1 ring-offset-background" : "",
                    )}
                    style={{
                      borderColor: colors.stroke,
                      backgroundColor: colors.fill,
                      color: colors.text,
                      ...(active ? { boxShadow: `0 0 0 1px ${colors.stroke}` } : {}),
                    }}
                    aria-label={`Open citation: ${node.label}`}
                  >
                    <span
                      className="h-1.5 w-1.5 rounded-full shrink-0"
                      style={{ backgroundColor: colors.stroke }}
                      aria-hidden
                    />
                    <span className="truncate max-w-[180px]">{node.label}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
