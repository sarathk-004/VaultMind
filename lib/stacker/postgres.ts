import { Pool } from "pg"
import { embedText, embeddingDimensions, toPgVector } from "./embedding"
import type {
  StackerChunk,
  StackerDocument,
  StackerRetrievalHit,
  StackerStoreAdapter,
  StackerVectorAdapter,
} from "./types"

let pool: Pool | null = null
let schemaReady: Promise<void> | null = null

function getPool(): Pool {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for the Postgres/pgvector adapter")
  }
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
    })
  }
  return pool
}

async function ensureSchema(): Promise<void> {
  if (schemaReady) return schemaReady
  schemaReady = (async () => {
    const db = getPool()
    await db.query("CREATE EXTENSION IF NOT EXISTS vector")
    await db.query(`
      CREATE TABLE IF NOT EXISTS stacker_documents (
        user_key text NOT NULL,
        id text NOT NULL,
        source text NOT NULL,
        title text NOT NULL,
        type text NOT NULL,
        url text,
        content text NOT NULL,
        updated_at timestamptz,
        indexed_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (user_key, id)
      )
    `)
    await db.query(`
      CREATE TABLE IF NOT EXISTS stacker_chunks (
        user_key text NOT NULL,
        id text NOT NULL,
        document_id text NOT NULL,
        title text NOT NULL,
        text text NOT NULL,
        chunk_index integer NOT NULL,
        token_estimate integer NOT NULL,
        embedding vector(${embeddingDimensions()}) NOT NULL,
        indexed_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (user_key, id),
        FOREIGN KEY (user_key, document_id)
          REFERENCES stacker_documents(user_key, id)
          ON DELETE CASCADE
      )
    `)
    await db.query(`
      CREATE INDEX IF NOT EXISTS stacker_chunks_embedding_idx
      ON stacker_chunks
      USING ivfflat (embedding vector_cosine_ops)
      WITH (lists = 100)
    `).catch(() => undefined)
    await db.query(`
      CREATE INDEX IF NOT EXISTS stacker_chunks_document_idx
      ON stacker_chunks(user_key, document_id)
    `)
  })()
  return schemaReady
}

export const postgresStoreAdapter: StackerStoreAdapter = {
  async upsertDocuments(documents: StackerDocument[]) {
    if (documents.length === 0) return
    await ensureSchema()
    const db = getPool()
    const client = await db.connect()
    try {
      await client.query("BEGIN")
      for (const doc of documents) {
        await client.query(
          `
          INSERT INTO stacker_documents
            (user_key, id, source, title, type, url, content, updated_at, indexed_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
          ON CONFLICT (user_key, id) DO UPDATE SET
            source = EXCLUDED.source,
            title = EXCLUDED.title,
            type = EXCLUDED.type,
            url = EXCLUDED.url,
            content = EXCLUDED.content,
            updated_at = EXCLUDED.updated_at,
            indexed_at = now()
          `,
          [
            doc.userKey,
            doc.id,
            doc.source,
            doc.title,
            doc.type,
            doc.url ?? null,
            doc.content,
            doc.updatedAt ?? null,
          ],
        )
      }
      await client.query("COMMIT")
    } catch (error) {
      await client.query("ROLLBACK")
      throw error
    } finally {
      client.release()
    }
  },

  async getDocuments(userKey: string, ids: string[]) {
    if (ids.length === 0) return []
    await ensureSchema()
    const result = await getPool().query(
      `
      SELECT id, user_key, source, title, type, url, content, updated_at
      FROM stacker_documents
      WHERE user_key = $1 AND id = ANY($2::text[])
      `,
      [userKey, ids],
    )
    return result.rows.map((row: any) => ({
      id: row.id,
      userKey: row.user_key,
      source: row.source,
      title: row.title,
      type: row.type,
      url: row.url ?? undefined,
      content: row.content,
      updatedAt: row.updated_at?.toISOString?.() ?? undefined,
    }))
  },
}

export const pgvectorAdapter: StackerVectorAdapter = {
  async upsertChunks(chunks: StackerChunk[]) {
    if (chunks.length === 0) return
    await ensureSchema()
    const db = getPool()
    const client = await db.connect()
    try {
      await client.query("BEGIN")
      for (const chunk of chunks) {
        await client.query(
          `
          INSERT INTO stacker_chunks
            (user_key, id, document_id, title, text, chunk_index, token_estimate, embedding, indexed_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8::vector, now())
          ON CONFLICT (user_key, id) DO UPDATE SET
            document_id = EXCLUDED.document_id,
            title = EXCLUDED.title,
            text = EXCLUDED.text,
            chunk_index = EXCLUDED.chunk_index,
            token_estimate = EXCLUDED.token_estimate,
            embedding = EXCLUDED.embedding,
            indexed_at = now()
          `,
          [
            chunk.userKey,
            chunk.id,
            chunk.documentId,
            chunk.title,
            chunk.text,
            chunk.index,
            chunk.tokenEstimate,
            toPgVector(embedText(`${chunk.title}\n${chunk.text}`)),
          ],
        )
      }
      await client.query("COMMIT")
    } catch (error) {
      await client.query("ROLLBACK")
      throw error
    } finally {
      client.release()
    }
  },

  async search(userKey: string, query: string, limit: number): Promise<StackerRetrievalHit[]> {
    await ensureSchema()
    const queryVector = toPgVector(embedText(query))
    const result = await getPool().query(
      `
      SELECT document_id, id AS chunk_id, title, text,
        1 - (embedding <=> $2::vector) AS score
      FROM stacker_chunks
      WHERE user_key = $1
      ORDER BY embedding <=> $2::vector
      LIMIT $3
      `,
      [userKey, queryVector, limit],
    )
    return result.rows.map((row: any) => ({
      documentId: row.document_id,
      chunkId: row.chunk_id,
      title: row.title,
      text: row.text,
      score: Number(row.score ?? 0),
      source: "vector",
    }))
  },
}
