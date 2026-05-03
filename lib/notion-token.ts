import { cookies } from "next/headers"

export const NOTION_TOKEN_COOKIE = "vm_notion_token"
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30 // 30 days

/** Read the per-user Notion token from the request cookies. */
export async function getRequestNotionToken(): Promise<string | null> {
  const store = await cookies()
  const value = store.get(NOTION_TOKEN_COOKIE)?.value
  return value && value.length > 8 ? value : null
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
