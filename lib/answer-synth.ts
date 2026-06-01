import type { Intent } from "./vaultmind-types"

export interface SynthContent {
  id: string
  title: string
  type: string
  content: string
}

export interface SynthGraph {
  nodes: { id: string; label: string; type?: string }[]
  edges: { from: string; to: string; relation?: string }[]
}

/**
 * Deterministic answer synthesizer — used when the LLM is unavailable.
 * Preserves tables and structured content so the UI can render properly.
 */
export function synthesizeAnswer(
  message: string,
  intent: Intent,
  contents: SynthContent[],
  graph: SynthGraph,
): string {
  if (contents.length === 0) {
    return `I couldn't find pages in your workspace matching "${message}". Try a different keyword, or share more pages with the integration.`
  }

  const titles = contents.map(c => `**${c.title}**`).join(", ")

  // Extract a meaningful snippet that preserves tables and structured content
  const getSnippet = (c: SynthContent, maxLines = 12) => {
    const lines = c.content.split("\n")
    const result: string[] = []
    let inTable = false
    let inCodeBlock = false

    for (const line of lines) {
      if (result.length >= maxLines && !inTable && !inCodeBlock) break

      const trimmed = line.trim()

      // Track code blocks
      if (trimmed.startsWith("```")) {
        inCodeBlock = !inCodeBlock
        result.push(line)
        continue
      }
      if (inCodeBlock) {
        result.push(line)
        continue
      }

      // Track tables
      if (/^\|.*\|$/.test(trimmed)) {
        inTable = true
        result.push(line)
        continue
      } else if (inTable && trimmed === "") {
        inTable = false
      }

      // Skip empty lines at the start
      if (result.length === 0 && trimmed === "") continue

      // Skip standalone headers/metadata lines
      if (trimmed.startsWith("_") && trimmed.endsWith("_")) continue

      result.push(line)
    }

    return result.join("\n").trim()
  }

  // Short text preview for list items
  const shortPreview = (c: SynthContent) => {
    const lines = c.content
      .split("\n")
      .map(l => l.trim())
      .filter(l => l && !l.startsWith("#") && !l.startsWith("_") && !l.startsWith("|"))
    return lines.slice(0, 2).join(" ").slice(0, 200)
  }

  const searchReason = (c: SynthContent) => {
    const preview = shortPreview(c)
    if (preview) return preview.length > 140 ? preview.slice(0, 137) + "..." : preview
    return `Matched by title or workspace links as a ${c.type}.`
  }

  switch (intent) {
    case "summarize": {
      const top = contents[0]
      const others = contents.slice(1).map(c => `**${c.title}**`).join(" and ")
      const snippet = getSnippet(top, 15)
      return [
        `## Summary: ${top.title}`,
        "",
        snippet || "_(This page has no extractable text yet.)_",
        "",
        others ? `**Related pages:** ${others}` : "",
      ]
        .filter(Boolean)
        .join("\n")
    }
    case "connect": {
      const lines: string[] = [
        `## Connections for "${message}"`,
        "",
        `Found ${contents.length} connected items: ${titles}.`,
        "",
      ]
      const edges = graph.edges.slice(0, 10)
      if (edges.length === 0) {
        lines.push("No explicit relationships were found between these pages.")
      } else {
        lines.push("### Relationships")
        lines.push("")
        lines.push("| From | Relation | To |")
        lines.push("| --- | --- | --- |")
        for (const e of edges) {
          const from = graph.nodes.find(n => n.id === e.from)?.label ?? e.from
          const to = graph.nodes.find(n => n.id === e.to)?.label ?? e.to
          const relation = e.relation === "relates to" ? "connects with" : e.relation ?? "links to"
          lines.push(`| **${from}** | ${relation} | **${to}** |`)
        }
      }
      return lines.join("\n")
    }
    case "brief": {
      const tasks = contents.filter(c => c.type === "task" || /todo|task/i.test(c.title))
      const notes = contents.filter(c => c.type === "note")
      const refs = contents.filter(c => c.type === "page" || c.type === "database")
      const lines: string[] = [
        `## Briefing: ${message}`,
        "",
      ]
      if (tasks.length) {
        lines.push("### Tasks")
        for (const t of tasks) lines.push(`- [ ] **${t.title}**`)
        lines.push("")
      }
      if (notes.length) {
        lines.push("### Notes")
        for (const n of notes) lines.push(`- **${n.title}** — ${shortPreview(n)}`)
        lines.push("")
      }
      if (refs.length) {
        lines.push("### References")
        for (const r of refs) lines.push(`- **${r.title}** — ${shortPreview(r)}`)
      }
      return lines.join("\n").trim()
    }
    case "search":
    default: {
      const lines: string[] = [
        `## Results for "${message}"`,
        "",
      ]
      for (const c of contents.slice(0, 6)) {
        lines.push(`- **${c.title}** - ${searchReason(c)}`)
      }
      return lines.join("\n").trim()
    }
  }
}
