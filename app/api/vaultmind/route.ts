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
    "The user wants a concise summary of a single page or topic. Summarize the most relevant page only. Do not list search results.",
  connect:
    "The user wants to understand how ideas or resources relate to each other. Explain connections and the grounds for each connection (references, contains, shared topic, same domain). Do not list search results.",
  brief:
    "The user wants a daily briefing. Find items tied to today's date in their Notion data and summarize what is planned for today.",
}

const MONTHS_LONG = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
]
const MONTHS_SHORT = [
  "Jan","Feb","Mar","Apr","May","Jun",
  "Jul","Aug","Sep","Oct","Nov","Dec",
]

function pad2(value: number): string {
  return value.toString().padStart(2, "0")
}

function buildDateTokens(date: Date): string[] {
  const year = date.getFullYear()
  const monthIndex = date.getMonth()
  const day = date.getDate()
  const mm = pad2(monthIndex + 1)
  const dd = pad2(day)
  const longMonth = MONTHS_LONG[monthIndex]
  const shortMonth = MONTHS_SHORT[monthIndex]

  const tokens = new Set<string>([
    `${year}-${mm}-${dd}`,
    `${year}/${mm}/${dd}`,
    `${mm}/${dd}/${year}`,
    `${dd}/${mm}/${year}`,
    `${shortMonth} ${day}`,
    `${shortMonth} ${dd}`,
    `${longMonth} ${day}`,
    `${longMonth} ${dd}`,
    `${shortMonth} ${day}, ${year}`,
    `${longMonth} ${day}, ${year}`,
    `${day} ${shortMonth}`,
    `${day} ${longMonth}`,
    "today",
  ])

  return Array.from(tokens)
}

function formatDateLabel(date: Date): string {
  const month = MONTHS_LONG[date.getMonth()]
  return `${month} ${date.getDate()}, ${date.getFullYear()}`
}

function extractBriefItems(
  contents: { title: string; type: string; content: string }[],
  dateTokens: string[],
): Array<{ title: string; type: string; lines: string[] }> {
  const tokens = dateTokens.map(t => t.toLowerCase())
  const items: Array<{ title: string; type: string; lines: string[] }> = []

  for (const entry of contents) {
    const lines = entry.content
      .split("\n")
      .map(line => line.trim())
      .filter(Boolean)
      .filter(line => !/^\|\s*---/.test(line))

    const matches = lines.filter(line => {
      const lower = line.toLowerCase()
      return tokens.some(token => lower.includes(token))
    })

    if (matches.length > 0) {
      items.push({ title: entry.title, type: entry.type, lines: matches.slice(0, 5) })
    }
  }

  return items
}

function buildConnectionAnswer(
  message: string,
  graph: { nodes: { id: string; label: string }[]; edges: { from: string; to: string; relation?: string }[] },
  seedIds: Set<string>,
): string {
  const nodesById = new Map(graph.nodes.map(n => [n.id, n.label]))
  const relationReason: Record<string, string> = {
    references: "explicit reference in the page content",
    contains: "parent/child structure in Notion",
    "relates to": "semantic similarity in content",
    "shares topic": "shared topic classification",
    "same domain": "same domain classification",
  }

  const directEdges = graph.edges.filter(e => seedIds.has(e.from) && seedIds.has(e.to))
  const edges = directEdges.length > 0 ? directEdges : graph.edges.slice(0, 10)

  if (edges.length === 0) {
    return `I couldn't find explicit links between the top pages for "${message}". Try refining the query or open a page so I can connect it to related items.`
  }

  const lines: string[] = [`## Connections for "${message}"`, ""]
  for (const edge of edges) {
    const from = nodesById.get(edge.from) ?? edge.from
    const to = nodesById.get(edge.to) ?? edge.to
    const relation = edge.relation ?? "linked to"
    const reason = relationReason[relation] ?? "graph relationship"
    lines.push(`- **${from}** ${relation} **${to}** — ${reason}.`)
  }

  return lines.join("\n")
}

function buildBriefAnswer(
  message: string,
  dateLabel: string,
  items: Array<{ title: string; type: string; lines: string[] }>,
): string {
  if (items.length === 0) {
    return `I couldn't find anything dated for ${dateLabel}. Try sharing the relevant pages or add today's date to your task or calendar entries.`
  }

  const lines: string[] = [`## Today — ${dateLabel}`, ""]
  if (message.trim()) lines.push(`_${message.trim()}_`, "")

  for (const item of items) {
    lines.push(`### ${item.title}`)
    for (const line of item.lines) {
      lines.push(`- ${line}`)
    }
    lines.push("")
  }

  return lines.join("\n").trim()
}

function summarizeLines(content: string, maxItems = 6): string[] {
  const { bullets, headings, sentences } = extractSummaryCandidates(content)

  const items: string[] = []
  const seen = new Set<string>()
  const pushItem = (value: string) => {
    const cleaned = value.replace(/\s+/g, " ").trim()
    if (cleaned.length < 4) return
    if (seen.has(cleaned)) return
    seen.add(cleaned)
    items.push(cleaned)
  }

  bullets.forEach(pushItem)

  if (items.length < maxItems && sentences.length > 0) {
    for (const sentence of rankSentences(sentences, maxItems)) {
      pushItem(sentence)
      if (items.length >= maxItems) break
    }
  }

  if (items.length < maxItems) {
    headings.forEach(pushItem)
  }

  if (items.length > 0) return items.slice(0, maxItems)

  return sentences.slice(0, Math.min(3, maxItems))
}

function extractSummaryCandidates(content: string): {
  bullets: string[]
  headings: string[]
  sentences: string[]
} {
  const lines = content.split("\n")
  const bullets: string[] = []
  const headings: string[] = []
  const paragraphs: string[] = []
  let inCode = false
  let inTable = false
  let buffer: string[] = []

  const flushParagraph = () => {
    if (buffer.length === 0) return
    const merged = buffer.join(" ").replace(/\s+/g, " ").trim()
    if (merged) paragraphs.push(merged)
    buffer = []
  }

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith("```")) {
      inCode = !inCode
      flushParagraph()
      continue
    }
    if (inCode) continue
    if (!trimmed) {
      flushParagraph()
      inTable = false
      continue
    }

    if (/^\|.*\|$/.test(trimmed)) {
      inTable = true
      flushParagraph()
      continue
    }
    if (inTable) continue

    if (trimmed.startsWith("#")) {
      flushParagraph()
      const text = trimmed.replace(/^#+\s*/, "").trim()
      if (text) headings.push(text)
      continue
    }

    if (/^[-*+]\s+/.test(trimmed) || /^\d+\./.test(trimmed)) {
      flushParagraph()
      const text = trimmed.replace(/^[-*+]\s+/, "").replace(/^\d+\./, "").trim()
      if (text) bullets.push(text)
      continue
    }

    if (trimmed.startsWith("_") && trimmed.endsWith("_")) continue
    buffer.push(trimmed)
  }

  flushParagraph()

  const sentences = paragraphs
    .flatMap(p => p.split(/[.!?]\s+/))
    .map(s => s.trim())
    .filter(Boolean)

  return { bullets, headings, sentences }
}

function tokenizeSummary(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(token => token.length > 2)
}

function rankSentences(sentences: string[], maxItems: number): string[] {
  if (sentences.length <= 2) return sentences

  const tokens = sentences.map(s => tokenizeSummary(s))
  const docFreq = new Map<string, number>()
  for (const sentenceTokens of tokens) {
    const unique = new Set(sentenceTokens)
    for (const token of unique) {
      docFreq.set(token, (docFreq.get(token) ?? 0) + 1)
    }
  }

  const tfidf = tokens.map((sentenceTokens, index) => {
    const counts = new Map<string, number>()
    for (const token of sentenceTokens) {
      counts.set(token, (counts.get(token) ?? 0) + 1)
    }
    const vec = new Map<string, number>()
    const maxTf = Math.max(...Array.from(counts.values()), 1)
    for (const [token, count] of counts) {
      const tf = count / maxTf
      const df = docFreq.get(token) ?? 1
      const idf = Math.log((sentences.length + 1) / (df + 1)) + 1
      vec.set(token, tf * idf)
    }
    return { index, vec }
  })

  const similarity = Array.from({ length: sentences.length }, () => Array(sentences.length).fill(0))
  for (let i = 0; i < tfidf.length; i++) {
    for (let j = i + 1; j < tfidf.length; j++) {
      const score = cosineSim(tfidf[i].vec, tfidf[j].vec)
      similarity[i][j] = score
      similarity[j][i] = score
    }
  }

  const scores = textRank(similarity, 0.85, 20)
  const ranked = scores
    .map((score, index) => ({ index, score, length: sentences[index].length }))
    .sort((a, b) => b.score - a.score || b.length - a.length)
    .slice(0, Math.min(maxItems, Math.max(3, Math.ceil(sentences.length * 0.3))))
    .sort((a, b) => a.index - b.index)
    .map(item => sentences[item.index])

  return ranked
}

function cosineSim(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0
  let normA = 0
  let normB = 0
  for (const value of a.values()) normA += value * value
  for (const value of b.values()) normB += value * value
  const keys = new Set([...a.keys(), ...b.keys()])
  for (const key of keys) {
    dot += (a.get(key) ?? 0) * (b.get(key) ?? 0)
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

function textRank(similarity: number[][], damping: number, iterations: number): number[] {
  const n = similarity.length
  if (n === 0) return []
  let scores = Array(n).fill(1 / n)

  for (let iter = 0; iter < iterations; iter++) {
    const next = Array(n).fill((1 - damping) / n)
    for (let i = 0; i < n; i++) {
      const row = similarity[i]
      const rowSum = row.reduce((sum, v) => sum + v, 0)
      if (rowSum === 0) continue
      for (let j = 0; j < n; j++) {
        if (i === j) continue
        next[j] += damping * (row[j] / rowSum) * scores[i]
      }
    }
    scores = next
  }

  return scores
}

function buildSummaryAnswer(
  title: string,
  content: string,
): string {
  const items = summarizeLines(content)
  if (items.length === 0) {
    return `## Summary: ${title}\n\n_(No extractable summary yet.)_`
  }
  return [
    `## Summary: ${title}`,
    "",
    ...items.map(item => `- ${item}`),
  ].join("\n")
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
    const today = new Date()
    const dateTokens = intentKey === "brief" ? buildDateTokens(today) : []
    const rankingQuery = intentKey === "brief"
      ? `${message} ${dateTokens.join(" ")}`.trim()
      : message

    const topPages = await rankPages(rankingQuery, snap, token)
    console.log(
      "[v0] API: ranked",
      topPages.length,
      "pages, top 3:",
      topPages
        .slice(0, 3)
        .map(p => p.title)
        .join(" | "),
    )

    const contentLimit = intentKey === "summarize"
      ? 1
      : intentKey === "brief"
        ? 8
        : intentKey === "search"
          ? 3
          : 0

    // 2. Fetch content for the top pages (intent-specific)
    const contents = await Promise.all(
      topPages.slice(0, contentLimit).map(p => fetchPageContent(p.id, token)),
    )
    const validContents = contents.filter((c): c is NonNullable<typeof c> => c !== null)
    console.log("[v0] API: fetched content for", validContents.length, "pages")

    // 3. Build focused subgraph
    const graph = buildSubgraph(topPages.slice(0, Math.max(contentLimit, 6)), snap)

    if (intentKey === "summarize" && validContents.length === 0) {
      const answer = `I couldn't find a page to summarize for "${message}". Try using the exact page title or a more specific query.`
      const response: VaultmindResponse = { answer, graph }
      return NextResponse.json(response)
    }

    if (intentKey === "summarize") {
      const top = validContents[0]
      const answer = buildSummaryAnswer(top.title, top.content)
      const response: VaultmindResponse = { answer, graph }
      return NextResponse.json(response)
    }

    if (intentKey === "connect") {
      const seedIds = new Set(topPages.slice(0, 6).map(p => p.id))
      const answer = buildConnectionAnswer(message, graph, seedIds)
      const response: VaultmindResponse = { answer, graph }
      return NextResponse.json(response)
    }

    if (intentKey === "brief") {
      const dateLabel = formatDateLabel(today)
      const briefItems = extractBriefItems(validContents, dateTokens)
      const answer = buildBriefAnswer(message, dateLabel, briefItems)
      const response: VaultmindResponse = { answer, graph }
      return NextResponse.json(response)
    }

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
