import { NextResponse } from "next/server"
import { getWorkspaceSnapshot, snapshotToGraph } from "@/lib/notion-retriever"
import { isNotionConnected } from "@/lib/notion-client"

export async function GET() {
  try {
    const snap = await getWorkspaceSnapshot()
    const graph = snapshotToGraph(snap)
    console.log(
      `[v0] Workspace endpoint: pages=${snap.pages.size}, edges=${snap.edges.length}, ` +
        `graph nodes=${graph.nodes.length}, graph edges=${graph.edges.length}, ` +
        `connected=${isNotionConnected()}, usingMock=${snap.usingMock}`,
    )
    return NextResponse.json({
      graph,
      connected: isNotionConnected() && !snap.usingMock,
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
