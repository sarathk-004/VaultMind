import { type NextRequest, NextResponse } from "next/server"
import { getRequestNotionOAuthCookie, getRequestNotionToken } from "@/lib/notion-token"
import { listAuditEvents } from "@/lib/stacker/audit"
import { resolveWorkspaceIdentity } from "@/lib/stacker/identity"
import {
  rateLimit,
  requireAuthenticatedApi,
  requireSameOrigin,
  requireWorkspaceId,
} from "@/lib/api-security"

export async function GET(req: NextRequest) {
  const originError = requireSameOrigin(req)
  if (originError) return originError

  const limited = rateLimit(req, { limit: 10 })
  if (limited) return limited

  const token = await getRequestNotionToken()
  const authError = requireAuthenticatedApi(token)
  if (authError) return authError

  const oauthCookie = await getRequestNotionOAuthCookie()
  const workspaceId = oauthCookie?.workspaceId ?? null
  const workspaceError = requireWorkspaceId(workspaceId)
  if (workspaceError) return workspaceError

  const identity = resolveWorkspaceIdentity({ workspaceId, token, source: "notion" })
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? 50)

  try {
    const events = await listAuditEvents(identity.workspaceId, { limit })
    return NextResponse.json({
      ok: true,
      workspaceId: identity.workspaceId,
      events,
    })
  } catch (error) {
    console.error("[audit] Failed to list audit events:", error)
    return NextResponse.json({ ok: false, error: "Audit log unavailable" }, { status: 503 })
  }
}
