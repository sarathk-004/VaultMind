import { NextResponse } from "next/server"
import { isNotionConnected, notionFetch } from "@/lib/notion-client"
import type { NotionSearchResponse } from "@/lib/notion-client"
import { getRequestNotionOAuthCookie, getRequestNotionToken } from "@/lib/notion-token"

export async function GET() {
  const userToken = await getRequestNotionToken()
  const oauthCookie = await getRequestNotionOAuthCookie()
  const effectiveToken = userToken ?? process.env.NOTION_API_KEY ?? null
  const hasKey = isNotionConnected(userToken)
  const tokenSource = userToken ? "oauth" : process.env.NOTION_API_KEY ? "env" : "none"
  const keyPreview = effectiveToken
    ? `${effectiveToken.slice(0, 10)}...${effectiveToken.slice(-4)}`
    : "NOT SET"

  if (!hasKey) {
    return NextResponse.json({
      ok: false,
      hasKey: false,
      tokenSource,
      keyPreview: "NOT SET",
      error: "No Notion connection",
      help: "Click 'Connect Notion' to authorize Graphyne from your Notion workspace.",
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
        workspaceName: oauthCookie?.workspaceName,
        error: "Connected to Notion, but no pages found",
        help:
          "Reconnect and select pages for Graphyne to access, or share more parent pages with the Graphyne connection in Notion.",
      })
    }
    return NextResponse.json({
      ok: true,
      hasKey: true,
      tokenSource,
      keyPreview,
      workspaceName: oauthCookie?.workspaceName,
      pagesFound: pageCount,
      message: `Connected. ${pageCount}+ accessible page(s).`,
    })
  } catch (error) {
    return NextResponse.json({
      ok: false,
      hasKey: true,
      tokenSource,
      keyPreview,
      workspaceName: oauthCookie?.workspaceName,
      error: "Notion rejected the token",
      details: error instanceof Error ? error.message : String(error),
      help: "Disconnect and connect Notion again. If this persists, check your Notion OAuth app settings.",
    })
  }
}
