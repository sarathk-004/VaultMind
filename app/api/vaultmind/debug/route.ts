import { NextResponse } from "next/server"
import { isNotionConnected, notionFetch } from "@/lib/notion-client"
import type { NotionSearchResponse } from "@/lib/notion-client"
import { getRequestNotionOAuthCookie, getRequestNotionToken } from "@/lib/notion-token"
import { forbiddenJson, requireAuthenticatedApi } from "@/lib/api-security"

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return forbiddenJson("Debug endpoint is disabled in production")
  }

  const userToken = await getRequestNotionToken()
  const authError = requireAuthenticatedApi(userToken)
  if (authError) return authError

  const oauthCookie = await getRequestNotionOAuthCookie()
  const hasKey = isNotionConnected(userToken)
  const tokenSource = userToken ? "oauth" : process.env.NOTION_API_KEY ? "env" : "none"

  if (!hasKey) {
    return NextResponse.json({
      ok: false,
      hasKey: false,
      tokenSource,
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
      workspaceName: oauthCookie?.workspaceName,
      pagesFound: pageCount,
      message: `Connected. ${pageCount}+ accessible page(s).`,
    })
  } catch (error) {
    return NextResponse.json({
      ok: false,
      hasKey: true,
      tokenSource,
      workspaceName: oauthCookie?.workspaceName,
      error: "Notion rejected the token",
      help: "Disconnect and connect Notion again. If this persists, check your Notion OAuth app settings.",
    })
  }
}
