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

    const intentKey = intent ?? "search"

    // 1. Retrieve workspace and rank relevant pages
    const snap = await getWorkspaceSnapshot()
    const topPages = rankPages(message, snap)

    // 2. Fetch content for top 3 pages
    const contents = await Promise.all(
      topPages.slice(0, 3).map(p => fetchPageContent(p.id)),
    )
    const validContents = contents.filter((c): c is NonNullable<typeof c> => c !== null)

    // 3. Build focused subgraph
    const graph = buildSubgraph(topPages, snap)

    // 4. Generate LLM answer using AI SDK with structured output
    const contextDocs = validContents
      .map(c => `### ${c.title}\n${c.content}`)
      .join("\n\n")

    const result = await generateObject({
      model: "openai/gpt-4o-mini",
      schema: z.object({
        answer: z.string(),
      }),
      system: `You are VaultMind, an AI-powered Notion workspace assistant.

**Current intent**: ${intentKey}
**Instruction**: ${INTENT_INSTRUCTIONS[intentKey]}

The user's workspace has been retrieved via MCP. Below are the most relevant pages and their content. Use this context to generate a helpful, grounded answer.

Always reference specific page titles in **bold** when citing sources. Be concise but complete.`,
      prompt: `User query: "${message}"

Retrieved context:

${contextDocs.length > 0 ? contextDocs : "_(No matching pages found in workspace)_"}

Graph contains ${graph.nodes.length} nodes: ${graph.nodes.map(n => n.label).join(", ")}

Generate a helpful answer based on this context.`,
      temperature: 0.3,
    })

    const response: VaultmindResponse = {
      answer: result.object.answer,
      graph,
    }

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
