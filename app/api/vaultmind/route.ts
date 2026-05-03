import { type NextRequest, NextResponse } from "next/server"
import { generateObject } from "ai"
import { z } from "zod"
import type { VaultmindRequest, VaultmindResponse, Intent } from "@/lib/vaultmind-types"
import {
  getWorkspaceSnapshot,
  rankPages,
  buildSubgraph,
  fetchPageContent,
} from "@/lib/notion-retriever"

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
    console.log("[v0] API: intent=", intentKey, "query=", message.slice(0, 60))

    // 1. Retrieve workspace and rank relevant pages
    const snap = await getWorkspaceSnapshot()
    console.log(
      `[v0] API: snapshot has ${snap.pages.size} pages, ${snap.edges.length} edges, usingMock=${snap.usingMock}`,
    )
    const topPages = rankPages(message, snap)
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
      topPages.slice(0, 3).map(p => fetchPageContent(p.id)),
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
      const result = await generateObject({
        model: "openai/gpt-4o-mini",
        schema: z.object({ answer: z.string() }),
        system: `You are VaultMind, an AI-powered Notion workspace assistant.

**Current intent**: ${intentKey}
**Instruction**: ${INTENT_INSTRUCTIONS[intentKey]}

The user's workspace has been retrieved via the Notion API. Below are the most relevant pages and their content. Use this context to generate a helpful, grounded answer.

Always reference specific page titles in **bold** when citing sources. Be concise but complete.`,
        prompt: `User query: "${message}"

Retrieved context:

${contextDocs.length > 0 ? contextDocs : "_(No matching pages found in workspace)_"}

Graph contains ${graph.nodes.length} nodes: ${graph.nodes.map(n => n.label).join(", ")}

Generate a helpful answer based on this context.`,
        temperature: 0.3,
      })
      answer = result.object.answer
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
    console.error("[v0] VaultMind API error:", error)
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
  const firstSnippet = (c: (typeof contents)[number]) => {
    const lines = c.content
      .split("\n")
      .map(l => l.trim())
      .filter(l => l && !l.startsWith("#") && !l.startsWith("_"))
    return lines.slice(0, 3).join(" ").slice(0, 280)
  }

  switch (intent) {
    case "summarize": {
      const top = contents[0]
      const others = contents.slice(1).map(c => `**${c.title}**`).join(" and ")
      const snippet = firstSnippet(top)
      return [
        `Here's a summary based on **${top.title}**:`,
        "",
        snippet || "_(This page has no extractable text yet.)_",
        "",
        others ? `Related pages: ${others}.` : "",
      ]
        .filter(Boolean)
        .join("\n")
    }
    case "connect": {
      const lines: string[] = [`I found ${contents.length} related items in your workspace: ${titles}.`, ""]
      const edges = graph.edges.slice(0, 8)
      if (edges.length === 0) {
        lines.push("No explicit relationships were found between these pages.")
      } else {
        lines.push("**Connections:**")
        for (const e of edges) {
          const from = graph.nodes.find(n => n.id === e.from)?.label ?? e.from
          const to = graph.nodes.find(n => n.id === e.to)?.label ?? e.to
          lines.push(`- **${from}** ${e.relation ?? "links to"} **${to}**`)
        }
      }
      return lines.join("\n")
    }
    case "brief": {
      const tasks = contents.filter(c => c.type === "task" || /todo|task/i.test(c.title))
      const notes = contents.filter(c => c.type === "note")
      const refs = contents.filter(c => c.type === "page" || c.type === "database")
      const lines: string[] = [`Here's your briefing on "${message}":`, ""]
      if (tasks.length) lines.push(`**Tasks:** ${tasks.map(t => `**${t.title}**`).join(", ")}`)
      if (notes.length) lines.push(`**Notes:** ${notes.map(n => `**${n.title}**`).join(", ")}`)
      if (refs.length) lines.push(`**References:** ${refs.map(r => `**${r.title}**`).join(", ")}`)
      lines.push("")
      lines.push(firstSnippet(contents[0]))
      return lines.join("\n")
    }
    case "search":
    default: {
      const lines: string[] = [
        `Found ${contents.length} relevant ${contents.length === 1 ? "page" : "pages"} for "${message}":`,
        "",
      ]
      for (const c of contents) {
        lines.push(`- **${c.title}** _(${c.type})_ — ${firstSnippet(c) || "No preview available."}`)
      }
      return lines.join("\n")
    }
  }
}
