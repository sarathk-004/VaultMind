import { type NextRequest, NextResponse } from "next/server"
import { fetchPageContent } from "@/lib/notion-retriever"
import { getRequestNotionOAuthCookie, getRequestNotionToken } from "@/lib/notion-token"
import { logAuditEvent } from "@/lib/stacker/audit"
import { resolveWorkspaceIdentity } from "@/lib/stacker/identity"
import { rateLimit, requireAuthenticatedApi, requireWorkspaceId } from "@/lib/api-security"

const NOTION_ID_RE = /^[0-9a-f]{32}$/i

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const startedAt = Date.now()
    const limited = rateLimit(req, { limit: 40 })
    if (limited) return limited

    const { id } = await params
    const cleanId = id.replace(/-/g, "")
    if (!NOTION_ID_RE.test(cleanId)) {
      return NextResponse.json({ error: "Invalid page id" }, { status: 400 })
    }

    const token = await getRequestNotionToken()
    const oauthCookie = await getRequestNotionOAuthCookie()
    const workspaceId = oauthCookie?.workspaceId ?? null
    const authError = requireAuthenticatedApi(token)
    if (authError) return authError
    const workspaceError = requireWorkspaceId(workspaceId)
    if (workspaceError) return workspaceError

    const content = await fetchPageContent(cleanId, token)
    if (!content) {
      return NextResponse.json({ error: "Page not found" }, { status: 404 })
    }
    const res = NextResponse.json(content)
    const identity = resolveWorkspaceIdentity({ workspaceId, token, source: "notion" })
    void logAuditEvent({
      workspaceId: identity.workspaceId,
      userKey: identity.userKey,
      eventType: "page_fetch",
      route: req.nextUrl.pathname,
      method: req.method,
      status: res.status,
      latencyMs: Date.now() - startedAt,
      metadata: { pageId: cleanId },
    })
    return res
  } catch (error) {
    console.error("[v0] Page fetch error:", error)
    return NextResponse.json(
      { error: "Failed to fetch page" },
      { status: 500 },
    )
  }
}
