"use client"

import { ExternalLink, FileText, Loader2 } from "lucide-react"
import { useEffect, useState } from "react"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { getNodeColor } from "@/lib/graph-layout"
import type { KnowledgeGraph, NoteContent } from "@/lib/vaultmind-types"

interface CitationDrawerProps {
  /** Currently open node id, or null when closed */
  nodeId: string | null
  /** Workspace graph for resolving related node labels/types */
  workspaceGraph: KnowledgeGraph | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onJumpToNode: (nodeId: string) => void
}

function renderMarkdown(text: string): React.ReactNode {
  return text.split("\n").map((line, i) => {
    if (line.startsWith("## ")) {
      return (
        <h3 key={i} className="text-base font-semibold tracking-tight mt-4 mb-2 first:mt-0">
          {line.slice(3)}
        </h3>
      )
    }
    if (line.startsWith("### ")) {
      return (
        <h4 key={i} className="text-sm font-semibold mt-3 mb-1.5 text-foreground/90">
          {line.slice(4)}
        </h4>
      )
    }
    if (line.startsWith("- ") || line.startsWith("• ")) {
      return (
        <li key={i} className="text-sm leading-relaxed text-foreground/85 ml-4 list-disc">
          {parseInline(line.replace(/^[-•]\s*/, ""))}
        </li>
      )
    }
    if (line.match(/^\d+\.\s/)) {
      return (
        <li key={i} className="text-sm leading-relaxed text-foreground/85 ml-4 list-decimal">
          {parseInline(line.replace(/^\d+\.\s*/, ""))}
        </li>
      )
    }
    if (line.trim() === "") {
      return <div key={i} className="h-2" aria-hidden />
    }
    return (
      <p key={i} className="text-sm leading-relaxed text-foreground/85">
        {parseInline(line)}
      </p>
    )
  })
}

function parseInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = []
  const regex = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|_[^_]+_)/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  let key = 0

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index))
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
    } else if (token.startsWith("_")) {
      parts.push(
        <em key={key++} className="italic text-foreground/75">
          {token.slice(1, -1)}
        </em>,
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
  if (lastIndex < text.length) parts.push(text.slice(lastIndex))
  return parts
}

export function CitationDrawer({
  nodeId,
  workspaceGraph,
  open,
  onOpenChange,
  onJumpToNode,
}: CitationDrawerProps) {
  const [note, setNote] = useState<NoteContent | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !nodeId) {
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    setNote(null)
    fetch(`/api/vaultmind/page/${encodeURIComponent(nodeId)}`)
      .then(async res => {
        if (!res.ok) throw new Error(`Status ${res.status}`)
        return res.json()
      })
      .then((data: NoteContent) => {
        if (!cancelled) setNote(data)
      })
      .catch(err => {
        if (!cancelled) {
          console.error("[v0] Failed to fetch citation:", err)
          setError("Couldn't load this page. Make sure it's shared with the integration.")
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [nodeId, open])

  // Resolve related node labels from the workspace graph
  const nodeLookup = new Map<string, { label: string; type?: string }>()
  for (const n of workspaceGraph?.nodes ?? []) {
    nodeLookup.set(n.id, { label: n.label, type: n.type })
  }

  const colors = note ? getNodeColor(note.type) : getNodeColor("page")
  const related = (note?.relatedNodes ?? [])
    .map(id => ({ id, ...(nodeLookup.get(id) ?? { label: id }) }))
    .filter(r => r.label !== r.id || workspaceGraph === null)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-lg p-0 flex flex-col bg-background border-border"
      >
        <SheetHeader className="px-5 py-4 border-b border-border space-y-2">
          <div className="flex items-center gap-2">
            <span
              className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-medium border"
              style={{
                color: colors.text,
                borderColor: colors.stroke,
                backgroundColor: colors.fill,
              }}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: colors.stroke }}
                aria-hidden
              />
              {note?.type ?? "page"}
            </span>
            {nodeId && (
              <span className="text-[10px] text-muted-foreground font-mono truncate">
                notion://{nodeId.slice(0, 16)}
              </span>
            )}
          </div>
          <SheetTitle className="text-lg font-semibold tracking-tight text-left">
            {note?.title ?? (loading ? "Loading…" : "Citation")}
          </SheetTitle>
          <SheetDescription className="text-xs text-muted-foreground text-left">
            Source content fetched from your connected Notion workspace.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          {loading && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              Loading from Notion…
            </div>
          )}

          {error && (
            <div className="text-xs text-muted-foreground bg-card border border-border rounded p-3">
              {error}
            </div>
          )}

          {note && !loading && (
            <>
              <article className="prose prose-invert max-w-none">
                {renderMarkdown(note.content)}
              </article>

              {related.length > 0 && (
                <div className="mt-8 pt-5 border-t border-border">
                  <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-3">
                    Linked items
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {related.map(rel => {
                      const c = getNodeColor(rel.type)
                      return (
                        <button
                          key={rel.id}
                          onClick={() => {
                            onJumpToNode(rel.id)
                          }}
                          className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-[11px] font-medium hover:scale-[1.02] transition-transform"
                          style={{
                            borderColor: c.stroke,
                            backgroundColor: c.fill,
                            color: c.text,
                          }}
                        >
                          <span
                            className="h-1.5 w-1.5 rounded-full"
                            style={{ backgroundColor: c.stroke }}
                            aria-hidden
                          />
                          <span className="truncate max-w-[160px]">{rel.label}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-border flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <FileText className="h-3 w-3" aria-hidden />
            <span>Notion source</span>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs gap-1.5 text-muted-foreground hover:text-foreground"
            onClick={() => onOpenChange(false)}
          >
            <ExternalLink className="h-3 w-3" />
            Close
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
