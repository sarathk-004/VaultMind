import { NextResponse } from "next/server"
import { getWorkspaceSnapshot, snapshotToGraph } from "@/lib/notion-retriever"
import { isNotionConnected } from "@/lib/notion-client"

export async function GET() {
  try {
    console.log("[v0] Workspace: isNotionConnected=", isNotionConnected())
    const snap = await getWorkspaceSnapshot()
    console.log("[v0] Workspace: snapshot=", snap.nodes.length, "nodes,", snap.edges.length, "edges,", snap.pages.length, "pages")
    const graph = snapshotToGraph(snap)
    console.log("[v0] Workspace: graph=", graph.nodes.length, "nodes,", graph.edges.length, "edges")
    return NextResponse.json({
      graph,
      connected: isNotionConnected(),
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
