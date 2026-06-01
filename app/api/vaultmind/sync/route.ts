import { type NextRequest, NextResponse } from "next/server"
import { providerOptionsFromSettings } from "@/lib/llm-client"
import { getRequestLlmSettings, hasAvailableLlmProvider } from "@/lib/llm-settings"
import { getWorkspaceSnapshot } from "@/lib/notion-retriever"
import { getRequestNotionOAuthCookie, getRequestNotionToken } from "@/lib/notion-token"
import { getStackerConfig } from "@/lib/stacker/config"
import { isStackerEnabled, syncStackerWorkspace } from "@/lib/stacker/service"
import { logAuditEvent } from "@/lib/stacker/audit"
import { resolveWorkspaceIdentity } from "@/lib/stacker/identity"
import { rateLimit, requireSyncAuthorization, requireWorkspaceId } from "@/lib/api-security"

export async function POST(req: NextRequest) {
  const startedAt = Date.now()
  const authorizationError = requireSyncAuthorization(req)
  if (authorizationError) return authorizationError

  const limited = rateLimit(req, { limit: 4 })
  if (limited) return limited

  const config = getStackerConfig()
  if (!isStackerEnabled(config)) {
    return NextResponse.json({
      ok: false,
      reason: "Stacker is disabled. Set VAULTMIND_STACKER_ENABLED=true to run the sync worker.",
    }, { status: 409 })
  }

  try {
    const token = await getRequestNotionToken()
    const oauthCookie = await getRequestNotionOAuthCookie()
    const workspaceId = oauthCookie?.workspaceId ?? null
    const workspaceError = requireWorkspaceId(workspaceId)
    if (workspaceError) return workspaceError
    const llmSettings = await getRequestLlmSettings()
    const snapshot = await getWorkspaceSnapshot(token, {
      ...providerOptionsFromSettings(llmSettings),
      budgetMs: hasAvailableLlmProvider(llmSettings) ? 12_000 : 2_500,
    })
    const result = await syncStackerWorkspace({ snapshot, token, config, workspaceId })
    const res = NextResponse.json({ ok: true, ...result })
    const identity = resolveWorkspaceIdentity({ workspaceId, token, source: snapshot.source })
    void logAuditEvent({
      workspaceId: identity.workspaceId,
      userKey: identity.userKey,
      eventType: "sync",
      route: req.nextUrl.pathname,
      method: req.method,
      status: res.status,
      latencyMs: Date.now() - startedAt,
      metadata: {
        documentCount: result.documentCount,
        chunkCount: result.chunkCount,
        nodeCount: result.nodeCount,
        edgeCount: result.edgeCount,
      },
    })
    return res
  } catch (error) {
    console.error("[stacker] Sync worker failed:", error)
    return NextResponse.json({
      ok: false,
      error: "Sync failed",
    }, { status: 500 })
  }
}
