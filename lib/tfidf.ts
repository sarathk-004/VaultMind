/**
 * Tiny TF-IDF + cosine similarity implementation tuned for surfacing
 * content-similar Notion pages. No external deps, runs comfortably for a
 * few hundred documents.
 */

const STOPWORDS = new Set([
  "a","an","and","are","as","at","be","by","for","from","has","have","he",
  "in","is","it","its","of","on","or","that","the","to","was","were","will",
  "with","this","these","those","you","your","i","we","they","their","them",
  "but","not","what","which","who","when","where","why","how","all","any",
  "can","do","does","did","just","so","than","too","very","also","into",
  "if","then","there","here","my","me","our","us","about","over","under",
  "above","between","through","while","because","up","down","out","more",
  "less","some","such","no","nor","only","own","same","other","each","every",
  "been","being","had","having","one","two","three","new","get","got","go",
  "going","make","made","take","taken","using","use","used","like","via",
  "etc","ie","eg","via","yes","no",
])

function tokenize(text: string): string[] {
  return (text || "")
    .toLowerCase()
    // keep word chars + apostrophes inside words
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .split(/\s+/)
    .map(w => w.replace(/^['-]+|['-]+$/g, ""))
    .filter(w => w.length >= 2 && w.length <= 32 && !STOPWORDS.has(w) && !/^\d+$/.test(w))
}

export interface SimilarityEdge {
  from: string
  to: string
  score: number
}

/**
 * Compute pairwise cosine similarity between documents and return the
 * top-K most similar pairs above a threshold for each document.
 *
 * The output is symmetric and de-duplicated.
 */
export function buildSemanticEdges(
  docs: Map<string, string>,
  opts: { topK?: number; minScore?: number } = {},
): SimilarityEdge[] {
  const { topK = 4, minScore = 0.18 } = opts

  const ids = Array.from(docs.keys())
  if (ids.length < 2) return []

  // 1. Tokenize every doc
  const tokensById = new Map<string, string[]>()
  for (const [id, text] of docs) tokensById.set(id, tokenize(text))

  // 2. Document frequency per term
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
  // 3. TF-IDF vectors (sparse), L2-normalized
  const vectors = new Map<string, Map<string, number>>()
  for (const [id, tokens] of tokensById) {
    if (tokens.length === 0) {
      vectors.set(id, new Map())
      continue
    }
    const tf = new Map<string, number>()
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1)
    // log-normalized tf for stability
    const vec = new Map<string, number>()
    let normSq = 0
    for (const [term, count] of tf) {
      const dfc = df.get(term) ?? 1
      // Skip terms that appear in too many docs (≥80%) — generic noise.
      if (dfc / N > 0.8) continue
      // Skip ultra-rare terms (only appear in 1 doc) — not useful for similarity.
      if (dfc < 2) continue
      const idf = Math.log((N + 1) / (dfc + 1)) + 1
      const tfidf = (1 + Math.log(count)) * idf
      vec.set(term, tfidf)
      normSq += tfidf * tfidf
    }
    const norm = Math.sqrt(normSq) || 1
    for (const [term, val] of vec) vec.set(term, val / norm)
    vectors.set(id, vec)
  }

  // 4. Pairwise cosine similarity, retain top-K per doc.
  // For 130 docs this is ~17k pairs — runs in a few ms.
  const perNodeBest = new Map<string, { id: string; score: number }[]>()
  const ensure = (id: string) => {
    let arr = perNodeBest.get(id)
    if (!arr) {
      arr = []
      perNodeBest.set(id, arr)
    }
    return arr
  }
  const considerPair = (a: string, b: string, score: number) => {
    if (score < minScore) return
    for (const id of [a, b]) {
      const other = id === a ? b : a
      const arr = ensure(id)
      arr.push({ id: other, score })
    }
  }

  for (let i = 0; i < ids.length; i++) {
    const va = vectors.get(ids[i])!
    if (va.size === 0) continue
    for (let j = i + 1; j < ids.length; j++) {
      const vb = vectors.get(ids[j])!
      if (vb.size === 0) continue
      // dot product over the smaller vector
      const [small, big] = va.size <= vb.size ? [va, vb] : [vb, va]
      let dot = 0
      for (const [term, val] of small) {
        const other = big.get(term)
        if (other) dot += val * other
      }
      considerPair(ids[i], ids[j], dot)
    }
  }

  // 5. Keep top-K per node, then de-duplicate undirected pairs.
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
