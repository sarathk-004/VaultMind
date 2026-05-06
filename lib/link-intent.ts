/**
 * Link Intent Classifier — the central methodology fix.
 *
 * The lesson from production recommenders is that "semantic similarity" is
 * NOT the same question as "should these be linked". Two pages that share
 * vocabulary like "systems", "planning", or "tracking" can be vector-space
 * neighbors yet have nothing to do with each other from a user's perspective.
 *
 * This module replaces the naive "high score → link" heuristic with a binary
 * decision about navigational intent:
 *
 *   "Would a user MEANINGFULLY benefit from navigating between these pages?"
 *
 * NOT:
 *   "Are these similar?"     ← causes hallucinated relatedness
 *   "Do they share concepts?" ← creates false positives at scale
 *
 * For every candidate pair the LLM returns:
 *   - intent: "yes" | "weak_yes" | "no"
 *   - reason: one specific sentence explaining the navigational benefit.
 *             Generic phrases like "both discuss X" are post-validated and
 *             reject the pair regardless of the intent label — generic
 *             reasons are a strong tell that the model is hallucinating
 *             relatedness from shared vocabulary.
 *
 * Calls are batched (≤8 pairs per request) and cached by content hash. If
 * the LLM is unreachable / errors / times out, the function returns null
 * and the caller treats every candidate as "unverified" (the surrounding
 * pipeline still has its hard gates and tiered thresholds).
 */

import { z } from "zod"
import type { PageClassification } from "./page-classifier"
import { generateStructured, activeLlmProvider } from "./llm-client"

export type LinkIntentLabel = "yes" | "weak_yes" | "no"

export interface LinkIntentResult {
  intent: LinkIntentLabel
  reason: string
  /** True if the reason was rejected as a generic / hallucinated explanation. */
  rejectedReason?: boolean
}

export interface LinkIntentPair {
  key: string
  A: {
    id: string
    title: string
    body: string
    cls?: PageClassification
  }
  B: {
    id: string
    title: string
    body: string
    cls?: PageClassification
  }
}

const IntentItem = z.object({
  key: z.string(),
  intent: z.enum(["yes", "weak_yes", "no"]),
  reason: z.string(),
})

const BatchResponse = z.object({
  results: z.array(IntentItem),
})

const SYSTEM_PROMPT = `You decide whether two Notion pages should be linked together in a knowledge graph.

The right question is NOT "are these pages similar?" — most workspaces share generic vocabulary like "systems", "planning", "tracking", "optimization", or "workflows". The right question is:

  "Would a user MEANINGFULLY benefit from navigating between these two pages? Does linking them improve understanding, workflow, or context?"

Two pages that share generic words are NOT necessarily related. A "Health Plan" and a "HackerRank Orchestrator" both involve "tracking" and "systems", but a user navigating between them gains nothing — they belong to entirely different parts of life.

For each pair return one of three labels:

  yes        — pages clearly belong together. Examples:
                 • one is a roadmap, the other is the SOP that references it
                 • parts of the same project / application / decision
                 • one explains a concept the other applies
                 • prerequisite ↔ dependent
  weak_yes   — adjacent but not central. Examples:
                 • both ML pages but with different specific purposes
                 • same domain, weakly related sub-topics
  no         — coincidental shared vocabulary OR unrelated audiences /
               domains / life-areas. The default for cross-domain pairs.

For "reason", be SPECIFIC. State what each page is FOR and the concrete navigational benefit.

FORBIDDEN GENERIC PHRASES (these indicate you are hallucinating relatedness from shared vocabulary):
  • "both discuss / mention / cover / describe / involve X"
  • "they share concepts / themes / topics / ideas"
  • "(generally / broadly / loosely) related"
  • single abstract nouns: "systems", "planning", "optimization", "workflows"
  • "both are about technology / productivity / learning"

If the only thing you can say is generic, label it "no".

GOOD reason example:
  "The SOP references distributed ML training experience; the ML Systems Roadmap concretely outlines the techniques used in that experience."

BAD reason example:
  "Both discuss systems and planning."

Bias toward "no" when in doubt. False positives are far more harmful than missed connections in this graph.

Return JSON matching the schema. Include EVERY input pair (matched by key).`

const cache = new Map<string, LinkIntentResult>()

/**
 * Patterns that indicate a generic/hallucinated reason — when matched, the
 * pair is downgraded to "no" regardless of the model's label. These come
 * directly from the methodology's example BAD explanation set.
 */
const GENERIC_REASON_PATTERNS: RegExp[] = [
  /\bboth (discuss|mention|cover|describe|involve|talk about|reference|are about|focus on|deal with|relate to|touch on)\b/i,
  /\bthey (share|both have|both involve|both relate to|both discuss|both mention)\b/i,
  /\b(generally|broadly|loosely|abstractly|conceptually) (related|similar|connected)\b/i,
  /\bshare (concepts?|themes?|topics?|ideas?|vocabulary)\b/i,
  /\b(similar|related) (concepts?|themes?|topics?|ideas?)\b/i,
  /\bcommon (theme|topic|concept|idea)s?\b/i,
  /\b(systems?|planning|optimization|workflows?|tracking|metrics|productivity|learning|technology)\.?$/i,
  /\boverlap(ping)? (in|on|with)\b/i,
]

function isGenericReason(reason: string): boolean {
  if (!reason) return true
  const trimmed = reason.trim()
  if (trimmed.length < 25) return true // single phrases are almost always generic
  for (const re of GENERIC_REASON_PATTERNS) {
    if (re.test(trimmed)) return true
  }
  return false
}

/**
 * Classify the navigational intent for a batch of candidate pairs. Returns
 * null if the LLM is unreachable / errored / timed out.
 */
export async function classifyLinkIntents(
  pairs: LinkIntentPair[],
  opts: {
    signal?: AbortSignal
    budgetMs?: number
    batchSize?: number
  } = {},
): Promise<Map<string, LinkIntentResult> | null> {
  const { batchSize = 8, budgetMs = 60_000 } = opts
  if (pairs.length === 0) return new Map()

  const results = new Map<string, LinkIntentResult>()
  const todo: LinkIntentPair[] = []

  for (const p of pairs) {
    const key = pairCacheKey(p)
    const cached = cache.get(key)
    if (cached) {
      results.set(p.key, cached)
    } else {
      todo.push(p)
    }
  }

  if (todo.length === 0) {
    console.log(`[v0] Link intent: all ${pairs.length} pairs cache-hit`)
    return results
  }

  // Overall budget guard so a stuck call can't blow the route's time limit.
  const overallController = new AbortController()
  const budgetTimer = setTimeout(() => overallController.abort(), budgetMs)
  const signal = composeSignals(opts.signal, overallController.signal)

  console.log(
    `[v0] Link intent (${activeLlmProvider()}): classifying ${todo.length} pairs ` +
      `(${pairs.length - todo.length} cached) in ` +
      `${Math.ceil(todo.length / batchSize)} batches`,
  )

  let labelCounts = { yes: 0, weak_yes: 0, no: 0, generic: 0 }

  try {
    for (let i = 0; i < todo.length; i += batchSize) {
      const batch = todo.slice(i, i + batchSize)
      const userPrompt = batch
        .map((p, idx) => formatPairForPrompt(p, idx))
        .join("\n\n")

      const output = await generateStructured({
        schema: BatchResponse,
        system: SYSTEM_PROMPT,
        prompt: userPrompt,
        signal,
        label: `link-intent batch ${i / batchSize + 1}`,
      })

      // Index returned items by their input key so we can correlate.
      const byKey = new Map(output.results.map(r => [r.key, r]))
      for (const p of batch) {
        const r = byKey.get(p.key)
        if (!r) {
          // LLM dropped this pair — treat as "no" (conservative default).
          const stored: LinkIntentResult = {
            intent: "no",
            reason: "(no response)",
            rejectedReason: true,
          }
          cache.set(pairCacheKey(p), stored)
          results.set(p.key, stored)
          labelCounts.no++
          continue
        }

        const generic = isGenericReason(r.reason)
        if (generic) labelCounts.generic++
        const finalIntent: LinkIntentLabel =
          generic && r.intent !== "no" ? "no" : r.intent

        const stored: LinkIntentResult = {
          intent: finalIntent,
          reason: r.reason,
          rejectedReason: generic,
        }
        cache.set(pairCacheKey(p), stored)
        results.set(p.key, stored)
        labelCounts[finalIntent]++
      }
    }

    console.log(
      `[v0] Link intent: ${labelCounts.yes} yes, ${labelCounts.weak_yes} weak_yes, ` +
        `${labelCounts.no} no (${labelCounts.generic} downgraded to no for generic reasoning)`,
    )
    return results
  } catch (err) {
    console.warn(
      "[v0] Link intent classifier failed — pairs will be accepted only on hard signals:",
      err instanceof Error ? err.message : err,
    )
    return null
  } finally {
    clearTimeout(budgetTimer)
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatPairForPrompt(p: LinkIntentPair, idx: number): string {
  return [
    `[pair ${idx + 1}] key=${p.key}`,
    `A: "${p.A.title}"` +
      (p.A.cls
        ? ` (domain=${p.A.cls.domain}, primary=${p.A.cls.primary_category}, ` +
          `intent=${p.A.cls.intent}, purpose=${p.A.cls.purpose}, audience=${p.A.cls.audience})`
        : ""),
    `   ${truncate(p.A.body, 380)}`,
    `B: "${p.B.title}"` +
      (p.B.cls
        ? ` (domain=${p.B.cls.domain}, primary=${p.B.cls.primary_category}, ` +
          `intent=${p.B.cls.intent}, purpose=${p.B.cls.purpose}, audience=${p.B.cls.audience})`
        : ""),
    `   ${truncate(p.B.body, 380)}`,
  ].join("\n")
}

function truncate(s: string, n: number): string {
  if (!s) return ""
  return s.length <= n ? s : s.slice(0, n) + "…"
}

/**
 * Cache key based on (titleA + bodyA + titleB + bodyB) so identical pairs
 * never round-trip to the LLM. Pair direction is normalized so (A,B) and
 * (B,A) hit the same cache slot.
 */
function pairCacheKey(p: LinkIntentPair): string {
  const a = `${p.A.title}|${(p.A.body || "").slice(0, 600)}`
  const b = `${p.B.title}|${(p.B.body || "").slice(0, 600)}`
  const [first, second] = a < b ? [a, b] : [b, a]
  return djb2(`${first}~~${second}`)
}

function djb2(s: string): string {
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
