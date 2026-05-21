import { type NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import {
  NOTION_OAUTH_STATE_COOKIE,
  NOTION_TOKEN_COOKIE,
  notionOAuthStateCookieOptions,
  notionTokenCookieOptions,
  serializeNotionOAuthCookie,
} from "@/lib/notion-token"
import { clearTokenCaches } from "@/lib/notion-retriever"

interface NotionOAuthTokenResponse {
  access_token: string
  bot_id?: string
  workspace_id?: string
  workspace_name?: string
}

function getBaseUrl(req: NextRequest) {
  return process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin
}

function redirectHome(req: NextRequest, params: Record<string, string>) {
  const url = new URL("/", getBaseUrl(req))
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return NextResponse.redirect(url)
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const code = url.searchParams.get("code")
  const state = url.searchParams.get("state")
  const error = url.searchParams.get("error")

  if (error) return redirectHome(req, { notion: "error", reason: error })
  if (!code || !state) return redirectHome(req, { notion: "error", reason: "missing_code" })

  const store = await cookies()
  const expectedState = store.get(NOTION_OAUTH_STATE_COOKIE)?.value
  store.set(NOTION_OAUTH_STATE_COOKIE, "", { ...notionOAuthStateCookieOptions(), maxAge: 0 })

  if (!expectedState || expectedState !== state) {
    return redirectHome(req, { notion: "error", reason: "state_mismatch" })
  }

  const clientId = process.env.NOTION_OAUTH_CLIENT_ID
  const clientSecret = process.env.NOTION_OAUTH_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    return redirectHome(req, { notion: "error", reason: "missing_oauth_env" })
  }

  const redirectUri =
    process.env.NOTION_OAUTH_REDIRECT_URI || `${getBaseUrl(req)}/api/vaultmind/connect/callback`
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64")

  try {
    const res = await fetch("https://api.notion.com/v1/oauth/token", {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      }),
      cache: "no-store",
    })

    if (!res.ok) {
      const text = await res.text().catch(() => "")
      console.error("[v0] Notion OAuth token exchange failed:", res.status, text.slice(0, 240))
      return redirectHome(req, { notion: "error", reason: "token_exchange_failed" })
    }

    const data = (await res.json()) as NotionOAuthTokenResponse
    if (!data.access_token) {
      return redirectHome(req, { notion: "error", reason: "missing_access_token" })
    }

    const existing = store.get(NOTION_TOKEN_COOKIE)?.value
    if (existing) clearTokenCaches(existing)

    store.set(
      NOTION_TOKEN_COOKIE,
      serializeNotionOAuthCookie({
        accessToken: data.access_token,
        workspaceId: data.workspace_id,
        workspaceName: data.workspace_name,
        botId: data.bot_id,
      }),
      notionTokenCookieOptions(),
    )
    clearTokenCaches(data.access_token)

    return redirectHome(req, { notion: "connected" })
  } catch (err) {
    console.error("[v0] Notion OAuth callback failed:", err)
    return redirectHome(req, { notion: "error", reason: "callback_failed" })
  }
}
