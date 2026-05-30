"use client"

import { useMemo } from "react"
import { BrandMark } from "@/components/brand/brand-mark"
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
 * Block-aware markdown renderer for chat answers. Renders tables, lists,
 * code blocks, headings, and blockquotes as proper structured HTML so the
 * AI response looks clean and readable.
 */
function renderMarkdown(text: string): React.ReactNode {
  const lines = text.split("\n")
  const blocks: React.ReactNode[] = []
  let i = 0
  let key = 0

  const isTableSeparator = (l: string) =>
    /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(l)
  const isTableRow = (l: string) => /^\s*\|.*\|\s*$/.test(l)
  const splitRow = (l: string) =>
    l
      .trim()
      .replace(/^\||\|$/g, "")
      .split("|")
      .map(c => c.trim())
  const isImageLine = (l: string) => /^!\[[^\]]*\]\([^\)]+\)\s*$/.test(l)

  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()

    // Blank line
    if (trimmed === "") {
      i++
      continue
    }

    // Horizontal rule
    if (trimmed === "---") {
      blocks.push(<hr key={key++} className="my-3 border-border/60" />)
      i++
      continue
    }

    // Image block
    if (isImageLine(trimmed)) {
      const match = trimmed.match(/^!\[([^\]]*)\]\(([^\)]+)\)\s*$/)
      if (match) {
        const [, alt, src] = match
        blocks.push(
          <figure key={key++} className="my-3">
            <img
              src={src}
              alt={alt || "Notion image"}
              className="w-full rounded-md border border-border"
            />
            {alt && (
              <figcaption className="mt-2 text-[11px] text-muted-foreground">
                {alt}
              </figcaption>
            )}
          </figure>,
        )
      }
      i++
      continue
    }

    // Headings
    if (trimmed.startsWith("#### ")) {
      blocks.push(
        <h5
          key={key++}
          className="text-[13px] font-semibold mt-3 mb-1 text-foreground/90"
        >
          {parseInline(trimmed.slice(5))}
        </h5>,
      )
      i++
      continue
    }
    if (trimmed.startsWith("### ")) {
      blocks.push(
        <h4
          key={key++}
          className="text-sm font-semibold mt-3 mb-1 text-foreground/90"
        >
          {parseInline(trimmed.slice(4))}
        </h4>,
      )
      i++
      continue
    }
    if (trimmed.startsWith("## ")) {
      blocks.push(
        <h3
          key={key++}
          className="text-[15px] font-semibold mt-4 mb-1.5 first:mt-0"
        >
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
      i++
      blocks.push(
        <pre
          key={key++}
          className="my-2 px-3 py-2 rounded-md bg-muted/50 border border-border overflow-x-auto text-[12px] font-mono leading-relaxed"
        >
          <code>{codeLines.join("\n")}</code>
        </pre>,
      )
      continue
    }

    // Table (with header + separator)
    if (isTableRow(trimmed) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const header = splitRow(trimmed)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && isTableRow(lines[i].trim())) {
        rows.push(splitRow(lines[i].trim()))
        i++
      }
      blocks.push(
        <div
          key={key++}
          className="my-2 overflow-x-auto rounded-md border border-border"
        >
          <table className="w-full text-[12px] border-collapse">
            <thead className="bg-muted/40">
              <tr>
                {header.map((h, hi) => (
                  <th
                    key={hi}
                    className="text-left font-medium text-foreground/90 px-2.5 py-1.5 border-b border-border whitespace-nowrap"
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
                      className="px-2.5 py-1.5 text-foreground/85 align-top border-t border-border/50"
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

    // Table (no header separator)
    if (isTableRow(trimmed) && i + 1 < lines.length && isTableRow(lines[i + 1].trim())) {
      const rows: string[][] = []
      while (i < lines.length && isTableRow(lines[i].trim())) {
        rows.push(splitRow(lines[i].trim()))
        i++
      }
      blocks.push(
        <div
          key={key++}
          className="my-2 overflow-x-auto rounded-md border border-border"
        >
          <table className="w-full text-[12px] border-collapse">
            <tbody>
              {rows.map((row, ri) => (
                <tr
                  key={ri}
                  className={ri % 2 === 0 ? "bg-transparent" : "bg-muted/20"}
                >
                  {row.map((cell, ci) => (
                    <td
                      key={ci}
                      className="px-2.5 py-1.5 text-foreground/85 align-top border-t border-border/50"
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

    // Blockquote
    if (trimmed.startsWith("> ")) {
      const quoteLines: string[] = []
      while (i < lines.length && lines[i].trim().startsWith("> ")) {
        quoteLines.push(lines[i].trim().slice(2))
        i++
      }
      blocks.push(
        <blockquote
          key={key++}
          className="my-2 border-l-2 border-primary/40 pl-2.5 text-sm leading-relaxed text-foreground/70 italic"
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
        <ul key={key++} className="my-2 space-y-0.5 pl-1">
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
                  className="mt-1.5 inline-block h-1 w-1 shrink-0 rounded-full bg-muted-foreground/60"
                  aria-hidden
                />
              )}
              <span
                className={it.checked ? "line-through text-muted-foreground" : ""}
              >
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
        <ol key={key++} className="my-2 space-y-0.5 pl-5 list-decimal">
          {items.map((it, ii) => (
            <li key={ii} className="text-sm leading-relaxed text-foreground/85">
              {parseInline(it)}
            </li>
          ))}
        </ol>,
      )
      continue
    }

    // Default paragraph
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
      <p key={key++} className="text-sm leading-relaxed text-foreground/90 my-1.5">
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

function isImageUrl(url: string): boolean {
  return /\.(png|jpe?g|gif|webp|svg|bmp|tiff|avif)(\?.*)?$/i.test(url)
}

function parseInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = []
  const regex = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|_[^_]+_|\[[^\]]+\]\([^\)]+\))/g
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
    } else if (token.startsWith("[")) {
      const linkMatch = token.match(/^\[([^\]]+)\]\(([^\)]+)\)$/)
      if (linkMatch) {
        const [, label, href] = linkMatch
        if (isImageUrl(href)) {
          parts.push(
            <img
              key={key++}
              src={href}
              alt={label || "Notion image"}
              className="inline-block max-w-full rounded-md border border-border"
              loading="lazy"
            />,
          )
        } else {
          parts.push(
            <a
              key={key++}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline underline-offset-4"
            >
              {label}
            </a>,
          )
        }
      } else {
        parts.push(token)
      }
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
        <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-accent text-accent-foreground px-4 py-2.5 text-sm leading-relaxed">
          {message.content}
        </div>
      </div>
    )
  }

  return (
    <div className="flex gap-3">
      <BrandMark className="mt-0.5 h-7 w-7 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium text-muted-foreground mb-1.5">Graphyne</div>
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
