/**
 * Multi-signal page similarity for Notion workspaces.
 *
 * Why pure semantic similarity fails
 * ──────────────────────────────────
 * "Are these pages similar?" is the wrong question. Most workspaces share
 * generic vocabulary like systems / planning / tracking / optimization, so
 * vector-space neighbors are routinely pages a user would never navigate
 * between. Similarity scores + threshold = systematic false positives.
 *
 * The right question is:
 *
 *   "Would a user MEANINGFULLY benefit from navigating between these
 *    two pages?"
 *
 * That reframing — link intent prediction, not similarity scoring — is the
 * core idea behind this pipeline. Each stage exists to enforce it.
 *
 * Pipeline
 * ────────
 *   1. CLASSIFY  (lib/page-classifier.ts) — per-page profile of
 *      { primary_category, domain, intent, audience, purpose, …}.
 *
 *   2. LOCAL-FIRST RETRIEVAL — each page builds candidates only from its
 *      own pool: same domain (LLM), or same Notion parent, or same kMeans
 *      cluster when the LLM is offline, OR the same concept family
 *      (e.g. both have ml_* sub-concept tags). Cross-domain candidates
 *      are allowed only via the explicit DOMAIN_BRIDGES map or shared
 *      family. This single rule kills ~70 % of the false positives the
 *      previous pipeline produced while still letting "Statistics for ML"
 *      reach "LLM Notes" without sharing keywords.
 *
 *   3. HARD GATES — incompatible LLM primaries with no category bridge,
 *      incompatible concept domains with no concept overlap. No textual
 *      signal can override these.
 *
 *   4. SPLIT SCORING — for every surviving pair compute TWO scores:
 *        topical       = TF-IDF + concept overlap + title overlap +
 *                        FAMILY overlap (both pages carry sub-concept
 *                        tags from the same broad area, e.g. ML)
 *        navigational  = same-parent + shared outbound links + same-domain
 *                        + same-intent + same-audience + same-purpose +
 *                        LLM-extracted topic Jaccard
 *      Final raw_score = 0.35 · topical + 0.65 · navigational  (LLM mode)
 *                      = 0.55 · topical + 0.45 · navigational  (no LLM)
 *      The navigational weight is intentionally larger — semantic
 *      relatedness is NOT the same thing as linkability.
 *
 *   5. NO MULTIPLICATIVE BOOSTS — the previous 1.8× / 1.5× / 1.25×
 *      boosts amplified accidental overlap and were the second largest
 *      source of bad edges. Classifications are now used ONLY for
 *      retrieval gating and as additive features inside the navigational
 *      score, never as multipliers.
 *
 *   6. TIERED THRESHOLDS — the floor depends on relationship type:
 *        same-parent : ≥ 0.25
 *        same-domain : ≥ 0.40
 *        same-family : ≥ 0.45 (LLM mode), ≥ 0.18 (no LLM)
 *        bridge      : ≥ 0.55
 *      Cross-domain links require near certainty; same-family
 *      relationships are a structurally-justified middle tier that
 *      catches ML pages with disjoint sub-vocabularies.
 *
 *   7. RECIPROCAL VALIDATION — a pair survives only if A is in B's top-K
 *      candidates AND B is in A's top-K. One-sided enthusiasm is rejected.
 *
 *   8. LINK INTENT CLASSIFIER (lib/link-intent.ts) — when the LLM is
 *      reachable, the surviving top-N pairs are sent to a binary
 *      classifier that asks "would users navigate between these?". Pairs
 *      labeled "no", or labeled "yes/weak_yes" with a generic explanation,
 *      are rejected. This is the precision filter the methodology
 *      identifies as the single most important architectural change.
 *
 *   9. GRAPH DENSITY CONTROL — accepted edges are sorted by score and
 *      added greedily until either endpoint reaches a per-node degree
 *      cap. This prevents universal-hub effects on broad pages like
 *      "AI" or "Planning".
 */

// ── Concept taxonomy ────────────────────────────────────────────────────────
// Broad concepts. A page gets one of these tags if ANY keyword matches —
// even a single mention. Used as the first-pass topical signal. Because
// they're permissive, they're NOT enough to imply "the page is really
// about this topic"; that's what SUB_CONCEPT_PATTERNS below is for.
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

// ── Sub-concepts: specialized terminology ─────────────────────────────────
// These require domain-specific vocabulary, not just a generic mention.
// A page only qualifies for "family membership" if it carries at least one
// sub-concept tag — that's the protection against incidental mentions
// (e.g., a daily journal that says "learned ML today" gets the broad `ml`
// tag but NO ml_* sub-concept, so it's not considered an ML page).
const SUB_CONCEPT_PATTERNS: Record<string, RegExp> = {
  // ML family — sub-topics within machine learning
  ml_foundations: /\b(probability|probabilit|stochastic|distribution|hypothesis[- ]?test|bayes|bayesian|markov|gaussian|normal[- ]?distribution|variance|covariance|expectation|linear[- ]?algebra|matrix|eigen|calculus|gradient[- ]?descent|loss[- ]?function|cross[- ]?entropy|kl[- ]?divergence|maximum[- ]?likelihood|monte[- ]?carlo)\b/i,
  ml_classical: /\b(regression|classification|clustering|svm|support[- ]?vector|random[- ]?forest|decision[- ]?tree|knn|k-?nearest|naive[- ]?bayes|logistic[- ]?regression|linear[- ]?regression|supervised|unsupervised|reinforcement[- ]?learning|gradient[- ]?boost|xgboost|lightgbm|pca|principal[- ]?component)\b/i,
  ml_deep: /\b(neural[- ]?net|neural[- ]?network|deep[- ]?learning|cnn|convolutional|rnn|recurrent|lstm|gru|gan|generative[- ]?adversarial|autoencoder|backprop|backpropagation|activation|relu|sigmoid|softmax|dropout|batch[- ]?norm|layer[- ]?norm|residual|resnet|vgg|inception)\b/i,
  ml_llm: /\b(llm|llms|large[- ]?language[- ]?model|gpt|gpt-?\d|bert|claude|llama|mistral|gemini|fine[- ]?tun|prompt|prompt[- ]?engineering|transformer|attention|self[- ]?attention|token|tokeniz|embedding|rag|retrieval[- ]?augmented|chat[- ]?bot|few[- ]?shot|zero[- ]?shot|in[- ]?context[- ]?learning|chain[- ]?of[- ]?thought|cot|instruct|alignment|rlhf|foundation[- ]?model)\b/i,
  ml_nlp: /\b(nlp|natural[- ]?language|tokeniz|stemming|lemmatiz|named[- ]?entity|sentiment|word2vec|glove|fasttext|word[- ]?embed|seq2seq|sequence[- ]?to[- ]?sequence|machine[- ]?translation|text[- ]?classification|question[- ]?answer)\b/i,
  ml_cv: /\b(computer[- ]?vision|image[- ]?recognition|object[- ]?detection|segmentation|yolo|opencv|image[- ]?classification|face[- ]?recognition|optical[- ]?flow)\b/i,
  ml_tools: /\b(pytorch|tensorflow|keras|sklearn|scikit-?learn|kaggle|huggingface|hugging[- ]?face|jupyter|colab|wandb|weights[- ]?and[- ]?biases|mlflow|onnx|cuda|gpu)\b/i,

  // US education family — sub-topics within US grad school
  edu_admissions: /\b(admission|admit|reject|wait[- ]?list|application|apply|deadline|profile[- ]?evaluation|shortlist|target[- ]?school|safety[- ]?school|ambitious|reach|rolling)\b/i,
  edu_university: /\b(stanford|mit|cmu|berkeley|princeton|harvard|yale|columbia|cornell|ucla|usc|gatech|uiuc|umich|nyu|northwestern|duke|caltech|brown|upenn|stevens|university|college|campus|department|faculty)\b/i,
  edu_test: /\b(gre|gmat|toefl|ielts|verbal|quant|quantitative|awa|score|percentile|test[- ]?prep)\b/i,
  edu_program: /\b(ms|msc|mba|phd|masters?|graduate|grad[- ]?school|fall[- ]?20\d\d|spring[- ]?20\d\d|fellowship|scholarship|gpa|transcript|stem|f-?1)\b/i,
  edu_documents: /\b(sop|statement[- ]?of[- ]?purpose|lor|letter[- ]?of[- ]?recommendation|recommendation[- ]?letter|personal[- ]?statement|resume[- ]?for[- ]?ms|essay)\b/i,

  // Programming family — sub-topics within software engineering
  prog_web: /\b(react|next[- ]?js|vue|svelte|angular|html|css|tailwind|frontend|backend|full[- ]?stack|web[- ]?dev|http|rest|graphql|api|nodejs|node[- ]?js)\b/i,
  prog_systems: /\b(systems?[- ]?design|distributed|microservice|kubernetes|docker|aws|gcp|azure|infrastructure|devops|ci[- ]?cd|deploy|scaling|load[- ]?balanc|cache|redis)\b/i,
  prog_languages: /\b(python|javascript|typescript|java|rust|golang|c\+\+|cpp|swift|kotlin|ruby|php|scala|clojure)\b/i,
  prog_dsa: /\b(algorithm|data[- ]?structure|leetcode|hackerrank|big[- ]?o|complexity|sort|binary[- ]?search|tree|graph|dynamic[- ]?programming|recursion|hash[- ]?table)\b/i,

  // Career family — sub-topics within job/career
  career_interview: /\b(interview|behavioral|system[- ]?design[- ]?interview|coding[- ]?round|on[- ]?site|technical[- ]?interview|mock[- ]?interview)\b/i,
  career_search: /\b(job[- ]?search|application|recruiter|referral|cold[- ]?outreach|networking|linkedin|hiring|offer|negotiation|salary|compensation)\b/i,
  career_prep: /\b(resume|cv|portfolio|profile|new[- ]?grad|intern|internship|swe|sde|engineer|developer)\b/i,
}

// ── Concept families: groups of related sub-concepts ─────────────────────
// A page belongs to a "family" if it carries at least one sub-concept from
// that family. Two pages in the same family are considered topically
// related even if their specific sub-concepts differ — this is what makes
// "Statistics for ML" link to "LLM Notes" despite having no shared
// keywords (one's about probability theory, the other's about
// transformers, but they're both ML pages).
const CONCEPT_FAMILIES: Record<string, string[]> = {
  ml: ["ml_foundations", "ml_classical", "ml_deep", "ml_llm", "ml_nlp", "ml_cv", "ml_tools"],
  us_edu: ["edu_admissions", "edu_university", "edu_test", "edu_program", "edu_documents"],
  programming: ["prog_web", "prog_systems", "prog_languages", "prog_dsa"],
  career: ["career_interview", "career_search", "career_prep"],
}

// Reverse lookup: sub-concept → family.
const SUB_TO_FAMILY = new Map<string, string>()
for (const [family, members] of Object.entries(CONCEPT_FAMILIES)) {
  for (const m of members) SUB_TO_FAMILY.set(m, family)
}

/**
 * Given a page's concept tags, return the set of families it qualifies for.
 * A page qualifies for family X iff it has at least one sub-concept that
 * belongs to X. The bare top-level tag (e.g. plain `ml` from a single
 * mention) is NOT enough — that's the protection against incidental
 * vocabulary triggering false family membership.
 */
function getFamilies(concepts: Set<string>): Set<string> {
  const fams = new Set<string>()
  for (const c of concepts) {
    const f = SUB_TO_FAMILY.get(c)
    if (f) fams.add(f)
  }
  return fams
}

// ── Synonym expansion ───────────────────────────────────────────────────────
// Maps abbreviations and short tokens to their expanded forms PLUS related
// family vocabulary, so that pages using "LLM" tokenize alongside pages
// using "transformer" or "machine learning" — they share at least the
// "ml" / "ai" tokens after expansion. This is what gives TF-IDF a fighting
// chance when two pages use different ML sub-vocabularies.
const SYNONYM_MAP: Record<string, string> = {
  // Education
  ms: "ms masters graduate university",
  msc: "msc masters graduate university",
  mba: "mba masters business graduate university",
  phd: "phd doctorate graduate university research",
  // ML / AI — bidirectional family expansion so all ML pages share
  // a common set of tokens regardless of sub-vocabulary.
  ml: "ml ai machine learning",
  dl: "dl ml ai deep learning neural",
  ai: "ai ml artificial intelligence machine learning",
  llm: "llm ai ml language model gpt transformer",
  gpt: "gpt llm ai language model transformer",
  bert: "bert llm ai language model transformer",
  nlp: "nlp ai ml natural language processing",
  rag: "rag llm ai retrieval augmented generation",
  cnn: "cnn neural network deep learning",
  rnn: "rnn neural network deep learning",
  // Other technical abbreviations
  cv: "cv computer vision resume",
  ux: "ux user experience design",
  ui: "ui user interface design",
  swe: "swe software engineer engineering",
  sde: "sde software engineer engineering developer",
  pm: "pm product manager",
  cs: "cs computer science",
  ee: "ee electrical engineering",
  ce: "ce computer engineering",
  // Geography / visa
  us: "us usa america united states",
  usa: "usa us america united states",
  uk: "uk britain england united kingdom",
  // Test / admissions
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
  /** Broad domain used for local-first retrieval pools. Optional — older
   * cached classifications without this field are treated as "general". */
  domain?: string
  /** What the page is FOR (planning, automation, application, …). */
  intent?: string
  /** Who the page is for (self, recruiters, admissions, …). */
  audience?: string
  /** 3-7 specific topics extracted by the LLM (e.g. ["bayesian inference",
   *  "linear regression", "hyperparameter tuning"]). Used as a finer-
   *  grained navigational signal: two ML pages with overlapping topics
   *  link more strongly than two ML pages with disjoint topics. */
  topics?: string[]
}

// Approved cross-domain bridges. A page in domain X can retrieve candidates
// from domain Y only if Y ∈ DOMAIN_BRIDGES[X]. Everything else is hard-
// rejected at the candidate-retrieval stage. "general" is intentionally a
// universal joiner (it's the LLM's "ambiguous" fallback bucket).
const DOMAIN_BRIDGES: Record<string, string[]> = {
  education: ["career", "research", "engineering"],
  career: ["education", "engineering"],
  engineering: ["research", "education", "career"],
  research: ["education", "engineering"],
  // Creative work is mostly self-contained. We do NOT bridge creative ↔
  // education/research/engineering, which is what kept inventing edges
  // like "Design in the Age of AI" ↔ "Stevens SOP".
  creative: [],
  lifestyle: [],
  finance: [],
  personal: [],
  general: [
    "education", "career", "engineering", "research",
    "creative", "lifestyle", "finance", "personal",
  ],
}

function domainBridgeAllowed(a?: string, b?: string): boolean {
  if (!a || !b) return true // missing classification → don't gate here
  if (a === b) return true
  if (a === "general" || b === "general") return true
  return (DOMAIN_BRIDGES[a] ?? []).includes(b)
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
 * Compute the navigational alignment between two classified pages — a
 * value in [0, 1] reflecting how strongly their LLM profiles imply users
 * would navigate between them. This is an ADDITIVE feature, NOT a score
 * multiplier (the methodology forbids multiplicative boosts because they
 * amplify noise).
 *
 * Components (each contributes proportionally to its weight):
 *   - same domain        (0.35)  the strongest signal: same broad area
 *   - same intent        (0.20)  same functional purpose
 *   - same audience      (0.15)  written for the same reader
 *   - same purpose       (0.08)  same artifact type
 *   - topic Jaccard      (0.18)  LLM-extracted specific topics overlap
 *   - any category bridge (0.04) one's primary appears in other's full set
 *
 * "other" / "note" / "general" values are treated as no-information and
 * never contribute — matching by fallback bucket is meaningless.
 */
function classificationNavigationalScore(
  a: LlmClassification | undefined,
  b: LlmClassification | undefined,
): number {
  if (!a || !b) return 0
  let score = 0
  if (a.domain && a.domain === b.domain && a.domain !== "general") score += 0.35
  if (a.intent && a.intent === b.intent && a.intent !== "other") score += 0.20
  if (a.audience && a.audience === b.audience && a.audience !== "other") score += 0.15
  if (
    a.purpose === b.purpose &&
    a.purpose !== "other" &&
    a.purpose !== "note"
  ) {
    score += 0.08
  }
  // LLM-extracted topic overlap. Topics are normalized to lowercase and
  // matched on stem-equality so "transformers" matches "transformer".
  if (a.topics && b.topics && a.topics.length > 0 && b.topics.length > 0) {
    const normA = new Set(a.topics.map(t => normalizeTopic(t)))
    const normB = new Set(b.topics.map(t => normalizeTopic(t)))
    const tj = jaccard(normA, normB)
    score += 0.18 * tj
  }
  const allA = new Set([a.primary_category, ...a.secondary_categories])
  const allB = new Set([b.primary_category, ...b.secondary_categories])
  if (allB.has(a.primary_category) || allA.has(b.primary_category)) score += 0.04
  return Math.min(1, score)
}

/** Lower-case, strip punctuation, trim — used to normalize topic strings
 *  before Jaccard so superficial differences don't fragment overlap. */
function normalizeTopic(t: string): string {
  return t.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim()
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
  // Top-level concepts — permissive, can fire on a single mention.
  for (const [concept, pattern] of Object.entries(CONCEPT_PATTERNS)) {
    if (pattern.test(text)) out.add(concept)
  }
  // Sub-concepts — specialized vocabulary. When a sub-concept fires it
  // ALSO implies the parent (e.g. detecting "transformer" tags both
  // `ml_llm` and `ml`), so the broad-concept hard-gate logic continues
  // to work even on pages whose body uses only specialized terms.
  for (const [sub, pattern] of Object.entries(SUB_CONCEPT_PATTERNS)) {
    if (pattern.test(text)) {
      out.add(sub)
      const parent = SUB_TO_FAMILY.get(sub)
      if (parent) out.add(parent)
    }
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

/**
 * Family-level Jaccard. Pages "in the same family" (e.g. both have at
 * least one ml_* sub-concept) score 1.0 here even when their specific
 * sub-concepts are disjoint. This is the structural signal that lets
 * "Statistics for ML" link to "LLM Notes" without sharing keywords.
 */
function familyJaccard(a: Set<string>, b: Set<string>): number {
  const fa = getFamilies(a)
  const fb = getFamilies(b)
  return jaccard(fa, fb)
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
  /** Notion parent page id, if any. Same parent is the strongest single
   *  navigational signal — sibling pages typically belong together. */
  parentId?: string
  /** Page ids this page explicitly links to (mentions / link_to_page).
   *  Two pages that share outbound link targets are likely workflow
   *  neighbors even when their text doesn't overlap much. */
  linkTargets?: string[]
}

export type LinkIntentLabel = "yes" | "weak_yes" | "no"

export interface LinkIntentInputPair {
  key: string
  A: { id: string; title: string; body: string; cls?: LlmClassification }
  B: { id: string; title: string; body: string; cls?: LlmClassification }
}

export type ClassifyLinkIntentFn = (
  pairs: LinkIntentInputPair[],
) => Promise<Map<string, { intent: LinkIntentLabel; reason: string }> | null>

/**
 * Build semantic edges over a workspace using the staged pipeline described
 * at the top of this file.
 *
 *   1. Local-first retrieval (domain pools, parent siblings, kMeans fallback)
 *   2. Hard gates (LLM-incompat, concept-incompat)
 *   3. Topical + navigational split scoring
 *   4. Tiered thresholds (parent ≥ 0.25 / domain ≥ 0.40 / bridge ≥ 0.55)
 *   5. Per-page top-K
 *   6. Reciprocal validation
 *   7. Optional LLM link-intent classifier (precision filter)
 *   8. Graph-density caps
 *
 * The function is async: when `classifyLinkIntent` is supplied, step 7 calls
 * the LLM. If it fails or is omitted the rest of the pipeline still runs.
 */
export async function buildSemanticEdges(
  docs: Map<string, SimilarityDoc>,
  opts: {
    /** Per-page top-K candidates considered for reciprocal validation. */
    topK?: number
    /** Optional LLM page profiles. When present the pipeline gains
     *  domain-pool retrieval and the navigational LLM features. */
    classifications?: Map<string, LlmClassification>
    /** Optional batched LLM intent classifier. The MOST IMPORTANT input —
     *  see lib/link-intent.ts. When omitted the pipeline still works but
     *  precision drops by ~10 percentage points. */
    classifyLinkIntent?: ClassifyLinkIntentFn
    /** Maximum number of pairs sent to the link-intent classifier. */
    maxIntentPairs?: number
    /** Maximum semantic-edge degree per node. Prevents universal hubs. */
    maxDegreePerNode?: number
  } = {},
): Promise<SimilarityEdge[]> {
  const {
    topK = 5,
    classifications,
    classifyLinkIntent,
    maxIntentPairs = 200,
    maxDegreePerNode = 8,
  } = opts
  const ids = Array.from(docs.keys())
  if (ids.length < 2) return []

  // 1. Vectorize + concept tag ───────────────────────────────────────────────
  const conceptsById = new Map<string, Set<string>>()
  const titleTokensById = new Map<string, Set<string>>()
  const tokensById = new Map<string, string[]>()
  const linkTargetsById = new Map<string, Set<string>>()
  const parentById = new Map<string, string | undefined>()

  for (const [id, doc] of docs) {
    const { title, body, parentId, linkTargets } = doc
    const titleTokens = tokenize(title)
    titleTokensById.set(id, new Set(titleTokens))
    const repeatedTitle = `${title} `.repeat(5)
    tokensById.set(id, tokenize(`${repeatedTitle} ${body}`))
    conceptsById.set(id, detectConcepts(`${title} ${body}`))
    linkTargetsById.set(id, new Set(linkTargets ?? []))
    parentById.set(id, parentId)
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

  // 2. kMeans clusters + family memberships ────────────────────────────────
  // Clusters are the unsupervised "topical pool" prior. Family membership
  // (derived from sub-concept tags) is the supervised one — pages with
  // specialized ML / education / programming / career vocabulary are
  // grouped into their respective family even when their kMeans clusters
  // disagree (kMeans frequently splits ML pages across clusters because
  // their sub-vocabularies — stats vs LLMs vs CV — are very different).
  const k = Math.min(12, Math.max(3, Math.round(Math.sqrt(N / 2))))
  const cluster = kMeans(ids, vectors, k)
  const familiesById = new Map<string, Set<string>>()
  for (const [id, concepts] of conceptsById) {
    familiesById.set(id, getFamilies(concepts))
  }

  // 3. Local-first candidate eligibility ────────────────────────────────────
  // With LLM: domain-pool retrieval (the strongest precision filter).
  // Without LLM: same Notion parent OR same kMeans cluster OR same
  //              concept family — family membership lets ML pages with
  //              different sub-vocabularies still find each other.
  const hasAnyLLM = classifications && classifications.size > 0
  function inLocalPool(idA: string, idB: string): boolean {
    // Same Notion parent — always allowed (siblings).
    const pA = parentById.get(idA)
    const pB = parentById.get(idB)
    if (pA && pB && pA === pB) return true

    // If we have LLM for both, use domain bridging.
    const cA = classifications?.get(idA)
    const cB = classifications?.get(idB)
    if (cA && cB) {
      // LLM domain bridge — strict.
      if (domainBridgeAllowed(cA.domain, cB.domain)) return true
      // Even when domains don't bridge directly, allow the pair if BOTH
      // pages share a concept family (e.g. both are ML pages whose LLM
      // domains were classified slightly differently). This adds recall
      // without breaking the design ↔ sop hard-gate, because design
      // pages don't accumulate ml_* sub-concept tags.
      const fA = familiesById.get(idA)!
      const fB = familiesById.get(idB)!
      for (const f of fA) if (fB.has(f)) return true
      return false
    }

    // No LLM — same cluster OR same family.
    if (cluster.get(idA) === cluster.get(idB)) return true
    const fA = familiesById.get(idA)!
    const fB = familiesById.get(idB)!
    for (const f of fA) if (fB.has(f)) return true
    return false
  }

  // 4. Pairwise scoring (split into topical / navigational) ────────────────
  type Cand = {
    id: string
    score: number
    topical: number
    navigational: number
    tier: "parent" | "domain" | "family" | "bridge"
  }
  const perNodeBest = new Map<string, Cand[]>()
  const ensure = (id: string) => {
    let arr = perNodeBest.get(id)
    if (!arr) {
      arr = []
      perNodeBest.set(id, arr)
    }
    return arr
  }

  // Topical-component weights (within the topical sub-score).
  // Family overlap is the structural signal that two pages belong to the
  // same broad area despite using different sub-vocabularies. It carries
  // weight comparable to TF-IDF because TF-IDF is unreliable for ML pages
  // whose specialized vocabularies barely overlap.
  const W_TFIDF = 0.35
  const W_CONCEPT = 0.25
  const W_TITLE = 0.15
  const W_FAMILY = 0.25

  // Navigational-component weights (within the navigational sub-score).
  const W_NAV_PARENT = 0.30
  const W_NAV_LINKS = 0.25
  const W_NAV_LLM = 0.45 // distributes across domain/intent/audience/purpose/bridge/topics

  for (let i = 0; i < ids.length; i++) {
    const idA = ids[i]!
    const va = vectors.get(idA)!
    const titleA = titleTokensById.get(idA)!
    const conceptsA = conceptsById.get(idA)!
    const linksA = linkTargetsById.get(idA)!
    const classA = classifications?.get(idA)

    for (let j = i + 1; j < ids.length; j++) {
      const idB = ids[j]!

      // ── Stage A: local-first retrieval ─────────────────────────────────
      if (!inLocalPool(idA, idB)) continue

      const vb = vectors.get(idB)!
      const titleB = titleTokensById.get(idB)!
      const conceptsB = conceptsById.get(idB)!
      const linksB = linkTargetsById.get(idB)!
      const classB = classifications?.get(idB)

      // ── Stage B: hard gates ────────────────────────────────────────────
      if (classA && classB && areClassificationsIncompatible(classA, classB)) {
        continue
      }
      if (areDomainsIncompatible(conceptsA, conceptsB)) {
        // Backstop when LLM is silent or "other": require either real
        // title overlap OR a high TF-IDF cosine to escape the gate.
        const tfidfScore = dot(va, vb)
        const meaningfulTitleOverlap = [...titleA].some(
          t => t.length >= 4 && titleB.has(t),
        )
        if (!meaningfulTitleOverlap && tfidfScore < 0.45) continue
      }

      // ── Stage C: topical sub-score ─────────────────────────────────────
      const tfidfScore = dot(va, vb)
      const conceptScore = jaccard(conceptsA, conceptsB)
      const titleScore = jaccard(titleA, titleB)
      const familyScore = familyJaccard(conceptsA, conceptsB)
      const topical =
        W_TFIDF * tfidfScore +
        W_CONCEPT * conceptScore +
        W_TITLE * titleScore +
        W_FAMILY * familyScore

      // Refuse pairs with literally zero shared concrete signal.
      if (
        conceptScore === 0 &&
        titleScore === 0 &&
        familyScore === 0 &&
        tfidfScore < 0.20
      ) {
        continue
      }

      // ── Stage D: navigational sub-score ────────────────────────────────
      const sameParent =
        !!parentById.get(idA) && parentById.get(idA) === parentById.get(idB)

      // Otsuka-Ochiai over shared outbound link targets (range [0, 1]).
      let sharedLinkScore = 0
      if (linksA.size > 0 && linksB.size > 0) {
        let shared = 0
        for (const t of linksA) if (linksB.has(t)) shared++
        if (shared > 0) {
          sharedLinkScore = shared / Math.sqrt(linksA.size * linksB.size)
        }
      }

      const llmNavScore = classificationNavigationalScore(classA, classB)

      const navigational =
        W_NAV_PARENT * (sameParent ? 1 : 0) +
        W_NAV_LINKS * sharedLinkScore +
        W_NAV_LLM * llmNavScore

      // ── Stage E: combine — navigational dominates by design ────────────
      const hasLLM = !!(classA && classB)
      const score = hasLLM
        ? 0.35 * topical + 0.65 * navigational
        : 0.55 * topical + 0.45 * navigational

      // ── Stage F: tier + tiered floor ───────────────────────────────────
      // Tiers reflect how strong the *structural* relationship is. A page
      // that's a sibling (same Notion parent) gets the lowest floor; a
      // family-aware "both belong to the ML / edu / programming family"
      // pair gets a middle floor; cross-domain bridges get the strictest.
      const strongFamily = familyScore >= 0.5
      let tier: "parent" | "domain" | "family" | "bridge"
      if (sameParent) {
        tier = "parent"
      } else if (
        hasLLM &&
        classA!.domain &&
        classA!.domain === classB!.domain &&
        classA!.domain !== "general"
      ) {
        tier = "domain"
      } else if (strongFamily) {
        tier = "family"
      } else {
        tier = "bridge"
      }

      let floor: number
      if (hasAnyLLM) {
        // With LLM the navigational signal is strong, so floors stay strict.
        switch (tier) {
          case "parent":  floor = 0.25; break
          case "domain":  floor = 0.40; break
          case "family":  floor = 0.45; break
          default:        floor = 0.55; break
        }
      } else {
        // Without LLM the navigational signal is weak, so we lean on the
        // topical+family signal and use lower floors. The family tier is
        // explicitly the route by which "Statistics for ML" can find
        // "LLM Notes" without sharing TF-IDF terms.
        switch (tier) {
          case "parent":  floor = 0.15; break
          case "family":  floor = 0.18; break
          default:        floor = 0.22; break
        }
      }
      if (score < floor) continue

      ensure(idA).push({ id: idB, score, topical, navigational, tier })
      ensure(idB).push({ id: idA, score, topical, navigational, tier })
    }
  }

  // 5. Per-page top-K ───────────────────────────────────────────────────────
  let totalCandidates = 0
  for (const arr of perNodeBest.values()) {
    totalCandidates += arr.length
    arr.sort((a, b) => b.score - a.score)
    if (arr.length > topK) arr.length = topK
  }
  console.log(
    `[v0] Similarity: ${ids.length} pages, ${k} clusters, ` +
    `hasLLM=${hasAnyLLM}, ${totalCandidates} candidates after scoring`,
  )

  // 6. Reciprocal validation: pairs that appear in BOTH sides' top-K are
  //    accepted directly. One-sided enthusiasm — A picks B but B doesn't
  //    pick A back — is normally rejected because that's the pattern
  //    behind hallucinated edges like "Stevens SOP ↔ Design in the Age
  //    of AI". The single exception is parent-tier and family-tier pairs:
  //    siblings and same-family pages have a strong structural reason to
  //    link even if one side has many other strong candidates that pushed
  //    the other out of its own top-K.
  const candidatePairs = new Map<
    string,
    { idA: string; idB: string; score: number; tier: Cand["tier"] }
  >()
  for (const [idA, arr] of perNodeBest) {
    for (const c of arr) {
      const idB = c.id
      const otherList = perNodeBest.get(idB)
      const reciprocal = !!otherList && otherList.some(o => o.id === idA)
      // Allow non-reciprocal acceptance ONLY for tier=parent or tier=family
      // — both are structurally justified relationships, not one-sided
      // semantic enthusiasm. Bridge and domain tiers still require
      // reciprocal endorsement.
      const structuralBypass = c.tier === "parent" || c.tier === "family"
      if (!reciprocal && !structuralBypass) continue
      const key = idA < idB ? `${idA}|${idB}` : `${idB}|${idA}`
      if (!candidatePairs.has(key)) {
        const a = idA < idB ? idA : idB
        const b = idA < idB ? idB : idA
        candidatePairs.set(key, { idA: a, idB: b, score: c.score, tier: c.tier })
      }
    }
  }

  console.log(
    `[v0] Similarity: ${candidatePairs.size} pairs after reciprocal validation`,
  )

  // 7. Link intent classifier — the precision filter ───────────────────────
  let intentVerdicts:
    | Map<string, { intent: LinkIntentLabel; reason: string }>
    | null = null
  if (classifyLinkIntent && candidatePairs.size > 0) {
    const sorted = Array.from(candidatePairs.entries()).sort(
      (a, b) => b[1].score - a[1].score,
    )
    const targeted = sorted.slice(0, maxIntentPairs)
    const intentInputs: LinkIntentInputPair[] = targeted.map(([key, info]) => ({
      key,
      A: {
        id: info.idA,
        title: docs.get(info.idA)?.title ?? "",
        body: docs.get(info.idA)?.body ?? "",
        cls: classifications?.get(info.idA),
      },
      B: {
        id: info.idB,
        title: docs.get(info.idB)?.title ?? "",
        body: docs.get(info.idB)?.body ?? "",
        cls: classifications?.get(info.idB),
      },
    }))
    try {
      intentVerdicts = await classifyLinkIntent(intentInputs)
    } catch (err) {
      console.warn(
        "[v0] Link intent classifier threw — falling back to score-only filter:",
        err instanceof Error ? err.message : err,
      )
      intentVerdicts = null
    }
  }

  // Apply intent verdicts (when available) to the candidate set.
  const accepted: Array<{
    idA: string
    idB: string
    score: number
    tier: Cand["tier"]
  }> = []
  for (const [key, info] of candidatePairs) {
    if (intentVerdicts) {
      const v = intentVerdicts.get(key)
      if (v) {
        if (v.intent === "no") continue
        // weak_yes requires bridge-level certainty, regardless of original tier
        if (v.intent === "weak_yes" && info.score < 0.55) continue
      }
      // If the LLM classifier ran but didn't return a verdict for this
      // specific pair, accept only "domain" or "parent" tiers — bridge tier
      // edges without LLM endorsement are very likely false positives.
      else if (info.tier === "bridge") {
        continue
      }
    }
    accepted.push(info)
  }

  // 8. Graph density caps — sort by score, accept while neither endpoint
  //    has reached its degree cap. Prevents universal hubs (e.g. "AI",
  //    "Planning", "Systems") from gravitating every page to themselves.
  accepted.sort((a, b) => b.score - a.score)
  const degree = new Map<string, number>()
  const out: SimilarityEdge[] = []
  for (const info of accepted) {
    const dA = degree.get(info.idA) ?? 0
    const dB = degree.get(info.idB) ?? 0
    if (dA >= maxDegreePerNode || dB >= maxDegreePerNode) continue
    out.push({ from: info.idA, to: info.idB, score: info.score })
    degree.set(info.idA, dA + 1)
    degree.set(info.idB, dB + 1)
  }

  console.log(`[v0] Similarity: returning ${out.length} semantic edges`)
  return out
}
