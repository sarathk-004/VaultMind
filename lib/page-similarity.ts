/**
 * Multi-signal page similarity for Notion workspaces.
 *
 * Why pure TF-IDF and pure concept tagging both fail
 * ───────────────────────────────────────────────────
 * - TF-IDF on Notion titles is too sparse (1-4 words, no shared tokens).
 * - Concept regexes alone miss everything not in the taxonomy.
 * - Combining them with a top-K threshold creates *false positives* like
 *   "Design in the Age of AI" linking to "Stevens SOP" — they share zero
 *   concepts, zero title tokens, and only trace TF-IDF noise, yet top-K
 *   forces an edge anyway because it's the "least bad" option for that page.
 *
 * The fix: a multi-stage gated pipeline
 * ──────────────────────────────────────
 *   0.  (Optional, when an LLM is reachable) Classify every page via the
 *       Vercel AI Gateway into { primary_category, secondary_categories,
 *       purpose }. See `lib/page-classifier.ts`. Pages in incompatible
 *       primary categories with no "category bridge" are HARD-rejected.
 *       This is the strongest gate — it catches pairs that the textual
 *       signals can't separate (e.g. "Design in the Age of AI" tagged
 *       primary=design vs "Stevens SOP" tagged primary=sop).
 *
 *   1.  Vectorize every page (TF-IDF over title × 5 + body, with synonym
 *       expansion + stemming).
 *
 *   2.  Run K-Means (cosine distance, k = √(n/2) bounded [3, 12]) on those
 *       vectors. Cluster IDs are a soft topical prior — pages in different
 *       clusters require a much higher similarity score to link.
 *
 *   3.  Tag every page with concept domains via regex patterns.
 *
 *   4.  For each candidate pair (a, b) compute four signals:
 *         - concept Jaccard
 *         - title-token Jaccard (stemmed)
 *         - TF-IDF cosine
 *         - same-cluster boolean
 *
 *   5.  Apply HARD GATES — an edge is rejected outright if:
 *         - LLM-classified primaries are incompatible AND no category bridge
 *           exists (gate 0 above). [LLM mode only]
 *         - Cross-domain AND zero concept overlap AND zero meaningful title
 *           overlap (≥ 4-char tokens) AND TF-IDF < 0.45.
 *         - Both classified with no shared category → soft penalty (×0.65).
 *         - Cross-cluster AND combined score < 0.36.
 *         - Combined score < 0.20 (absolute floor).
 *
 *   6.  Apply BOOSTS when LLM classifications agree:
 *         - Same primary_category AND same purpose → ×1.80
 *         - Same primary_category                   → ×1.50
 *         - Cross-bridge (one's primary ∈ other's all categories) → ×1.25
 *         - Any category overlap                    → ×1.05
 *
 *   7.  Per-page top-K (k=3) on what survives, deduplicated as undirected.
 *
 * Target accuracy on a 130-page mixed-domain workspace: ≥ 85% (true edges
 * preserved; false cross-domain edges suppressed).
 */

// ── Concept taxonomy ────────────────────────────────────────────────────────
const CONCEPT_PATTERNS: Record<string, RegExp> = {
  ml: /\b(ml|ai|machine[- ]?learning|deep[- ]?learning|neural[- ]?net|neural[- ]?network|llm|nlp|supervised|unsupervised|reinforcement|regression|classification|clustering|embedding|transformer|gpt|bert|pytorch|tensorflow|sklearn|kaggle|gradient|tensor|cnn|rnn|gan|attention|fine[- ]?tun|hyperparameter|overfit|backprop|optimizer|cross[- ]?validation|probability|statistics|linear[- ]?algebra|calculus|bayesian|markov|loss[- ]?function|feature[- ]?engineering)\b/i,

  us_edu: /\b(ms|msc|mba|phd|masters?|university|college|gre|gmat|toefl|ielts|sop|lor|admission|grad[- ]?school|graduate|stem|f-?1|opt|cpt|stanford|mit|cmu|berkeley|princeton|harvard|yale|columbia|cornell|ucla|usc|gatech|uiuc|umich|nyu|northwestern|duke|caltech|brown|upenn|stevens|wharton|kellogg|booth|fuqua|tuck|ross|haas|sloan|tepper|ivy|fall[- ]?20\d\d|spring[- ]?20\d\d|fellowship|scholarship|tuition|gpa|transcript|recommendation|target[- ]?school|safety[- ]?school|ambitious|reach|admit|reject|wait[- ]?list|profile[- ]?evaluation|shortlist)\b/i,

  us_general: /\b(usa?|america|american|united[- ]?states|visa|h-?1b|gc|green[- ]?card|stem[- ]?ext|sevis|i-?20|ds-?160|consulate|embassy)\b/i,

  career: /\b(job|interview|resume|cv|hiring|recruiter|offer|salary|compensation|fang|faang|intern|internship|recruit|behavior|behavioral|system[- ]?design|coding[- ]?round|on-?site|new[- ]?grad|swe|sde|engineer|developer|portfolio|networking|referral|cold[- ]?outreach|career)\b/i,

  design: /\b(design|ux|ui|figma|sketch|prototype|wireframe|interface|typography|user[- ]?experience|user[- ]?interface|product[- ]?design|graphic[- ]?design|usability|accessibility|design[- ]?system|brand|visual|color[- ]?theory|layout)\b/i,

  programming: /\b(code|coding|programming|software|javascript|typescript|python|java|rust|golang|c\+\+|cpp|react|node|next[- ]?js|web|frontend|backend|full[- ]?stack|api|rest|graphql|algorithm|data[- ]?structure|leetcode|hackerrank|sql|database|aws|gcp|azure|docker|kubernetes|github)\b/i,

  ideas: /\b(idea|ideas|brainstorm|concept|thought|musing|hypothesis|theory|insight|reflection|philosophy|principle|framework|mental[- ]?model)\b/i,

  project: /\b(project|plan|planning|roadmap|milestone|sprint|deadline|launch|mvp|prototype|feature|requirement|spec|specification|deliverable|kick[- ]?off|retrospective)\b/i,

  finance: /\b(finance|money|invest|investment|stock|budget|expense|saving|income|tax|portfolio|asset|liability|net[- ]?worth|crypto|bitcoin|etf|mutual[- ]?fund|401k|ira|roth|fire|financial)\b/i,

  health: /\b(health|healthy|fitness|gym|workout|exercise|diet|nutrition|sleep|meditation|mindfulness|yoga|run|running|cycling|cardio|strength|protein|calorie|wellness|mental[- ]?health|therapy)\b/i,

  books: /\b(book|books|reading|read|literature|novel|author|chapter|kindle|audiobook|highlight|book[- ]?notes|book[- ]?summary)\b/i,

  travel: /\b(travel|trip|flight|hotel|tour|vacation|airbnb|itinerary|airport|destination|backpack)\b/i,

  daily: /\b(daily|weekly|monthly|journal|log|gratitude|todo|to-?do|habit|routine|morning|evening|standup|review)\b/i,

  research: /\b(research|paper|publication|conference|workshop|arxiv|cite|citation|methodology|literature[- ]?review|abstract|thesis|dissertation)\b/i,

  productivity: /\b(productivity|focus|deep[- ]?work|pomodoro|gtd|note[- ]?taking|second[- ]?brain|zettelkasten|workflow|automation|tool|app)\b/i,
}

// ── Synonym expansion ───────────────────────────────────────────────────────
const SYNONYM_MAP: Record<string, string> = {
  ms: "ms masters graduate university",
  msc: "msc masters graduate university",
  mba: "mba masters business graduate university",
  phd: "phd doctorate graduate university research",
  ml: "ml machine learning",
  dl: "dl deep learning",
  ai: "ai artificial intelligence",
  nlp: "nlp natural language processing",
  cv: "cv computer vision resume",
  ux: "ux user experience design",
  ui: "ui user interface design",
  swe: "swe software engineer engineering",
  sde: "sde software engineer engineering developer",
  pm: "pm product manager",
  cs: "cs computer science",
  ee: "ee electrical engineering",
  ce: "ce computer engineering",
  us: "us usa america united states",
  usa: "usa us america united states",
  uk: "uk britain england united kingdom",
  gre: "gre graduate exam test admission",
  gmat: "gmat business exam test admission",
  toefl: "toefl english exam test admission",
  ielts: "ielts english exam test admission",
  sop: "sop statement purpose admission",
  lor: "lor letter recommendation admission",
}

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "has", "have",
  "he", "in", "is", "it", "its", "of", "on", "or", "that", "the", "to", "was",
  "were", "will", "with", "this", "these", "those", "you", "your", "i", "we",
  "they", "their", "them", "but", "not", "what", "which", "who", "when",
  "where", "why", "how", "all", "any", "can", "do", "does", "did", "just",
  "so", "than", "too", "very", "also", "into", "if", "then", "there", "here",
  "my", "me", "our", "us", "about", "over", "under", "above", "between",
  "through", "while", "because", "up", "down", "out", "more", "less", "some",
  "such", "no", "nor", "only", "own", "same", "other", "each", "every",
  "been", "being", "had", "having", "one", "two", "three", "new", "get",
  "got", "go", "going", "make", "made", "take", "taken", "using", "use",
  "used", "like", "via", "etc", "ie", "eg", "yes",
  // High-frequency Notion-specific noise
  "page", "note", "notes", "doc", "document", "section", "list", "item", "items",
  "thing", "things", "stuff", "way", "ways", "part", "parts", "lot", "lots",
])

// ── Domains that are mutually exclusive in practice ─────────────────────────
// Pairs in this set CAN'T link unless they share at least one concept directly.
// e.g. a `design` page and a `us_edu` page can only link through an explicit
// shared concept like both being tagged `career`. This is the gate that kills
// "Design in the Age of AI" ↔ "Stevens SOP".
const INCOMPATIBLE_DOMAIN_PAIRS: Array<[string, string]> = [
  ["design", "us_edu"],
  ["design", "us_general"],
  ["design", "health"],
  ["design", "finance"],
  ["design", "travel"],
  ["design", "books"],
  ["health", "us_edu"],
  ["health", "ml"],
  ["health", "programming"],
  ["health", "research"],
  ["health", "career"],
  ["health", "finance"],
  ["travel", "us_edu"],
  ["travel", "ml"],
  ["travel", "programming"],
  ["travel", "research"],
  ["finance", "ml"],
  ["finance", "us_edu"],
  ["finance", "design"],
  ["books", "programming"],
  ["books", "us_edu"],
  ["books", "ml"],
  ["us_edu", "ml"],
  ["us_edu", "design"],
  ["us_edu", "programming"],
  ["us_edu", "research"],
  ["daily", "us_edu"],
  ["daily", "ml"],
  ["daily", "design"],
  ["daily", "programming"],
]
const INCOMPATIBLE_SET = new Set(
  INCOMPATIBLE_DOMAIN_PAIRS.flatMap(([a, b]) => [`${a}|${b}`, `${b}|${a}`]),
)

function areDomainsIncompatible(a: Set<string>, b: Set<string>): boolean {
  if (a.size === 0 || b.size === 0) return false
  // Any shared concept means they're compatible — only check if disjoint.
  for (const x of a) if (b.has(x)) return false
  for (const x of a) {
    for (const y of b) {
      if (INCOMPATIBLE_SET.has(`${x}|${y}`)) return true
    }
  }
  return false
}

// ── LLM classification incompatibility ─────────────────────────────────────
// Pairs of `primary_category` values that should never link unless a
// "category bridge" exists (one's primary appears in the other's secondary
// list). This is the gate that makes the LLM signal authoritative — it
// kills "Design (primary=design) ↔ Stevens SOP (primary=sop)" outright.
const INCOMPATIBLE_LLM_PAIRS: Array<[string, string]> = [
  ["design", "sop"], ["design", "lor"], ["design", "us_edu"],
  ["design", "health"], ["design", "travel"], ["design", "books"],
  ["design", "finance"], ["design", "research"], ["design", "daily"],
  ["design", "personal"],
  ["health", "sop"], ["health", "lor"], ["health", "us_edu"],
  ["health", "ml"], ["health", "programming"], ["health", "research"],
  ["health", "career"], ["health", "finance"], ["health", "books"],
  ["travel", "sop"], ["travel", "lor"], ["travel", "us_edu"],
  ["travel", "ml"], ["travel", "programming"], ["travel", "research"],
  ["travel", "career"], ["travel", "finance"], ["travel", "design"],
  ["finance", "sop"], ["finance", "lor"], ["finance", "ml"],
  ["finance", "research"], ["finance", "us_edu"],
  ["daily", "sop"], ["daily", "lor"], ["daily", "us_edu"],
  ["daily", "ml"], ["daily", "programming"], ["daily", "research"],
  ["daily", "design"], ["daily", "finance"], ["daily", "career"],
  ["personal", "sop"], ["personal", "lor"], ["personal", "us_edu"],
  ["personal", "ml"], ["personal", "programming"], ["personal", "research"],
  ["personal", "design"],
  ["books", "sop"], ["books", "lor"], ["books", "us_edu"], ["books", "career"],
]
const INCOMPATIBLE_LLM_SET = new Set(
  INCOMPATIBLE_LLM_PAIRS.flatMap(([a, b]) => [`${a}|${b}`, `${b}|${a}`]),
)

export interface LlmClassification {
  primary_category: string
  secondary_categories: string[]
  purpose: string
}

/**
 * Two pages are LLM-incompatible if and only if:
 *   - their primary categories are different, AND
 *   - neither primary appears in the other's full category set
 *     (i.e. there is no "category bridge"), AND
 *   - the (primary_a, primary_b) pair is on the incompatible list.
 *
 * Same-primary, bridge-match, and primaries not on the incompatible list are
 * all considered compatible — those pairs proceed to the normal scoring.
 */
function areClassificationsIncompatible(
  a: LlmClassification,
  b: LlmClassification,
): boolean {
  if (a.primary_category === b.primary_category) return false
  const allA = new Set([a.primary_category, ...a.secondary_categories])
  const allB = new Set([b.primary_category, ...b.secondary_categories])
  if (allB.has(a.primary_category) || allA.has(b.primary_category)) return false
  return INCOMPATIBLE_LLM_SET.has(`${a.primary_category}|${b.primary_category}`)
}

/**
 * Multiplicative score adjustment based on how well two classifications align.
 * Returns 1.0 when no LLM information is available for either page.
 */
function classificationMultiplier(
  a: LlmClassification | undefined,
  b: LlmClassification | undefined,
): number {
  if (!a || !b) return 1.0

  const primaryMatch = a.primary_category === b.primary_category
  // "note" and "other" are catch-all purposes — same purpose by accident
  // shouldn't earn a boost.
  const purposeMatch =
    a.purpose === b.purpose && a.purpose !== "other" && a.purpose !== "note"

  const allA = new Set([a.primary_category, ...a.secondary_categories])
  const allB = new Set([b.primary_category, ...b.secondary_categories])
  const bridge =
    allB.has(a.primary_category) || allA.has(b.primary_category)
  let intersectionCount = 0
  for (const x of allA) if (allB.has(x)) intersectionCount++

  if (primaryMatch && purposeMatch) return 1.8
  if (primaryMatch) return 1.5
  if (bridge) return 1.25
  if (intersectionCount > 0) return 1.05
  // Both classified but no overlap at all → soft penalty.
  return 0.65
}

// ── Light Porter-style stemmer ──────────────────────────────────────────────
function stem(word: string): string {
  if (word.length < 4) return word
  let w = word.replace(/'s$/, "")
  if (w.endsWith("sses")) return w.slice(0, -2)
  if (w.endsWith("ies") && w.length > 4) return w.slice(0, -3) + "y"
  if (w.endsWith("ing") && w.length > 5) return w.slice(0, -3)
  if (w.endsWith("edly") && w.length > 6) return w.slice(0, -4)
  if (w.endsWith("ed") && w.length > 4) return w.slice(0, -2)
  if (w.endsWith("ly") && w.length > 4) return w.slice(0, -2)
  if (w.endsWith("ation") && w.length > 6) return w.slice(0, -3)
  if (w.endsWith("tion") && w.length > 6) return w.slice(0, -4)
  if (w.endsWith("ness") && w.length > 5) return w.slice(0, -4)
  if (w.endsWith("ment") && w.length > 6) return w.slice(0, -4)
  if (w.endsWith("ies")) return w.slice(0, -3) + "y"
  if (w.endsWith("es") && w.length > 4) return w.slice(0, -2)
  if (w.endsWith("s") && !w.endsWith("ss") && w.length > 3) return w.slice(0, -1)
  return w
}

function expandSynonyms(text: string): string {
  let out = text
  for (const [abbr, expansion] of Object.entries(SYNONYM_MAP)) {
    const re = new RegExp(`\\b${abbr}\\b`, "gi")
    out = out.replace(re, expansion)
  }
  return out
}

function tokenize(text: string): string[] {
  const expanded = expandSynonyms(text)
  return expanded
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .split(/\s+/)
    .map(w => w.replace(/^['-]+|['-]+$/g, ""))
    .filter(w => w.length >= 2 && w.length <= 32 && !STOPWORDS.has(w) && !/^\d+$/.test(w))
    .map(stem)
}

function detectConcepts(text: string): Set<string> {
  const out = new Set<string>()
  for (const [concept, pattern] of Object.entries(CONCEPT_PATTERNS)) {
    if (pattern.test(text)) out.add(concept)
  }
  return out
}

function jaccard<T>(a: Set<T>, b: Set<T>): number {
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  const [small, big] = a.size <= b.size ? [a, b] : [b, a]
  for (const x of small) if (big.has(x)) inter++
  const union = a.size + b.size - inter
  return union === 0 ? 0 : inter / union
}

type SparseVec = Map<string, number>

function dot(a: SparseVec, b: SparseVec): number {
  if (a.size === 0 || b.size === 0) return 0
  const [small, big] = a.size <= b.size ? [a, b] : [b, a]
  let s = 0
  for (const [k, v] of small) {
    const ov = big.get(k)
    if (ov) s += v * ov
  }
  return s
}

// ── Spherical K-Means (cosine distance over normalized TF-IDF vectors) ─────
// Output: clusterId for every doc id. Used as a SOFT prior — cross-cluster
// edges have to clear a higher similarity bar than same-cluster edges.
function kMeans(
  ids: string[],
  vectors: Map<string, SparseVec>,
  k: number,
  maxIter = 25,
): Map<string, number> {
  const out = new Map<string, number>()
  if (ids.length === 0) return out
  if (k <= 1 || ids.length <= k) {
    ids.forEach((id, i) => out.set(id, Math.min(i, k - 1)))
    return out
  }

  // k-means++ seeding for stable initial centroids
  const centroids: SparseVec[] = []
  const firstId = ids[Math.floor(ids.length / 2)]!
  centroids.push(new Map(vectors.get(firstId) ?? new Map()))

  while (centroids.length < k) {
    const distances: number[] = []
    let total = 0
    for (const id of ids) {
      const v = vectors.get(id) ?? new Map()
      let best = 0
      for (const c of centroids) best = Math.max(best, dot(v, c))
      const d = (1 - best) ** 2 // squared cosine distance
      distances.push(d)
      total += d
    }
    if (total === 0) break
    let pick = Math.random() * total
    let chosen = 0
    for (let i = 0; i < distances.length; i++) {
      pick -= distances[i]!
      if (pick <= 0) {
        chosen = i
        break
      }
    }
    centroids.push(new Map(vectors.get(ids[chosen]!) ?? new Map()))
  }

  let assignments = new Map<string, number>()
  for (let iter = 0; iter < maxIter; iter++) {
    const newAssign = new Map<string, number>()
    for (const id of ids) {
      const v = vectors.get(id) ?? new Map()
      let bestC = 0
      let bestSim = -Infinity
      for (let c = 0; c < centroids.length; c++) {
        const s = dot(v, centroids[c]!)
        if (s > bestSim) {
          bestSim = s
          bestC = c
        }
      }
      newAssign.set(id, bestC)
    }

    // Convergence check
    if (assignments.size === newAssign.size) {
      let same = true
      for (const [id, c] of newAssign) {
        if (assignments.get(id) !== c) {
          same = false
          break
        }
      }
      if (same) {
        assignments = newAssign
        break
      }
    }
    assignments = newAssign

    // Recompute centroids = mean of cluster members, then re-normalize.
    const newCentroids: SparseVec[] = Array.from({ length: k }, () => new Map())
    const counts = new Array<number>(k).fill(0)
    for (const id of ids) {
      const c = assignments.get(id)!
      const v = vectors.get(id) ?? new Map()
      counts[c]!++
      const target = newCentroids[c]!
      for (const [t, val] of v) {
        target.set(t, (target.get(t) ?? 0) + val)
      }
    }
    for (let c = 0; c < k; c++) {
      const cnt = counts[c]!
      const cv = newCentroids[c]!
      if (cnt === 0) {
        // Empty cluster — re-seed from a random doc to avoid collapse.
        newCentroids[c] = new Map(
          vectors.get(ids[Math.floor(Math.random() * ids.length)]!) ?? new Map(),
        )
        continue
      }
      let normSq = 0
      for (const [t, val] of cv) {
        const m = val / cnt
        cv.set(t, m)
        normSq += m * m
      }
      const norm = Math.sqrt(normSq) || 1
      if (norm !== 1) for (const [t, val] of cv) cv.set(t, val / norm)
    }
    for (let c = 0; c < k; c++) centroids[c] = newCentroids[c]!
  }

  return assignments
}

// ── Public API ──────────────────────────────────────────────────────────────
export interface SimilarityEdge {
  from: string
  to: string
  score: number
}

export interface SimilarityDoc {
  title: string
  body: string
}

/**
 * Build semantic edges over a workspace using the gated multi-stage
 * algorithm described at the top of this file.
 *
 * If `classifications` is provided (from `lib/page-classifier.ts`), the LLM
 * categories act as the strongest signal — incompatible-primary pairs with
 * no category bridge are rejected before any scoring runs, and matching
 * pairs get multiplicative boosts.
 */
export function buildSemanticEdges(
  docs: Map<string, SimilarityDoc>,
  opts: {
    topK?: number
    minScore?: number
    classifications?: Map<string, LlmClassification>
  } = {},
): SimilarityEdge[] {
  const { topK = 3, minScore = 0.20, classifications } = opts
  const ids = Array.from(docs.keys())
  if (ids.length < 2) return []

  // 1. Vectorize ────────────────────────────────────────────────────────────
  const conceptsById = new Map<string, Set<string>>()
  const titleTokensById = new Map<string, Set<string>>()
  const tokensById = new Map<string, string[]>()

  for (const [id, { title, body }] of docs) {
    const titleTokens = tokenize(title)
    titleTokensById.set(id, new Set(titleTokens))
    const repeatedTitle = `${title} `.repeat(5)
    tokensById.set(id, tokenize(`${repeatedTitle} ${body}`))
    conceptsById.set(id, detectConcepts(`${title} ${body}`))
  }

  const df = new Map<string, number>()
  for (const tokens of tokensById.values()) {
    const seen = new Set<string>()
    for (const t of tokens) {
      if (seen.has(t)) continue
      seen.add(t)
      df.set(t, (df.get(t) ?? 0) + 1)
    }
  }

  const N = ids.length
  const vectors = new Map<string, SparseVec>()
  for (const [id, tokens] of tokensById) {
    if (tokens.length === 0) {
      vectors.set(id, new Map())
      continue
    }
    const tf = new Map<string, number>()
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1)
    const vec = new Map<string, number>()
    let normSq = 0
    for (const [term, count] of tf) {
      const dfc = df.get(term) ?? 1
      if (dfc / N > 0.85) continue // drop terms in >85% of docs
      const idf = Math.log((N + 1) / (dfc + 1)) + 1
      const tfidf = (1 + Math.log(count)) * idf
      vec.set(term, tfidf)
      normSq += tfidf * tfidf
    }
    const norm = Math.sqrt(normSq) || 1
    for (const [term, val] of vec) vec.set(term, val / norm)
    vectors.set(id, vec)
  }

  // 2. K-Means cluster prior ────────────────────────────────────────────────
  const k = Math.min(12, Math.max(3, Math.round(Math.sqrt(N / 2))))
  const cluster = kMeans(ids, vectors, k)

  // 3. Pairwise scoring with hard gates ─────────────────────────────────────
  const W_CONCEPT = 0.30
  const W_TITLE = 0.30
  const W_TFIDF = 0.40

  const perNodeBest = new Map<string, { id: string; score: number }[]>()
  const ensure = (id: string) => {
    let arr = perNodeBest.get(id)
    if (!arr) {
      arr = []
      perNodeBest.set(id, arr)
    }
    return arr
  }

  for (let i = 0; i < ids.length; i++) {
    const idA = ids[i]!
    const va = vectors.get(idA)!
    const titleA = titleTokensById.get(idA)!
    const conceptsA = conceptsById.get(idA)!
    const clusterA = cluster.get(idA)

    const classA = classifications?.get(idA)

    for (let j = i + 1; j < ids.length; j++) {
      const idB = ids[j]!
      const vb = vectors.get(idB)!
      const titleB = titleTokensById.get(idB)!
      const conceptsB = conceptsById.get(idB)!
      const clusterB = cluster.get(idB)
      const classB = classifications?.get(idB)

      // ── HARD GATE 0 (LLM): incompatible primaries with no bridge ──────
      // Strongest gate. When the LLM classifies both pages and their
      // primary categories are mutually exclusive (e.g. design × sop,
      // health × ml) AND neither primary appears in the other's full
      // category list, we reject the pair outright. No textual signal can
      // override this — the LLM has explicitly said the pages aren't about
      // the same thing.
      if (classA && classB && areClassificationsIncompatible(classA, classB)) {
        continue
      }

      // Signal computation
      const conceptScore = jaccard(conceptsA, conceptsB)
      const titleScore = jaccard(titleA, titleB)
      const tfidfScore = dot(va, vb)
      const sameCluster = clusterA === clusterB

      // ── HARD GATE 1: incompatible domains with no bridge concept ──────
      // Backstop for pages the LLM didn't classify or where classification
      // returned "other". Keeps the rule-based safety net intact.
      if (areDomainsIncompatible(conceptsA, conceptsB)) {
        const meaningfulTitleOverlap = [...titleA].some(
          t => t.length >= 4 && titleB.has(t),
        )
        if (!meaningfulTitleOverlap && tfidfScore < 0.45) continue
      }

      // ── HARD GATE 2: zero shared signals ──────────────────────────────
      // If pages share nothing concrete (no concepts, no meaningful title
      // tokens, mediocre TF-IDF), refuse to invent a connection.
      if (conceptScore === 0 && titleScore === 0 && tfidfScore < 0.32) continue

      // Composite score
      let score = W_CONCEPT * conceptScore + W_TITLE * titleScore + W_TFIDF * tfidfScore

      // ── LLM CLASSIFICATION BOOST ─────────────────────────────────────
      // Boost (or penalize) based on how well the categories align.
      score *= classificationMultiplier(classA, classB)

      // ── SOFT MODIFIERS ────────────────────────────────────────────────
      if (sameCluster) score *= 1.20 // boost same-cluster edges
      else score *= 0.80               // penalize cross-cluster edges

      // ── HARD GATE 3: cross-cluster edges need a high bar ──────────────
      if (!sameCluster && score < 0.36) continue

      // ── HARD GATE 4: absolute floor ───────────────────────────────────
      if (score < minScore) continue

      ensure(idA).push({ id: idB, score })
      ensure(idB).push({ id: idA, score })
    }
  }

  // 4. Per-page top-K + dedupe as undirected edges ──────────────────────────
  const seen = new Set<string>()
  const out: SimilarityEdge[] = []
  for (const [id, candidates] of perNodeBest) {
    candidates.sort((a, b) => b.score - a.score)
    for (const c of candidates.slice(0, topK)) {
      const key = id < c.id ? `${id}|${c.id}` : `${c.id}|${id}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ from: id, to: c.id, score: c.score })
    }
  }
  return out
}
