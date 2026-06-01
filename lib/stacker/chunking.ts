import type { StackerChunk, StackerDocument, StackerEntity } from "./types"

const CHUNK_TARGET_CHARS = 1200
const CHUNK_OVERLAP_CHARS = 180
const TOPIC_STOPWORDS = new Set([
  "about","after","again","also","and","are","because","been","before","being","can",
  "could","from","had","has","have","into","its","more","not","our","that","the",
  "their","then","there","these","this","those","through","will","with","your",
])

export function chunkDocument(doc: StackerDocument): StackerChunk[] {
  const text = doc.content.replace(/\s+/g, " ").trim()
  if (!text) return []

  const chunks: StackerChunk[] = []
  let start = 0
  let index = 0
  while (start < text.length) {
    const end = Math.min(text.length, start + CHUNK_TARGET_CHARS)
    const slice = text.slice(start, end).trim()
    if (slice) {
      chunks.push({
        id: `${doc.id}:chunk:${index}`,
        documentId: doc.id,
        userKey: doc.userKey,
        workspaceId: doc.workspaceId,
        title: doc.title,
        text: slice,
        index,
        tokenEstimate: Math.ceil(slice.length / 4),
      })
    }
    if (end >= text.length) break
    start = Math.max(0, end - CHUNK_OVERLAP_CHARS)
    index++
  }
  return chunks
}

export function extractLightweightEntities(docs: StackerDocument[]): StackerEntity[] {
  const byName = new Map<string, StackerEntity>()

  for (const doc of docs) {
    const candidates = extractTopicCandidates(`${doc.title} ${doc.content}`)
    for (const name of candidates.slice(0, 12)) {
      const id = `${doc.userKey}:topic:${slug(name)}`
      const existing = byName.get(id)
      if (existing) {
        if (!existing.documentIds.includes(doc.id)) existing.documentIds.push(doc.id)
      } else {
        byName.set(id, {
          id,
          userKey: doc.userKey,
          workspaceId: doc.workspaceId,
          name,
          kind: "topic",
          documentIds: [doc.id],
        })
      }
    }
  }

  return Array.from(byName.values())
}

function extractTopicCandidates(text: string): string[] {
  const counts = new Map<string, number>()
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter(token => token.length > 3 && !TOPIC_STOPWORDS.has(token))

  for (let i = 0; i < tokens.length; i++) {
    const unigram = tokens[i]
    counts.set(unigram, (counts.get(unigram) ?? 0) + 1)
    const next = tokens[i + 1]
    if (next && !TOPIC_STOPWORDS.has(next)) {
      const bigram = `${unigram} ${next}`
      counts.set(bigram, (counts.get(bigram) ?? 0) + 2)
    }
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name]) => name)
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
}
