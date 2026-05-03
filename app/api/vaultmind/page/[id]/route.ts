import { type NextRequest, NextResponse } from "next/server"
import { fetchPageContent } from "@/lib/notion-retriever"
import { getRequestNotionToken } from "@/lib/notion-token"

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const token = await getRequestNotionToken()
    const content = await fetchPageContent(id, token)
    if (!content) {
      return NextResponse.json({ error: "Page not found" }, { status: 404 })
    }
    return NextResponse.json(content)
  } catch (error) {
    console.error("[v0] Page fetch error:", error)
    return NextResponse.json(
      { error: "Failed to fetch page" },
      { status: 500 },
    )
  }
}
