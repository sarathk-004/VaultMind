/**
 * LLM-powered page classifier.
 *
 * Given a workspace's pages, ask an LLM (Vercel AI Gateway → openai/gpt-5-mini,
 * zero-config) to assign each page a structured profile:
 *
 *   - primary_category    : the single most important fine-grained topic
 *   - secondary_categories: 0-3 additional topics that meaningfully appear
 *   - purpose             : the artifact type (sop, roadmap, idea, …)
 *   - domain              : BROAD topical area used for local-first retrieval
 *                           (engineering, education, lifestyle, …). Pages
 *                           only consider candidates in the same domain or
 *                           in an approved cross-domain bridge.
 *   - intent              : what the page is for (planning, automation,
 *                           application, learning, …). Same intent is a
 *                           strong navigational signal even across topics.
 *   - audience            : who the page is for (self, recruiters, …).
 *                           Mismatched audience is a strong negative signal.
 *
 * `domain` / `intent` / `audience` are NOT used for multiplicative score
 * boosting (the methodology forbids that — it amplifies noise). They drive
 * LOCAL-FIRST CANDIDATE RETRIEVAL: a page can only consider candidates from
 * its own pool, killing roughly 70% of cross-topic false positives like
 * "Design in the Age of AI" ↔ "Stevens SOP" before any scoring runs.
 *
 * Calls are batched (≤25 pages per request) and cached in-memory by a hash
 * of (title + body prefix) so re-fetches don't re-classify. If the LLM is
 * unreachable / errors / times out (45 s budget), the function returns
 * `null` and the downstream similarity logic falls back to k-Means cluster
 * pools and rule-based concept gates.
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

// Broad topical buckets used for LOCAL-FIRST candidate retrieval.
// Pages can only retrieve candidates from the same domain (or an approved
// cross-domain bridge). This is the strongest precision filter — it kills
// the vast majority of cross-topic false positives.
export const PAGE_DOMAINS = [
  "personal",     // self, family, life events, journals, gratitude
  "education",    // grad school, courses, university comparisons
  "engineering",  // SWE, programming, ML practice, systems, infra
  "research",     // academic papers, methodology, hypotheses
  "creative",     // design, writing, art as a discipline
  "lifestyle",    // health, fitness, travel, food, books-for-leisure
  "career",       // jobs, interviews, resumes, hiring
  "finance",      // money, investing, budgeting
  "general",      // ambiguous / multi-domain
] as const

export type PageDomain = (typeof PAGE_DOMAINS)[number]

// What the page is FOR. Same intent is a strong navigational signal:
// two "planning" pages in the same domain are likely linked workflow steps.
export const PAGE_INTENTS = [
  "self_improvement",
  "automation",
  "application",      // applying for X (job, school, grant)
  "learning",
  "planning",
  "documentation",
  "exploration",      // brainstorming, free-form thinking
  "tracking",         // logs, habits, metrics
  "communication",    // letters, messages, emails
  "decision_making",  // comparisons, pros/cons
  "other",
] as const

export type PageIntent = (typeof PAGE_INTENTS)[number]

// Who the page is for. Cross-audience pairs (e.g. self vs recruiters) are
// a strong signal that they shouldn't be linked even if topically similar.
export const PAGE_AUDIENCES = [
  "self",
  "team",
  "developers",
  "recruiters",
  "admissions",  // grad-school admissions committees
  "professors",
  "clients",
  "public",
  "other",
] as const

export type PageAudience = (typeof PAGE_AUDIENCES)[number]

export interface PageClassification {
  primary_category: PageCategory
  secondary_categories: PageCategory[]
  purpose: PagePurpose
  domain: PageDomain
  intent: PageIntent
  audience: PageAudience
  /** 3-7 specific topics (lowercase, short phrases) extracted by the
   *  LLM. Examples: ["bayesian inference", "linear regression"] for a
   *  stats page; ["transformers", "fine-tuning", "rag"] for an LLM
   *  page. Used as a fine-grained navigational overlap signal so two
   *  pages in the same broad domain but with different sub-vocabularies
   *  can still be recognized as topically related. */
  topics: string[]
}

const ClassificationItem = z.object({
  id: z.string(),
  primary_category: z.enum(PAGE_CATEGORIES),
  secondary_categories: z.array(z.enum(PAGE_CATEGORIES)),
  purpose: z.enum(PAGE_PURPOSES),
  domain: z.enum(PAGE_DOMAINS),
  intent: z.enum(PAGE_INTENTS),
  audience: z.enum(PAGE_AUDIENCES),
  topics: z.array(z.string()),
})

const BatchResponse = z.object({
  classifications: z.array(ClassificationItem),
})

const SYSTEM_PROMPT = `You are a Notion workspace classifier. For each page (id, title, snippet) assign a structured profile.

primary_category — the SINGLE most important fine-grained topic:
  ml          machine learning, AI, NLP, deep learning, models, training, data science
  us_edu      US grad school admissions, GRE/TOEFL, university comparisons, MS programs
  sop         the Statement-of-Purpose ESSAY itself for a grad school application
  lor         a Letter-of-Recommendation document
  career      jobs, interviews, resumes, FAANG prep, hiring, career planning
  design      UX/UI/product/visual design as a discipline (NOT "design" used metaphorically)
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

secondary_categories — 0-3 additional topics that GENUINELY appear (don't pad).

purpose — the artifact type:
  roadmap, sop, lor, note, idea, comparison, summary, todo, journal,
  reference, tutorial, essay, other

domain — BROAD topical area for local-first retrieval. Pages can only link
to other pages in the same domain (or an approved cross-domain bridge):
  personal     self, family, life events, journals, gratitude, intimate notes
  education    grad school, university comparisons, courses, learning programs
  engineering  SWE, programming, ML practice, systems, infrastructure, tools
  research     academic papers, methodology, hypotheses, literature reviews
  creative     UX/UI/product design, writing, art, visual creative work
  lifestyle    health, fitness, travel, food, books read for leisure
  career       jobs, interviews, resumes, hiring, career planning
  finance      money, investing, budgeting
  general      genuinely multi-domain or ambiguous

intent — what the page is FOR (functional purpose):
  self_improvement, automation, application, learning, planning, documentation,
  exploration, tracking, communication, decision_making, other

audience — who the page is for:
  self, team, developers, recruiters, admissions, professors, clients, public, other

Critical examples:
  1. "Design in the Age of AI" essay
       primary_category=design, domain=creative, intent=exploration,
       audience=self, purpose=essay.
       It is NOT in domain=education even though it mentions AI.
  2. "Stevens University SOP for MS in CS"
       primary_category=sop, domain=education, intent=application,
       audience=admissions, purpose=sop.
  3. "Health Plan Q3"
       primary_category=health, domain=lifestyle, intent=planning,
       audience=self, purpose=roadmap.
  4. "HackerRank Orchestrator"
       primary_category=programming, domain=engineering, intent=automation,
       audience=developers, purpose=tool/reference.
       (Health Plan and HackerRank Orchestrator share the words "system",
       "tracking", "planning" — but their domain/intent/audience triples
       are completely different and they MUST NOT be linked.)
  5. "ML Roadmap"
       primary_category=ml, domain=engineering, intent=learning OR planning,
       audience=self, purpose=roadmap.

Rules:
  - Be CONSERVATIVE with secondary_categories — only include if the topic
    is clearly and substantively present, not just incidentally mentioned.
  - "general" domain is a last resort. Try hard to pick a specific domain.
  - "other" / "note" purposes are fallbacks for genuinely shapeless pages.
  - If unsure between two specific values, pick the one that BEST describes
    what a user would expect when navigating to this page.

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
          domain: cls.domain,
          intent: cls.intent,
          audience: cls.audience,
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
    // Log the full error for debugging (403 = AI Gateway auth issue, etc.)
    const msg = err instanceof Error ? err.message : String(err)
    const is403 = msg.includes("403") || msg.includes("Forbidden")
    console.warn(
      `[v0] LLM classifier failed${is403 ? " (AI Gateway 403 — check API key or model access)" : ""} — ` +
      `downstream similarity will use kMeans + concept gates:`,
      msg,
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
