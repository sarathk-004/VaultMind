import { NextResponse } from "next/server"
import { getWorkspaceSnapshot, snapshotToGraph } from "@/lib/notion-retriever"
import { isNotionConnected } from "@/lib/notion-client"
import { getRequestNotionToken } from "@/lib/notion-token"
import { providerOptionsFromSettings } from "@/lib/llm-client"
import { getRequestLlmSettings, hasUserLlmKey } from "@/lib/llm-settings"

export async function GET() {
  try {
    const token = await getRequestNotionToken()
    const llmSettings = await getRequestLlmSettings()
    const snap = await getWorkspaceSnapshot(token, {
      ...providerOptionsFromSettings(llmSettings),
      budgetMs: hasUserLlmKey(llmSettings) ? 12_000 : 2_500,
    })
    const graph = snapshotToGraph(snap)
    console.log(
      `[v0] Workspace endpoint: pages=${snap.pages.size}, edges=${snap.edges.length}, ` +
        `graph nodes=${graph.nodes.length}, graph edges=${graph.edges.length}, ` +
        `connected=${isNotionConnected(token)}, usingMock=${snap.usingMock}`,
    )
    return NextResponse.json({
      graph,
      connected: isNotionConnected(token) && !snap.usingMock,
      fetchedAt: snap.fetchedAt,
    })
  } catch (error) {
    console.error("[v0] Workspace fetch error:", error)
    return NextResponse.json(
      { error: "Failed to fetch workspace", details: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    )
  }
}
