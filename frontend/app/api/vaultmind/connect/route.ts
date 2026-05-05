import { type NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import { notionFetch } from "@/lib/notion-client"
import {
  NOTION_TOKEN_COOKIE,
  notionTokenCookieOptions,
} from "@/lib/notion-token"
import { clearTokenCaches } from "@/lib/notion-retriever"

interface NotionSearchProbe {
  results: { id: string }[]
}

export async function POST(req: NextRequest) {
  let body: { token?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 })
  }

  const token = (body.token ?? "").trim()
  if (!token) {
    return NextResponse.json({ ok: false, error: "Token is required" }, { status: 400 })
  }
  if (!/^(secret_|ntn_)/.test(token)) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "That doesn't look like a Notion Internal Integration Secret. It should start with 'secret_' or 'ntn_'.",
      },
      { status: 400 },
    )
  }

  // Probe the token by hitting /search — verifies auth before saving cookie.
  try {
    const probe = await notionFetch<NotionSearchProbe>(
      "/search",
      { method: "POST", body: { page_size: 1 } },
      token,
    )
    const pagesFound = probe.results.length

    const store = await cookies()
    store.set(NOTION_TOKEN_COOKIE, token, notionTokenCookieOptions())
    clearTokenCaches(token)

    return NextResponse.json({
      ok: true,
      pagesFound,
      message:
        pagesFound > 0
          ? `Connected. ${pagesFound}+ page(s) accessible.`
          : "Token is valid, but no pages have been shared with this integration yet.",
    })
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: "Notion rejected the token.",
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 401 },
    )
  }
}

export async function DELETE() {
  const store = await cookies()
  const existing = store.get(NOTION_TOKEN_COOKIE)?.value
  if (existing) clearTokenCaches(existing)
  store.set(NOTION_TOKEN_COOKIE, "", { ...notionTokenCookieOptions(), maxAge: 0 })
  return NextResponse.json({ ok: true })
}

export async function GET() {
  const store = await cookies()
  const token = store.get(NOTION_TOKEN_COOKIE)?.value
  return NextResponse.json({
    connected: Boolean(token),
    source: token ? "user-token" : process.env.NOTION_API_KEY ? "env" : "none",
  })
}
