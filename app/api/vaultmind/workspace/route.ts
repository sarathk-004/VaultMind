import { type NextRequest, NextResponse } from "next/server"
import { getWorkspaceSnapshot, snapshotToGraph } from "@/lib/notion-retriever"
import { isNotionConnected } from "@/lib/notion-client"
import { getRequestNotionOAuthCookie, getRequestNotionToken } from "@/lib/notion-token"
import { providerOptionsFromSettings } from "@/lib/llm-client"
import { getRequestLlmSettings, hasAvailableLlmProvider } from "@/lib/llm-settings"
import { getStackerConfig } from "@/lib/stacker/config"
import { getStackerWorkspaceGraph, isStackerEnabled } from "@/lib/stacker/service"
import { logAuditEvent } from "@/lib/stacker/audit"
import { resolveWorkspaceIdentity } from "@/lib/stacker/identity"
import { rateLimit, requireAuthenticatedApi, requireWorkspaceId } from "@/lib/api-security"

export async function GET(req: NextRequest) {
  try {
    const startedAt = Date.now()
    const limited = rateLimit(req, { limit: 20 })
    if (limited) return limited

    const token = await getRequestNotionToken()
    const oauthCookie = await getRequestNotionOAuthCookie()
    const workspaceId = oauthCookie?.workspaceId ?? null
    const authError = requireAuthenticatedApi(token)
    if (authError) return authError
    const workspaceError = requireWorkspaceId(workspaceId)
    if (workspaceError) return workspaceError

    const llmSettings = await getRequestLlmSettings()
    const snap = await getWorkspaceSnapshot(token, {
      ...providerOptionsFromSettings(llmSettings),
      budgetMs: hasAvailableLlmProvider(llmSettings) ? 12_000 : 2_500,
    })
    const stackerConfig = getStackerConfig()
    const graph = isStackerEnabled(stackerConfig)
      ? await getStackerWorkspaceGraph({ snapshot: snap, token, config: stackerConfig, workspaceId })
      : snapshotToGraph(snap)
    console.log(
      `[v0] Workspace endpoint: pages=${snap.pages.size}, edges=${snap.edges.length}, ` +
        `graph nodes=${graph.nodes.length}, graph edges=${graph.edges.length}, ` +
        `connected=${isNotionConnected(token)}, usingMock=${snap.usingMock}`,
    )
    const res = NextResponse.json({
      graph,
      connected: isNotionConnected(token),
      fetchedAt: snap.fetchedAt,
    })
    const identity = resolveWorkspaceIdentity({ workspaceId, token, source: snap.source })
    void logAuditEvent({
      workspaceId: identity.workspaceId,
      userKey: identity.userKey,
      eventType: "workspace_fetch",
      route: req.nextUrl.pathname,
      method: req.method,
      status: res.status,
      latencyMs: Date.now() - startedAt,
      metadata: {
        usingMock: snap.usingMock,
        nodes: graph.nodes.length,
        edges: graph.edges.length,
      },
    })
    return res
  } catch (error) {
    console.error("[v0] Workspace fetch error:", error)
    return NextResponse.json(
      { error: "Failed to fetch workspace" },
      { status: 500 },
    )
  }
}
