import { Pool } from "pg"
import type { GraphEdge, GraphNode, KnowledgeGraph } from "@/lib/vaultmind-types"
import { embedText, embeddingDimensions, toPgVector } from "./embedding"
import type {
  StackerChunk,
  StackerDocument,
  StackerGraphAdapter,
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

export function getStackerPool(): Pool {
  return getPool()
}

async function ensureSchema(): Promise<void> {
  if (schemaReady) return schemaReady
  schemaReady = (async () => {
    const db = getPool()
    await db.query("CREATE EXTENSION IF NOT EXISTS vector")
    await db.query(`
      CREATE TABLE IF NOT EXISTS stacker_documents (
        workspace_id text NOT NULL,
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
      ALTER TABLE stacker_documents
      ADD COLUMN IF NOT EXISTS workspace_id text NOT NULL DEFAULT 'unknown'
    `)
    await db.query(`
      CREATE TABLE IF NOT EXISTS stacker_chunks (
        workspace_id text NOT NULL,
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
      ALTER TABLE stacker_chunks
      ADD COLUMN IF NOT EXISTS workspace_id text NOT NULL DEFAULT 'unknown'
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
    await db.query(`
      CREATE INDEX IF NOT EXISTS stacker_documents_workspace_idx
      ON stacker_documents(workspace_id)
    `)
    await db.query(`
      CREATE INDEX IF NOT EXISTS stacker_chunks_workspace_idx
      ON stacker_chunks(workspace_id)
    `)
    await db.query(`
      CREATE TABLE IF NOT EXISTS stacker_graph_nodes (
        workspace_id text NOT NULL,
        user_key text NOT NULL,
        id text NOT NULL,
        label text NOT NULL,
        type text,
        cluster text,
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (user_key, id)
      )
    `)
    await db.query(`
      CREATE TABLE IF NOT EXISTS stacker_graph_edges (
        workspace_id text NOT NULL,
        user_key text NOT NULL,
        from_id text NOT NULL,
        to_id text NOT NULL,
        relation text,
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (user_key, from_id, to_id, relation)
      )
    `)
    await db.query(`
      CREATE INDEX IF NOT EXISTS stacker_graph_nodes_workspace_idx
      ON stacker_graph_nodes(workspace_id)
    `)
    await db.query(`
      CREATE INDEX IF NOT EXISTS stacker_graph_edges_workspace_idx
      ON stacker_graph_edges(workspace_id)
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
            (workspace_id, user_key, id, source, title, type, url, content, updated_at, indexed_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
          ON CONFLICT (user_key, id) DO UPDATE SET
            workspace_id = EXCLUDED.workspace_id,
            source = EXCLUDED.source,
            title = EXCLUDED.title,
            type = EXCLUDED.type,
            url = EXCLUDED.url,
            content = EXCLUDED.content,
            updated_at = EXCLUDED.updated_at,
            indexed_at = now()
          `,
          [
            doc.workspaceId,
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
      SELECT id, user_key, workspace_id, source, title, type, url, content, updated_at
      FROM stacker_documents
      WHERE user_key = $1 AND id = ANY($2::text[])
      `,
      [userKey, ids],
    )
    return result.rows.map((row: any) => ({
      id: row.id,
      userKey: row.user_key,
      workspaceId: row.workspace_id ?? "unknown",
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
            (workspace_id, user_key, id, document_id, title, text, chunk_index, token_estimate, embedding, indexed_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::vector, now())
          ON CONFLICT (user_key, id) DO UPDATE SET
            workspace_id = EXCLUDED.workspace_id,
            document_id = EXCLUDED.document_id,
            title = EXCLUDED.title,
            text = EXCLUDED.text,
            chunk_index = EXCLUDED.chunk_index,
            token_estimate = EXCLUDED.token_estimate,
            embedding = EXCLUDED.embedding,
            indexed_at = now()
          `,
          [
            chunk.workspaceId,
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

export const postgresGraphAdapter: StackerGraphAdapter = {
  async upsertNodes(userKey: string, nodes: GraphNode[]) {
    if (nodes.length === 0) return
    await ensureSchema()
    const db = getPool()
    const client = await db.connect()
    try {
      await client.query("BEGIN")
      for (const node of nodes) {
        const workspaceId = graphWorkspaceId(node)
        await client.query(
          `
          INSERT INTO stacker_graph_nodes
            (workspace_id, user_key, id, label, type, cluster, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, now())
          ON CONFLICT (user_key, id) DO UPDATE SET
            workspace_id = EXCLUDED.workspace_id,
            label = EXCLUDED.label,
            type = EXCLUDED.type,
            cluster = EXCLUDED.cluster,
            updated_at = now()
          `,
          [workspaceId, userKey, node.id, node.label, node.type ?? null, node.cluster ?? null],
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

  async upsertEdges(userKey: string, edges: GraphEdge[]) {
    if (edges.length === 0) return
    await ensureSchema()
    const db = getPool()
    const client = await db.connect()
    try {
      await client.query("BEGIN")
      for (const edge of edges) {
        const workspaceId = graphWorkspaceId(edge)
        await client.query(
          `
          INSERT INTO stacker_graph_edges
            (workspace_id, user_key, from_id, to_id, relation, updated_at)
          VALUES ($1, $2, $3, $4, $5, now())
          ON CONFLICT (user_key, from_id, to_id, relation) DO UPDATE SET
            workspace_id = EXCLUDED.workspace_id,
            updated_at = now()
          `,
          [workspaceId, userKey, edge.from, edge.to, edge.relation ?? ""],
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

  async expand(userKey: string, seedIds: string[], limit: number): Promise<KnowledgeGraph> {
    if (seedIds.length === 0) return { nodes: [], edges: [] }
    await ensureSchema()
    const result = await getPool().query(
      `
      WITH related_edges AS (
        SELECT from_id, to_id, relation
        FROM stacker_graph_edges
        WHERE user_key = $1
          AND (from_id = ANY($2::text[]) OR to_id = ANY($2::text[]))
        ORDER BY updated_at DESC
        LIMIT $3
      ),
      ids AS (
        SELECT unnest($2::text[]) AS id
        UNION
        SELECT from_id FROM related_edges
        UNION
        SELECT to_id FROM related_edges
      )
      SELECT
        COALESCE(jsonb_agg(DISTINCT jsonb_build_object(
          'id', n.id,
          'label', n.label,
          'type', n.type,
          'cluster', n.cluster
        )) FILTER (WHERE n.id IS NOT NULL), '[]'::jsonb) AS nodes,
        COALESCE(jsonb_agg(DISTINCT jsonb_build_object(
          'from', e.from_id,
          'to', e.to_id,
          'relation', NULLIF(e.relation, '')
        )) FILTER (WHERE e.from_id IS NOT NULL), '[]'::jsonb) AS edges
      FROM ids
      LEFT JOIN stacker_graph_nodes n
        ON n.user_key = $1 AND n.id = ids.id
      LEFT JOIN related_edges e
        ON e.from_id = ids.id OR e.to_id = ids.id
      `,
      [userKey, seedIds, limit],
    )
    const row = result.rows[0] ?? { nodes: [], edges: [] }
    return {
      nodes: row.nodes as GraphNode[],
      edges: row.edges as GraphEdge[],
    }
  },
}

function graphWorkspaceId(value: GraphNode | GraphEdge): string {
  const withWorkspace = value as { workspaceId?: unknown; workspace_id?: unknown }
  if (typeof withWorkspace.workspaceId === "string" && withWorkspace.workspaceId) {
    return withWorkspace.workspaceId
  }
  if (typeof withWorkspace.workspace_id === "string" && withWorkspace.workspace_id) {
    return withWorkspace.workspace_id
  }
  return "unknown"
}
