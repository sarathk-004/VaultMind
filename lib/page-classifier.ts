/**
 * LLM-powered page classifier.
 *
 * Given a workspace's pages, ask an LLM (Vercel AI Gateway → openai/gpt-5-mini,
 * zero-config) to assign each page:
 *   - primary_category   : the single most important topic
 *   - secondary_categories: 0-3 additional topics that meaningfully appear
 *   - purpose            : what kind of artifact this is (sop, roadmap, idea, …)
 *
 * The classification is then fed into `lib/page-similarity.ts` where it acts
 * as the dominant signal:
 *   - Same primary + same purpose → strong boost (×1.8)
 *   - Same primary OR cross-bridge match → boost (×1.25–1.5)
 *   - No category overlap AND incompatible primaries → HARD REJECT
 *
 * This is what kills "Design in the Age of AI" ↔ "Stevens SOP" links: the LLM
 * tags the first as primary=design and the second as primary=sop. The pair has
 * zero category bridge, design×sop is on the incompatible list, → rejected.
 *
 * Calls are batched (≤25 pages per request) and cached in-memory by a hash
 * of (title + body prefix) so re-fetches don't re-classify. If anything in
 * the LLM call fails or times out, the function returns `null` and the
 * downstream similarity logic falls back to its built-in rule-based gates.
 */

import { generateText, Output } from "ai"
import { z } from "zod"

export const PAGE_CATEGORIES = [
  "ml",
  "us_edu",
  "sop",
  "lor",
  "career",
  "design",
  "programming",
  "finance",
  "health",
  "books",
  "travel",
  "ideas",
  "daily",
  "research",
  "productivity",
  "personal",
  "other",
] as const

export type PageCategory = (typeof PAGE_CATEGORIES)[number]

export const PAGE_PURPOSES = [
  "roadmap",
  "sop",
  "lor",
  "note",
  "idea",
  "comparison",
  "summary",
  "todo",
  "journal",
  "reference",
  "tutorial",
  "essay",
  "other",
] as const

export type PagePurpose = (typeof PAGE_PURPOSES)[number]

export interface PageClassification {
  primary_category: PageCategory
  secondary_categories: PageCategory[]
  purpose: PagePurpose
}

const ClassificationItem = z.object({
  id: z.string(),
  primary_category: z.enum(PAGE_CATEGORIES),
  secondary_categories: z.array(z.enum(PAGE_CATEGORIES)),
  purpose: z.enum(PAGE_PURPOSES),
})

const BatchResponse = z.object({
  classifications: z.array(ClassificationItem),
})

const SYSTEM_PROMPT = `You are a Notion workspace classifier. For each page (id, title, snippet) assign:
  - primary_category: the SINGLE most important topic
  - secondary_categories: 0-3 additional topics that genuinely appear (do not pad)
  - purpose: the kind of artifact

Categories:
  ml          machine learning, AI, NLP, deep learning, models, training, data science
  us_edu      US grad school admissions, GRE/TOEFL, university comparisons, MS programs
  sop         the Statement-of-Purpose ESSAY itself for a grad school application
  lor         a Letter-of-Recommendation document
  career      jobs, interviews, resumes, FAANG prep, hiring, career planning
  design      UX/UI/product/visual design as a discipline (NOT generic "design" used metaphorically)
  programming software engineering, code, frameworks, web/mobile/systems
  finance     personal finance, investing, budgeting, money management
  health      fitness, diet, exercise, sleep, wellness
  books       book notes, reading lists, literature (general, not for grad school)
  travel      trips, vacations, destinations
  ideas       abstract concepts, philosophical reflections, hypotheses, mental models
  daily       journals, gratitude, todos, weekly reviews
  research    academic papers, methodologies, literature reviews
  productivity workflow, tools, second-brain, note-taking systems
  personal    relationships, family, life events, anything intimate
  other       does not fit any of the above

Purposes:
  roadmap, sop, lor, note, idea, comparison, summary, todo, journal,
  reference, tutorial, essay, other

Critical rules:
  1. A "Design in the Age of AI" page is primary=design with secondary=[ml, ideas].
     It is NOT a us_edu / sop / lor page even though it mentions AI.
  2. A Stevens University SOP for ML is primary=sop with secondary=[us_edu, ml].
  3. An ML Roadmap is primary=ml with secondary=[career, ideas] if it discusses careers.
  4. A page comparing US universities is primary=us_edu with purpose=comparison.
  5. Be CONSERVATIVE with secondary_categories — only include if the topic is
     clearly and substantively present, not just incidentally mentioned.
  6. If unsure, prefer "other" over a wrong specific category.

Return JSON matching the schema. Include EVERY input page in the output.`

const cache = new Map<string, PageClassification>()

interface Doc {
  title: string
  body: string
}

/**
 * Classify a workspace's pages with the LLM. Returns a map of pageId → class,
 * or `null` if the LLM is unreachable / errored / timed out.
 */
export async function classifyPagesWithLLM(
  docs: Map<string, Doc>,
  opts: { signal?: AbortSignal; batchSize?: number; budgetMs?: number } = {},
): Promise<Map<string, PageClassification> | null> {
  const { batchSize = 25, budgetMs = 45_000 } = opts
  if (docs.size === 0) return new Map()

  const result = new Map<string, PageClassification>()
  const todo: Array<{ id: string; title: string; body: string; key: string }> = []

  for (const [id, doc] of docs) {
    const key = hashKey(doc.title, doc.body)
    const cached = cache.get(key)
    if (cached) {
      result.set(id, cached)
    } else {
      todo.push({ id, title: doc.title, body: doc.body, key })
    }
  }

  if (todo.length === 0) {
    console.log(`[v0] LLM classifier: all ${docs.size} pages cache-hit`)
    return result
  }

  // Wrap the whole classification phase in a budget so a stuck LLM call
  // can't blow the route's overall time limit.
  const overallController = new AbortController()
  const budgetTimer = setTimeout(() => overallController.abort(), budgetMs)
  const signal = composeSignals(opts.signal, overallController.signal)

  console.log(
    `[v0] LLM classifier: classifying ${todo.length} pages (${docs.size - todo.length} cached) in ${Math.ceil(todo.length / batchSize)} batches`,
  )

  try {
    for (let i = 0; i < todo.length; i += batchSize) {
      const batch = todo.slice(i, i + batchSize)
      const userPrompt = batch
        .map(d => `[id=${d.id}]\nTitle: ${d.title}\nSnippet: ${truncate(d.body, 600)}`)
        .join("\n\n---\n\n")

      const { output } = await generateText({
        model: "openai/gpt-5-mini",
        output: Output.object({ schema: BatchResponse }),
        system: SYSTEM_PROMPT,
        prompt: userPrompt,
        abortSignal: signal,
      })

      for (const cls of output.classifications) {
        const orig = batch.find(b => b.id === cls.id)
        if (!orig) continue
        const stored: PageClassification = {
          primary_category: cls.primary_category,
          secondary_categories: cls.secondary_categories,
          purpose: cls.purpose,
        }
        cache.set(orig.key, stored)
        result.set(cls.id, stored)
      }
    }

    // If the LLM dropped any pages, leave them out of the result map. The
    // similarity layer treats "no classification" as "no extra info" and
    // falls back to its rule-based gates for those nodes.
    console.log(
      `[v0] LLM classifier: classified ${result.size}/${docs.size} pages successfully`,
    )
    return result
  } catch (err) {
    console.warn(
      "[v0] LLM classifier failed — downstream similarity will use rule-based gates only:",
      err instanceof Error ? err.message : err,
    )
    return null
  } finally {
    clearTimeout(budgetTimer)
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function truncate(s: string, n: number): string {
  if (!s) return ""
  return s.length <= n ? s : s.slice(0, n) + "…"
}

/**
 * Cheap djb2 hash over (title + body prefix). Used as a stable cache key so
 * unchanged pages don't get re-classified on every workspace re-fetch.
 */
function hashKey(title: string, body: string): string {
  const s = `${title}|${(body || "").slice(0, 1200)}`
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return h.toString(36)
}

function composeSignals(...sigs: Array<AbortSignal | undefined>): AbortSignal {
  const ctrl = new AbortController()
  for (const s of sigs) {
    if (!s) continue
    if (s.aborted) {
      ctrl.abort()
      break
    }
    s.addEventListener("abort", () => ctrl.abort(), { once: true })
  }
  return ctrl.signal
}
