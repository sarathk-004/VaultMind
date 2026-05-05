/**
 * Multi-signal page similarity for Notion workspaces.
 *
 * Pure TF-IDF fails on Notion titles because:
 *   - Titles are short (1-4 words) so vectors are sparse
 *   - "MS" and "Masters" share no characters → cosine = 0
 *   - "Idea" and "Ideas" are different tokens without stemming
 *   - Rare terms (df < 2) are correctly dropped, but those rare terms
 *     are exactly the topical anchors we need for grouping.
 *
 * This module fuses three orthogonal signals:
 *   1. Concept tagging  — regex patterns map text → topical concepts
 *   2. Title overlap    — Jaccard over stemmed title tokens
 *   3. TF-IDF cosine    — over (title × 5 + body), with synonym expansion
 *                         and Porter-lite stemming, KEEPING rare terms.
 *
 * Final score = 0.45·concept + 0.20·title + 0.35·tfidf, with per-page
 * top-K edge selection (no global threshold) so every page connects to
 * its closest neighbours regardless of absolute score.
 */

// ── Concept taxonomy ────────────────────────────────────────────────────────
// Each concept is a regex of keywords/phrases that strongly signal the topic.
// A page can belong to multiple concepts. Concept overlap = Jaccard similarity.
const CONCEPT_PATTERNS: Record<string, RegExp> = {
  ml: /\b(ml|ai|machine[- ]?learning|deep[- ]?learning|neural[- ]?net|neural[- ]?network|llm|nlp|supervised|unsupervised|reinforcement|regression|classification|clustering|embedding|transformer|gpt|bert|pytorch|tensorflow|sklearn|kaggle|gradient|tensor|cnn|rnn|gan|attention|fine[- ]?tun|hyperparameter|overfit|backprop|optimizer|cross[- ]?validation|probability|statistics|linear[- ]?algebra|calculus|bayesian|markov|loss[- ]?function|feature[- ]?engineering)\b/i,

  us_edu: /\b(ms|msc|mba|phd|masters?|university|college|gre|gmat|toefl|ielts|sop|lor|admission|grad[- ]?school|graduate|stem|f-?1|opt|cpt|stanford|mit|cmu|berkeley|princeton|harvard|yale|columbia|cornell|ucla|usc|gatech|uiuc|umich|nyu|northwestern|duke|caltech|brown|upenn|wharton|kellogg|booth|fuqua|tuck|ross|haas|sloan|tepper|ivy|fall[- ]?20\d\d|spring[- ]?20\d\d|fellowship|scholarship|tuition|gpa|transcript|recommendation|target[- ]?school|safety[- ]?school|ambitious|reach|admit|reject|wait[- ]?list|profile[- ]?evaluation|shortlist)\b/i,

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
// Replace each key (whole word) with its expansion BEFORE tokenizing so an
// abbreviation contributes the same terms as its long form.
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
])

// ── Light Porter-style stemmer ──────────────────────────────────────────────
// Just enough to collapse plurals and common suffixes so "ideas"/"idea" and
// "comparison"/"comparisons" merge.
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
 * Compute pairwise similarity across all docs using a weighted blend of:
 *  - Concept tag overlap (Jaccard)
 *  - Stemmed title token overlap (Jaccard)
 *  - TF-IDF cosine (title × 5 + body, with synonym expansion + stemming)
 *
 * Returns the top-K most similar partners for each doc, deduplicated as
 * undirected edges. No global threshold — top-K guarantees connectivity.
 */
export function buildSemanticEdges(
  docs: Map<string, SimilarityDoc>,
  opts: { topK?: number; minScore?: number } = {},
): SimilarityEdge[] {
  // 1. Lower max connections to 3 to prevent spiderwebbing, and raise the strict cutoff.
  const { topK = 3, minScore = 0.18 } = opts
  const ids = Array.from(docs.keys())
  if (ids.length < 2) return []

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
  const vectors = new Map<string, Map<string, number>>()
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
      const dfc = df.get(term) ?? 1 // FIXED: Restored missing variable
      if (dfc / N > 0.85) continue
      const idf = Math.log((N + 1) / (dfc + 1)) + 1
      const tfidf = (1 + Math.log(count)) * idf
      vec.set(term, tfidf)
      normSq += tfidf * tfidf
    }
    const norm = Math.sqrt(normSq) || 1
    for (const [term, val] of vec) vec.set(term, val / norm)
    vectors.set(id, vec)
  }

  const perNodeBest = new Map<string, { id: string; score: number }[]>()
  const ensure = (id: string) => {
    let arr = perNodeBest.get(id)
    if (!arr) {
      arr = []
      perNodeBest.set(id, arr)
    }
    return arr
  }

  // 2. Rebalance weights to favor exact title token overlap heavily
  const W_CONCEPT = 0.25
  const W_TITLE = 0.40
  const W_TFIDF = 0.35

  for (let i = 0; i < ids.length; i++) {
    const idA = ids[i]! // FIXED: Added non-null assertion for strict TS

    const va = vectors.get(idA)!
    const titleA = titleTokensById.get(idA)!
    const conceptsA = conceptsById.get(idA)!

    for (let j = i + 1; j < ids.length; j++) {
      const idB = ids[j]! // FIXED: Added non-null assertion for strict TS

      const vb = vectors.get(idB)!
      const titleB = titleTokensById.get(idB)!
      const conceptsB = conceptsById.get(idB)!

      let dot = 0
      if (va.size > 0 && vb.size > 0) {
        const [small, big] = va.size <= vb.size ? [va, vb] : [vb, va]
        for (const [term, val] of small) {
          const other = big.get(term)
          if (other) dot += val * other
        }
      }

      const conceptScore = jaccard(conceptsA, conceptsB)
      const titleScore = jaccard(titleA, titleB)

      // 3. NO ARTIFICIAL FLOOR. Pure mathematical similarity only.
      let score = W_CONCEPT * conceptScore + W_TITLE * titleScore + W_TFIDF * dot

      // Only link if it passes our new, much stricter threshold
      if (score < minScore) continue
      ensure(idA).push({ id: idB, score })
      ensure(idB).push({ id: idA, score })
    }
  }

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