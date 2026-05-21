import { type NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import type { VaultmindRequest, VaultmindResponse, Intent } from "@/lib/vaultmind-types"
import {
  getWorkspaceSnapshot,
  rankPages,
  buildSubgraph,
  fetchPageContent,
} from "@/lib/notion-retriever"
import { getRequestNotionToken } from "@/lib/notion-token"
import { generateStructured, providerOptionsFromSettings } from "@/lib/llm-client"
import { getRequestLlmSettings, hasUserLlmKey } from "@/lib/llm-settings"

const INTENT_INSTRUCTIONS: Record<Intent, string> = {
  search:
    "The user wants to find pages, databases, tasks, and notes related to their query. List what you found, grouped by type, and guide them to open citations or explore the graph.",
  summarize:
    "The user wants a concise summary of the topic. Extract the key points from the most relevant page and weave in context from linked resources. Be clear and direct.",
  connect:
    "The user wants to understand how ideas or resources relate to each other. Surface relationships, dependencies, and cross-references explicitly. Use phrases like 'X depends on Y' or 'A is linked to B through C'.",
  brief:
    "The user wants a quick daily/weekly briefing. Organize by urgency or category (tasks in flight, recent notes, key references). Highlight status and next actions where available.",
}

export async function POST(req: NextRequest) {
  try {
    const { message, intent }: VaultmindRequest = await req.json()

    if (!message || typeof message !== "string" || message.trim().length === 0) {
      return NextResponse.json({ error: "Message is required" }, { status: 400 })
    }

    const intentKey: Intent = intent ?? "search"
    const token = await getRequestNotionToken()
    const llmSettings = await getRequestLlmSettings()
    const userLlmConfigured = hasUserLlmKey(llmSettings)
    console.log(
      "[v0] API: intent=",
      intentKey,
      "query=",
      message.slice(0, 60),
      "tokenSource=",
      token ? "oauth-cookie" : process.env.NOTION_API_KEY ? "env" : "none",
      "llmProvider=",
      llmSettings.provider,
      "llmKeySource=",
      userLlmConfigured ? "user-cookie/local" : "env-or-none",
    )

    // 1. Retrieve workspace and rank relevant pages
    const snap = await getWorkspaceSnapshot(token, {
      ...providerOptionsFromSettings(llmSettings),
      budgetMs: userLlmConfigured ? 12_000 : 2_500,
    })
    console.log(
      `[v0] API: snapshot has ${snap.pages.size} pages, ${snap.edges.length} edges, usingMock=${snap.usingMock}`,
    )
    const topPages = await rankPages(message, snap, token)
    console.log(
      "[v0] API: ranked",
      topPages.length,
      "pages, top 3:",
      topPages
        .slice(0, 3)
        .map(p => p.title)
        .join(" | "),
    )

    // 2. Fetch content for top 3 pages
    const contents = await Promise.all(
      topPages.slice(0, 3).map(p => fetchPageContent(p.id, token)),
    )
    const validContents = contents.filter((c): c is NonNullable<typeof c> => c !== null)
    console.log("[v0] API: fetched content for", validContents.length, "pages")

    // 3. Build focused subgraph
    const graph = buildSubgraph(topPages, snap)

    // 4. Generate answer — try LLM first, fall back to deterministic synthesis
    const contextDocs = validContents
      .map(c => `### ${c.title}\n${c.content}`)
      .join("\n\n")

    let answer: string

    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), userLlmConfigured ? 18_000 : 2_500)
      try {
        const result = await generateStructured({
          schema: z.object({ answer: z.string() }),
          system: `You are Graphyne, an AI-powered Notion workspace assistant.

**Current intent**: ${intentKey}
**Instruction**: ${INTENT_INSTRUCTIONS[intentKey]}

The user's workspace has been retrieved via the Notion API. Below are the most relevant pages and their content. Use this context to generate a helpful, grounded answer.

Always reference specific page titles in **bold** when citing sources. Be concise but complete.`,
        prompt: `User query: "${message}"

Retrieved context:

${contextDocs.length > 0 ? contextDocs : "_(No matching pages found in workspace)_"}

Graph contains ${graph.nodes.length} nodes: ${graph.nodes.map(n => n.label).join(", ")}

Generate a helpful answer based on this context.`,
          signal: controller.signal,
          label: "answer generation",
          useCase: "answer",
          ...providerOptionsFromSettings(llmSettings),
        })
        answer = result.answer
      } finally {
        clearTimeout(timer)
      }
    } catch (llmErr) {
      console.warn(
        "[v0] LLM unavailable, using deterministic synthesis:",
        llmErr instanceof Error ? llmErr.message : llmErr,
      )
      answer = synthesizeAnswer(message, intentKey, validContents, graph)
    }

    const response: VaultmindResponse = { answer, graph }
    return NextResponse.json(response)
  } catch (error) {
    console.error("[v0] Graphyne API error:", error)
    return NextResponse.json(
      {
        error: "Internal server error",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}

/**
 * Deterministic answer synthesizer — used when the LLM is unavailable
 * (e.g. AI Gateway billing not configured). Pulls real Notion content from
 * the retrieved pages so the user always gets a grounded, useful response.
 *
 * When the source content contains tables or structured data (markdown tables,
 * lists, code blocks), it preserves them in the output so the chat UI can
 * render them properly.
 */
function synthesizeAnswer(
  message: string,
  intent: Intent,
  contents: { id: string; title: string; type: string; content: string }[],
  graph: { nodes: { id: string; label: string; type?: string }[]; edges: { from: string; to: string; relation?: string }[] },
): string {
  if (contents.length === 0) {
    return `I couldn't find pages in your workspace matching "${message}". Try a different keyword, or share more pages with the integration.`
  }

  const titles = contents.map(c => `**${c.title}**`).join(", ")

  // Extract a meaningful snippet that preserves tables and structured content
  const getSnippet = (c: (typeof contents)[number], maxLines = 12) => {
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
  const shortPreview = (c: (typeof contents)[number]) => {
    const lines = c.content
      .split("\n")
      .map(l => l.trim())
      .filter(l => l && !l.startsWith("#") && !l.startsWith("_") && !l.startsWith("|"))
    return lines.slice(0, 2).join(" ").slice(0, 200)
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
        `Found ${contents.length} related items: ${titles}.`,
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
          lines.push(`| **${from}** | ${e.relation ?? "links to"} | **${to}** |`)
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
        for (const n of notes) lines.push(`- **${n.title}**`)
        lines.push("")
      }
      if (refs.length) {
        lines.push("### References")
        for (const r of refs) lines.push(`- **${r.title}** _(${r.type})_`)
        lines.push("")
      }
      // Include structured content from top result
      const topSnippet = getSnippet(contents[0], 10)
      if (topSnippet) {
        lines.push("### Preview")
        lines.push("")
        lines.push(topSnippet)
      }
      return lines.join("\n")
    }
    case "search":
    default: {
      const lines: string[] = [
        `## Results for "${message}"`,
        "",
        `Found ${contents.length} relevant ${contents.length === 1 ? "page" : "pages"}:`,
        "",
      ]
      
      // Show as table if we have multiple results
      if (contents.length > 1) {
        lines.push("| Page | Type | Preview |")
        lines.push("| --- | --- | --- |")
        for (const c of contents) {
          const preview = shortPreview(c).slice(0, 80) || "No preview"
          lines.push(`| **${c.title}** | ${c.type} | ${preview}${preview.length >= 80 ? "..." : ""} |`)
        }
        lines.push("")
      }
      
      // Show full content of top result with structure preserved
      const top = contents[0]
      lines.push(`### ${top.title}`)
      lines.push("")
      const topSnippet = getSnippet(top, 20)
      lines.push(topSnippet || "_(No content available)_")
      
      return lines.join("\n")
    }
  }
}
