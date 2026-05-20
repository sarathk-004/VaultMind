import { NextResponse } from "next/server"
import { isNotionConnected, notionFetch } from "@/lib/notion-client"
import type { NotionSearchResponse } from "@/lib/notion-client"
import { getRequestNotionToken } from "@/lib/notion-token"

export async function GET() {
  const userToken = await getRequestNotionToken()
  const effectiveToken = userToken ?? process.env.NOTION_API_KEY ?? null
  const hasKey = isNotionConnected(userToken)
  const tokenSource = userToken ? "user" : process.env.NOTION_API_KEY ? "env" : "none"
  const keyPreview = effectiveToken
    ? `${effectiveToken.slice(0, 10)}...${effectiveToken.slice(-4)}`
    : "NOT SET"

  if (!hasKey) {
    return NextResponse.json({
      ok: false,
      hasKey: false,
      tokenSource,
      keyPreview: "NOT SET",
      error: "No Notion token configured",
      help: "Click 'Connect Notion' and paste your Internal Integration Secret (starts with 'secret_' or 'ntn_').",
    })
  }

  try {
    const res = await notionFetch<NotionSearchResponse>(
      "/search",
      { method: "POST", body: { page_size: 1 } },
      userToken,
    )
    const pageCount = res.results.length
    if (pageCount === 0) {
      return NextResponse.json({
        ok: false,
        hasKey: true,
        tokenSource,
        keyPreview,
        error: "Connected to Notion, but no pages found",
        help:
          "Open the page in Notion → click 'Share' (or '...' → Connections) → add your integration. Repeat for each page or parent page you want Graphyne to query.",
      })
    }
    return NextResponse.json({
      ok: true,
      hasKey: true,
      tokenSource,
      keyPreview,
      pagesFound: pageCount,
      message: `Connected. ${pageCount}+ accessible page(s).`,
    })
  } catch (error) {
    return NextResponse.json({
      ok: false,
      hasKey: true,
      tokenSource,
      keyPreview,
      error: "Notion rejected the token",
      details: error instanceof Error ? error.message : String(error),
      help:
        "Verify the token is an Internal Integration Secret (starts with 'secret_' or 'ntn_'), not an OAuth token.",
    })
  }
}
