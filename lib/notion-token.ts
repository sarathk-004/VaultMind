import { cookies } from "next/headers"

export const NOTION_TOKEN_COOKIE = "vm_notion_token"
export const NOTION_OAUTH_STATE_COOKIE = "vm_notion_oauth_state"
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30 // 30 days
const STATE_COOKIE_MAX_AGE_SECONDS = 60 * 10 // 10 minutes

export interface NotionOAuthCookie {
  accessToken: string
  workspaceId?: string
  workspaceName?: string
  botId?: string
}

/** Read the per-user Notion token from the request cookies. */
export async function getRequestNotionToken(): Promise<string | null> {
  const store = await cookies()
  const value = store.get(NOTION_TOKEN_COOKIE)?.value
  if (!value || value.length <= 8) return null

  const oauthCookie = parseNotionOAuthCookie(value)
  if (oauthCookie?.accessToken) return oauthCookie.accessToken

  return value
}

export async function getRequestNotionOAuthCookie(): Promise<NotionOAuthCookie | null> {
  const store = await cookies()
  const value = store.get(NOTION_TOKEN_COOKIE)?.value
  if (!value) return null
  return parseNotionOAuthCookie(value)
}

export function serializeNotionOAuthCookie(auth: NotionOAuthCookie): string {
  return encodeURIComponent(JSON.stringify(auth))
}

export function parseNotionOAuthCookie(value: string): NotionOAuthCookie | null {
  try {
    const decoded = decodeURIComponent(value)
    const data = JSON.parse(decoded) as Partial<NotionOAuthCookie>
    if (typeof data.accessToken === "string" && data.accessToken.length > 8) {
      return {
        accessToken: data.accessToken,
        workspaceId: typeof data.workspaceId === "string" ? data.workspaceId : undefined,
        workspaceName: typeof data.workspaceName === "string" ? data.workspaceName : undefined,
        botId: typeof data.botId === "string" ? data.botId : undefined,
      }
    }
  } catch {
    // Legacy cookies stored the raw Notion token.
  }
  return null
}

export function notionTokenCookieOptions() {
  return {
    httpOnly: true as const,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: COOKIE_MAX_AGE_SECONDS,
  }
}

export function notionOAuthStateCookieOptions() {
  return {
    httpOnly: true as const,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: STATE_COOKIE_MAX_AGE_SECONDS,
  }
}
