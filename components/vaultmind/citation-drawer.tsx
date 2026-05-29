"use client"

import { ExternalLink, FileText, Loader2 } from "lucide-react"
import { useEffect, useState } from "react"
import {
  Sheet,
  SheetContent,
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

/**
 * Block-aware markdown renderer. Groups consecutive lines into proper
 * structural HTML — tables become real <table>s, list items group into <ul>/<ol>,
 * code blocks render as <pre>, etc. Mirrors how Notion content is rendered
 * natively, instead of flattening every line to a paragraph.
 */
function renderMarkdown(text: string): React.ReactNode {
  const lines = text.split("\n")
  const blocks: React.ReactNode[] = []
  let i = 0
  let key = 0

  const isTableSeparator = (l: string) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(l)
  const isTableRow = (l: string) => /^\s*\|.*\|\s*$/.test(l)
  const splitRow = (l: string) =>
    l
      .trim()
      .replace(/^\||\|$/g, "")
      .split("|")
      .map(c => c.trim())

  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()

    // Blank line separator
    if (trimmed === "") {
      i++
      continue
    }

    // Horizontal rule
    if (trimmed === "---") {
      blocks.push(<hr key={key++} className="my-4 border-border/60" />)
      i++
      continue
    }

    // Headings
    if (trimmed.startsWith("#### ")) {
      blocks.push(
        <h5 key={key++} className="text-[13px] font-semibold mt-3 mb-1.5 text-foreground/90 tracking-tight">
          {parseInline(trimmed.slice(5))}
        </h5>,
      )
      i++
      continue
    }
    if (trimmed.startsWith("### ")) {
      blocks.push(
        <h4 key={key++} className="text-sm font-semibold mt-4 mb-2 text-foreground/90 tracking-tight">
          {parseInline(trimmed.slice(4))}
        </h4>,
      )
      i++
      continue
    }
    if (trimmed.startsWith("## ")) {
      blocks.push(
        <h3 key={key++} className="text-base font-semibold tracking-tight mt-5 mb-2 first:mt-0">
          {parseInline(trimmed.slice(3))}
        </h3>,
      )
      i++
      continue
    }

    // Code block
    if (trimmed.startsWith("```")) {
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i])
        i++
      }
      i++ // consume closing fence
      blocks.push(
        <pre
          key={key++}
          className="my-3 px-3 py-2.5 rounded-md bg-muted/60 border border-border overflow-x-auto text-[12px] font-mono leading-relaxed"
        >
          <code>{codeLines.join("\n")}</code>
        </pre>,
      )
      continue
    }

    // Table — at least header row + separator, then any number of body rows
    if (isTableRow(trimmed) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const header = splitRow(trimmed)
      i += 2 // consume header + separator
      const rows: string[][] = []
      while (i < lines.length && isTableRow(lines[i].trim())) {
        rows.push(splitRow(lines[i].trim()))
        i++
      }
      blocks.push(
        <div key={key++} className="my-3 overflow-x-auto rounded-md border border-border">
          <table className="w-full text-[12px] border-collapse">
            <thead className="bg-muted/40">
              <tr>
                {header.map((h, hi) => (
                  <th
                    key={hi}
                    className="text-left font-medium text-foreground/90 px-3 py-2 border-b border-border whitespace-nowrap"
                  >
                    {parseInline(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr
                  key={ri}
                  className={ri % 2 === 0 ? "bg-transparent" : "bg-muted/20"}
                >
                  {row.map((cell, ci) => (
                    <td
                      key={ci}
                      className="px-3 py-2 text-foreground/85 align-top border-t border-border/50"
                    >
                      {parseInline(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      )
      continue
    }

    // Blockquote (handles consecutive `> ` lines as one block)
    if (trimmed.startsWith("> ")) {
      const quoteLines: string[] = []
      while (i < lines.length && lines[i].trim().startsWith("> ")) {
        quoteLines.push(lines[i].trim().slice(2))
        i++
      }
      blocks.push(
        <blockquote
          key={key++}
          className="my-3 border-l-2 border-primary/40 pl-3 text-sm leading-relaxed text-foreground/75 italic"
        >
          {quoteLines.map((q, qi) => (
            <span key={qi}>
              {parseInline(q)}
              {qi < quoteLines.length - 1 && <br />}
            </span>
          ))}
        </blockquote>,
      )
      continue
    }

    // Unordered list / todo
    if (/^[-•]\s/.test(trimmed) || /^- \[[ x]\]\s/.test(trimmed)) {
      const items: { content: string; checked?: boolean }[] = []
      while (i < lines.length) {
        const t = lines[i].trim()
        const todoMatch = t.match(/^- \[([ x])\]\s+(.*)$/)
        if (todoMatch) {
          items.push({ checked: todoMatch[1] === "x", content: todoMatch[2] })
          i++
        } else if (/^[-•]\s/.test(t)) {
          items.push({ content: t.replace(/^[-•]\s+/, "") })
          i++
        } else {
          break
        }
      }
      blocks.push(
        <ul key={key++} className="my-2 space-y-1 pl-1">
          {items.map((it, ii) => (
            <li
              key={ii}
              className="flex gap-2 text-sm leading-relaxed text-foreground/85"
            >
              {typeof it.checked === "boolean" ? (
                <span
                  className={`mt-1 inline-block h-3 w-3 shrink-0 rounded-sm border ${
                    it.checked
                      ? "bg-primary border-primary"
                      : "border-muted-foreground/40 bg-transparent"
                  }`}
                  aria-hidden
                />
              ) : (
                <span
                  className="mt-2 inline-block h-1 w-1 shrink-0 rounded-full bg-muted-foreground/60"
                  aria-hidden
                />
              )}
              <span className={it.checked ? "line-through text-muted-foreground" : ""}>
                {parseInline(it.content)}
              </span>
            </li>
          ))}
        </ul>,
      )
      continue
    }

    // Ordered list
    if (/^\d+\.\s/.test(trimmed)) {
      const items: string[] = []
      while (i < lines.length && /^\d+\.\s/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ""))
        i++
      }
      blocks.push(
        <ol key={key++} className="my-2 space-y-1 pl-5 list-decimal">
          {items.map((it, ii) => (
            <li key={ii} className="text-sm leading-relaxed text-foreground/85">
              {parseInline(it)}
            </li>
          ))}
        </ol>,
      )
      continue
    }

    // Default: paragraph (greedily consume non-empty, non-block lines)
    const paraLines: string[] = [trimmed]
    i++
    while (i < lines.length) {
      const t = lines[i].trim()
      if (t === "") break
      if (/^(#{2,4}\s|>\s|[-•]\s|\d+\.\s|```|---)/.test(t)) break
      if (isTableRow(t)) break
      paraLines.push(t)
      i++
    }
    blocks.push(
      <p key={key++} className="text-sm leading-relaxed text-foreground/85 my-2">
        {paraLines.map((pl, pi) => (
          <span key={pi}>
            {parseInline(pl)}
            {pi < paraLines.length - 1 && " "}
          </span>
        ))}
      </p>,
    )
  }

  return blocks
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
  const cleanNoteId = note?.id.replace(/-/g, "") ?? ""
  const notionUrl = note?.url ?? (/^[0-9a-f]{32}$/i.test(cleanNoteId) ? `https://www.notion.so/${cleanNoteId}` : null)

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
          </div>
          <SheetTitle className="text-lg font-semibold tracking-tight text-left">
            {note?.title ?? (loading ? "Loading…" : "Citation")}
          </SheetTitle>
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
            disabled={!notionUrl}
            onClick={() => {
              if (notionUrl) window.open(notionUrl, "_blank", "noopener,noreferrer")
            }}
          >
            <ExternalLink className="h-3 w-3" />
            Open in Notion
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
