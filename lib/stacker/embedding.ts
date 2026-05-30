const EMBEDDING_DIMENSIONS = 384

export function embeddingDimensions(): number {
  return EMBEDDING_DIMENSIONS
}

export function embedText(text: string): number[] {
  const vector = Array(EMBEDDING_DIMENSIONS).fill(0) as number[]
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter(token => token.length > 1)

  for (const token of tokens) {
    const index = positiveHash(token) % EMBEDDING_DIMENSIONS
    const sign = positiveHash(`sign:${token}`) % 2 === 0 ? 1 : -1
    vector[index] += sign
  }

  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1
  return vector.map(value => Number((value / norm).toFixed(6)))
}

export function toPgVector(vector: number[]): string {
  return `[${vector.join(",")}]`
}

function positiveHash(value: string): number {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}
