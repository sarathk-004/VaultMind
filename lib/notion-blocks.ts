/**
 * Convert Notion block payloads into a compact markdown representation
 * + harvest mention links to other pages (used to enrich the graph).
 *
 * Handles nested structures (column_list, synced_block, toggle), tables
 * (table + table_row), and emits a list of child_database ids the
 * retriever should query separately to inline database rows.
 */

interface RichTextItem {
  plain_text?: string
  href?: string | null
  type?: string
  mention?: { type: string; page?: { id: string }; database?: { id: string } }
}

export interface BlockExtract {
  markdown: string
  mentionedIds: string[]
  /** child_database block ids the caller can query separately to inline rows */
  childDatabaseIds: { id: string; title: string }[]
  /** nested block ids (toggle, column, synced_block) we should expand for fuller context */
  nestedBlockIds: string[]
}

function richTextToMd(rt: RichTextItem[] | undefined, mentioned: Set<string>): string {
  if (!rt || rt.length === 0) return ""
  return rt
    .map(t => {
      const mention = t.mention
      if (mention) {
        if (mention.type === "page" && mention.page?.id) mentioned.add(mention.page.id)
        if (mention.type === "database" && mention.database?.id)
          mentioned.add(mention.database.id)
      }
      const text = t.plain_text ?? ""
      if (t.href) return `[${text}](${t.href})`
      return text
    })
    .join("")
}

function tableRowToMd(
  data: { cells?: RichTextItem[][] },
  mentioned: Set<string>,
): string {
  if (!data.cells) return ""
  const cells = data.cells.map(cell => richTextToMd(cell, mentioned).trim() || " ")
  return `| ${cells.join(" | ")} |`
}

interface BlocksToMarkdownOptions {
  /** Map from block id → its already-fetched children (for recursion). */
  childrenMap?: Map<string, any[]>
  depth?: number
}

export function blocksToMarkdown(
  blocks: any[],
  opts: BlocksToMarkdownOptions = {},
): BlockExtract {
  const lines: string[] = []
  const mentioned = new Set<string>()
  const childDatabases: { id: string; title: string }[] = []
  const nestedBlockIds: string[] = []
  const childrenMap = opts.childrenMap ?? new Map<string, any[]>()
  const depth = opts.depth ?? 0
  const MAX_DEPTH = 3

  for (const block of blocks) {
    const t = block.type
    const data = block[t]
    if (!data && t !== "divider" && t !== "table_row") continue

    switch (t) {
      case "heading_1":
        lines.push(`## ${richTextToMd(data.rich_text, mentioned)}`)
        break
      case "heading_2":
        lines.push(`### ${richTextToMd(data.rich_text, mentioned)}`)
        break
      case "heading_3":
        lines.push(`#### ${richTextToMd(data.rich_text, mentioned)}`)
        break
      case "paragraph":
        lines.push(richTextToMd(data.rich_text, mentioned))
        break
      case "bulleted_list_item":
        lines.push(`- ${richTextToMd(data.rich_text, mentioned)}`)
        break
      case "numbered_list_item":
        lines.push(`1. ${richTextToMd(data.rich_text, mentioned)}`)
        break
      case "to_do":
        lines.push(
          `- [${data.checked ? "x" : " "}] ${richTextToMd(data.rich_text, mentioned)}`,
        )
        break
      case "toggle": {
        const title = richTextToMd(data.rich_text, mentioned)
        lines.push(`**${title || "Toggle"}**`)
        if (block.has_children && depth < MAX_DEPTH) {
          const kids = childrenMap.get(block.id)
          if (kids && kids.length) {
            const sub = blocksToMarkdown(kids, { childrenMap, depth: depth + 1 })
            sub.mentionedIds.forEach(id => mentioned.add(id))
            sub.childDatabaseIds.forEach(d => childDatabases.push(d))
            sub.nestedBlockIds.forEach(id => nestedBlockIds.push(id))
            lines.push(sub.markdown)
          } else {
            nestedBlockIds.push(block.id)
          }
        }
        break
      }
      case "quote":
        lines.push(`> ${richTextToMd(data.rich_text, mentioned)}`)
        break
      case "callout":
        lines.push(`> ${richTextToMd(data.rich_text, mentioned)}`)
        break
      case "code":
        lines.push("```\n" + richTextToMd(data.rich_text, mentioned) + "\n```")
        break
      case "divider":
        lines.push("---")
        break
      case "child_page":
        if (block.id) mentioned.add(block.id)
        lines.push(`- ${data.title ?? "Untitled"}`)
        break
      case "child_database":
        if (block.id) {
          mentioned.add(block.id)
          childDatabases.push({ id: block.id, title: data.title ?? "Untitled database" })
        }
        lines.push(`**Database:** ${data.title ?? "Untitled"}`)
        break
      case "link_to_page":
        if (data.page_id) mentioned.add(data.page_id)
        if (data.database_id) mentioned.add(data.database_id)
        break
      case "table": {
        // Tables have table_row children we may have prefetched
        if (block.has_children && depth < MAX_DEPTH) {
          const rows = childrenMap.get(block.id)
          if (rows && rows.length) {
            const rowMd: string[] = []
            for (let i = 0; i < rows.length; i++) {
              const row = rows[i]
              if (row.type === "table_row") {
                rowMd.push(tableRowToMd(row.table_row ?? {}, mentioned))
                if (i === 0 && data.has_column_header) {
                  const colCount = (row.table_row?.cells ?? []).length
                  rowMd.push("| " + Array(colCount).fill("---").join(" | ") + " |")
                }
              }
            }
            if (rowMd.length) lines.push(rowMd.join("\n"))
          } else {
            nestedBlockIds.push(block.id)
            lines.push("_(Table — fetching rows…)_")
          }
        }
        break
      }
      case "column_list":
      case "column":
      case "synced_block": {
        // Render children inline so column-laid-out text isn't lost
        if (block.has_children && depth < MAX_DEPTH) {
          const kids = childrenMap.get(block.id)
          if (kids && kids.length) {
            const sub = blocksToMarkdown(kids, { childrenMap, depth: depth + 1 })
            sub.mentionedIds.forEach(id => mentioned.add(id))
            sub.childDatabaseIds.forEach(d => childDatabases.push(d))
            sub.nestedBlockIds.forEach(id => nestedBlockIds.push(id))
            if (sub.markdown.trim()) lines.push(sub.markdown)
          } else {
            nestedBlockIds.push(block.id)
          }
        }
        break
      }
      case "image":
      case "video":
      case "file":
      case "pdf":
      case "embed":
      case "bookmark": {
        const url = data.external?.url ?? data.file?.url ?? data.url ?? ""
        const caption = richTextToMd(data.caption, mentioned)
        if (url) {
          if (t === "image") lines.push(`![${caption || "Image"}](${url})`)
          else lines.push(`[${caption || t}](${url})`)
        }
        break
      }
      case "equation":
        if (data.expression) lines.push("$$" + data.expression + "$$")
        break
      default:
        if (data?.rich_text) lines.push(richTextToMd(data.rich_text, mentioned))
        break
    }
  }

  return {
    markdown: lines.filter(l => l.trim().length > 0).join("\n\n"),
    mentionedIds: Array.from(mentioned),
    childDatabaseIds: childDatabases,
    nestedBlockIds,
  }
}
