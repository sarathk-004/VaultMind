import type { CachedSnapshot } from "@/lib/notion-retriever"
import { buildSubgraph, fetchPageContent, rankPages } from "@/lib/notion-retriever"
import type { Intent } from "@/lib/vaultmind-types"
import type { StackerConfig, StackerRetrievalHit } from "@/lib/stacker/types"
import { isStackerEnabled, retrieveWithStacker } from "@/lib/stacker/service"
import { mergeDocuments, mergeHits, selectGraph } from "./fusion"
import { planQuery } from "./planner"
import type { OrchestrationDocument, OrchestrationResult } from "./types"

const EXACT_TITLE_STOPWORDS = new Set([
  "the","a","an","and","or","of","to","in","on","for","with","show","find","search","give",
  "please","about","my","me","i","do","does","can","could","would","tell",
])

interface OrchestrateOptions {
  query: string
  intent: Intent
  snapshot: CachedSnapshot
  token?: string | null
  contentLimit: number
  config: StackerConfig
  workspaceId?: string | null
}

export async function orchestrateQuery(options: OrchestrateOptions): Promise<OrchestrationResult> {
  const plan = planQuery(options.intent, {
    contentLimit: options.contentLimit,
    stackerEnabled: isStackerEnabled(options.config),
  })

  const rankedPages = await rankPages(options.query, options.snapshot, options.token)
  const exactIds = findExactTitlePageIds(options.query, options.snapshot)
  const topPages = rankedPages.slice(0, Math.max(options.contentLimit, 6))
  const fallbackGraph = buildSubgraph(topPages, options.snapshot)

  let notionDocs: OrchestrationDocument[] = []
  if (plan.steps.find(step => step.kind === "notion")?.enabled) {
    const contents = await Promise.all(
      rankedPages.slice(0, options.contentLimit).map(page => fetchPageContent(page.id, options.token)),
    )
    notionDocs = contents
      .filter((content): content is NonNullable<typeof content> => content !== null)
      .map(content => ({
        id: content.id,
        title: content.title,
        type: content.type,
        content: content.content,
        url: content.url,
      }))
  }

  let stackerDocs: OrchestrationDocument[] = []
  let stackerGraph = null as OrchestrationResult["graph"] | null
  let stackerHits: StackerRetrievalHit[] = []

  if (plan.steps.find(step => step.kind === "stacker")?.enabled) {
    const stackerContext = await retrieveWithStacker({
      query: options.query,
      intent: options.intent,
      snapshot: options.snapshot,
      token: options.token,
      contentLimit: options.contentLimit,
      config: options.config,
      workspaceId: options.workspaceId,
    })
    stackerDocs = stackerContext.documents
      .filter(doc => exactIds.size === 0 || exactIds.has(doc.id.replace(/-/g, "")))
      .map(doc => ({
        id: doc.id,
        title: doc.title,
        type: doc.type,
        content: doc.content,
        url: doc.url,
      }))
    stackerGraph = stackerContext.graph
    stackerHits = stackerContext.hits
  }

  const notionHits: StackerRetrievalHit[] = rankedPages.map((page, index) => ({
    documentId: page.id,
    title: page.title,
    text: "",
    score: (rankedPages.length - index) / Math.max(1, rankedPages.length),
    source: "keyword",
  }))

  const documents = mergeDocuments(stackerDocs, notionDocs)
  const hits = mergeHits(stackerHits, notionHits).slice(0, Math.max(options.contentLimit, 8))
  const graph = selectGraph(stackerGraph, fallbackGraph)

  return {
    plan,
    documents,
    hits,
    graph,
    topPages: topPages.map(page => ({
      id: page.id,
      title: page.title,
      type: page.type,
    })),
  }
}

function findExactTitlePageIds(query: string, snapshot: CachedSnapshot): Set<string> {
  const qTokens = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(token => token.length >= 2 && !EXACT_TITLE_STOPWORDS.has(token))
  if (qTokens.length < 2) return new Set()

  const ids = new Set<string>()
  for (const page of snapshot.pages.values()) {
    const title = page.title.toLowerCase().replace(/[^a-z0-9\s]/g, " ")
    if (qTokens.every(token => new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(title))) {
      ids.add(page.id.replace(/-/g, ""))
    }
  }
  return ids
}
