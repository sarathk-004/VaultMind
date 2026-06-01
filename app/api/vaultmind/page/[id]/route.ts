import { type NextRequest, NextResponse } from "next/server"
import { fetchPageContent } from "@/lib/notion-retriever"
import { getRequestNotionToken } from "@/lib/notion-token"
import { rateLimit, requireAuthenticatedApi } from "@/lib/api-security"

const NOTION_ID_RE = /^[0-9a-f]{32}$/i

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const limited = rateLimit(req, { limit: 40 })
    if (limited) return limited

    const { id } = await params
    const cleanId = id.replace(/-/g, "")
    if (!NOTION_ID_RE.test(cleanId)) {
      return NextResponse.json({ error: "Invalid page id" }, { status: 400 })
    }

    const token = await getRequestNotionToken()
    const authError = requireAuthenticatedApi(token)
    if (authError) return authError

    const content = await fetchPageContent(cleanId, token)
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
