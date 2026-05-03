import { NextResponse } from "next/server"
import { getWorkspaceSnapshot, snapshotToGraph } from "@/lib/notion-retriever"
import { isNotionConnected } from "@/lib/notion-client"

export async function GET() {
  try {
    const snap = await getWorkspaceSnapshot()
    const graph = snapshotToGraph(snap)
    return NextResponse.json({
      graph,
      connected: isNotionConnected(),
      fetchedAt: snap.fetchedAt,
    })
  } catch (error) {
    console.error("[v0] Workspace fetch error:", error)
    return NextResponse.json(
      { error: "Failed to fetch workspace" },
      { status: 500 },
    )
  }
}
