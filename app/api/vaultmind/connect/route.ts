import { type NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import {
  NOTION_OAUTH_STATE_COOKIE,
  NOTION_TOKEN_COOKIE,
  getRequestNotionOAuthCookie,
  notionOAuthStateCookieOptions,
  notionTokenCookieOptions,
} from "@/lib/notion-token"
import { clearTokenCaches } from "@/lib/notion-retriever"

function getBaseUrl(req: NextRequest) {
  return process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin
}

export async function POST(req: NextRequest) {
  const clientId = process.env.NOTION_OAUTH_CLIENT_ID
  if (!clientId) {
    return NextResponse.json(
      {
        ok: false,
        error: "Notion OAuth is not configured. Set NOTION_OAUTH_CLIENT_ID in Vercel.",
      },
      { status: 500 },
    )
  }

  const redirectUri =
    process.env.NOTION_OAUTH_REDIRECT_URI || `${getBaseUrl(req)}/api/vaultmind/connect/callback`
  const state = crypto.randomUUID()

  const authorizeUrl = new URL("https://api.notion.com/v1/oauth/authorize")
  authorizeUrl.searchParams.set("client_id", clientId)
  authorizeUrl.searchParams.set("response_type", "code")
  authorizeUrl.searchParams.set("owner", "user")
  authorizeUrl.searchParams.set("redirect_uri", redirectUri)
  authorizeUrl.searchParams.set("state", state)

  const store = await cookies()
  store.set(NOTION_OAUTH_STATE_COOKIE, state, notionOAuthStateCookieOptions())

  return NextResponse.json({ ok: true, authorizeUrl: authorizeUrl.toString() })
}

export async function DELETE() {
  const store = await cookies()
  const existing = store.get(NOTION_TOKEN_COOKIE)?.value
  if (existing) clearTokenCaches(existing)
  store.set(NOTION_TOKEN_COOKIE, "", { ...notionTokenCookieOptions(), maxAge: 0 })
  store.set(NOTION_OAUTH_STATE_COOKIE, "", { ...notionOAuthStateCookieOptions(), maxAge: 0 })
  return NextResponse.json({ ok: true })
}

export async function GET() {
  const store = await cookies()
  const token = store.get(NOTION_TOKEN_COOKIE)?.value
  const oauthCookie = await getRequestNotionOAuthCookie()
  return NextResponse.json({
    connected: Boolean(token),
    source: token ? "oauth" : process.env.NOTION_API_KEY ? "env" : "none",
    workspaceName: oauthCookie?.workspaceName,
  })
}
