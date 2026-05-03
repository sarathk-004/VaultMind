/**
 * Convert Notion block payloads into a compact markdown representation
 * + harvest mention links to other pages (used to enrich the graph).
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
      return t.plain_text ?? ""
    })
    .join("")
}

export function blocksToMarkdown(blocks: any[]): BlockExtract {
  const lines: string[] = []
  const mentioned = new Set<string>()

  for (const block of blocks) {
    const t = block.type
    const data = block[t]
    if (!data) continue

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
      case "toggle":
        lines.push(richTextToMd(data.rich_text, mentioned))
        break
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
        if (block.id) mentioned.add(block.id)
        lines.push(`- ${data.title ?? "Untitled database"}`)
        break
      case "link_to_page":
        if (data.page_id) mentioned.add(data.page_id)
        if (data.database_id) mentioned.add(data.database_id)
        break
      default:
        // Best-effort: surface any rich_text we find
        if (data.rich_text) lines.push(richTextToMd(data.rich_text, mentioned))
        break
    }
  }

  return {
    markdown: lines.filter(l => l.trim().length > 0).join("\n\n"),
    mentionedIds: Array.from(mentioned),
  }
}
