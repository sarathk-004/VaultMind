import { getStackerPool } from "./postgres"

export interface AuditEvent {
  workspaceId: string
  userKey: string
  eventType: string
  route: string
  method: string
  status: number
  latencyMs: number
  metadata?: Record<string, unknown>
}

let auditSchemaReady: Promise<void> | null = null
let auditDisabled = false

async function ensureAuditSchema(): Promise<void> {
  if (auditSchemaReady) return auditSchemaReady
  auditSchemaReady = (async () => {
    const db = getStackerPool()
    await db.query(`
      CREATE TABLE IF NOT EXISTS stacker_audit_logs (
        id bigserial PRIMARY KEY,
        workspace_id text NOT NULL,
        user_key text NOT NULL,
        event_type text NOT NULL,
        route text NOT NULL,
        method text NOT NULL,
        status integer NOT NULL,
        latency_ms integer NOT NULL,
        metadata jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `)
    await db.query(`
      CREATE INDEX IF NOT EXISTS stacker_audit_logs_workspace_idx
      ON stacker_audit_logs(workspace_id, created_at DESC)
    `)
  })()
  return auditSchemaReady
}

export async function logAuditEvent(event: AuditEvent): Promise<void> {
  if (auditDisabled) return
  try {
    await ensureAuditSchema()
    const db = getStackerPool()
    await db.query(
      `
      INSERT INTO stacker_audit_logs
        (workspace_id, user_key, event_type, route, method, status, latency_ms, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [
        event.workspaceId,
        event.userKey,
        event.eventType,
        event.route,
        event.method,
        event.status,
        event.latencyMs,
        event.metadata ?? null,
      ],
    )
  } catch (error) {
    auditDisabled = true
    console.warn("[audit] Disabled after failure:", error instanceof Error ? error.message : error)
  }
}

export async function listAuditEvents(
  workspaceId: string,
  options: { limit?: number } = {},
): Promise<Array<AuditEvent & { id: number; createdAt: string }>> {
  await ensureAuditSchema()
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200)
  const result = await getStackerPool().query(
    `
    SELECT id, workspace_id, user_key, event_type, route, method, status,
      latency_ms, metadata, created_at
    FROM stacker_audit_logs
    WHERE workspace_id = $1
    ORDER BY created_at DESC
    LIMIT $2
    `,
    [workspaceId, limit],
  )
  return result.rows.map((row: any) => ({
    id: Number(row.id),
    workspaceId: row.workspace_id,
    userKey: row.user_key,
    eventType: row.event_type,
    route: row.route,
    method: row.method,
    status: Number(row.status),
    latencyMs: Number(row.latency_ms),
    metadata: row.metadata ?? undefined,
    createdAt: row.created_at?.toISOString?.() ?? String(row.created_at),
  }))
}
