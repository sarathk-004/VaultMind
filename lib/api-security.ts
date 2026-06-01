import { type NextRequest, NextResponse } from "next/server"

const API_RATE_LIMIT_WINDOW_MS = 60_000
const DEFAULT_API_RATE_LIMIT = 30
const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>()

export function isLoginRequired(): boolean {
  const flag = process.env.NEXT_PUBLIC_REQUIRE_NOTION_LOGIN
  if (process.env.NODE_ENV !== "production") return flag === "true"
  if (typeof flag === "undefined") return true
  return flag === "true"
}

export function unauthorizedJson(message = "Authentication required") {
  return NextResponse.json({ error: message }, { status: 401 })
}

export function forbiddenJson(message = "Forbidden") {
  return NextResponse.json({ error: message }, { status: 403 })
}

export function requireAuthenticatedApi(token: string | null): NextResponse | null {
  if (!isLoginRequired()) return null
  return token ? null : unauthorizedJson()
}

export function requireWorkspaceId(workspaceId: string | null | undefined): NextResponse | null {
  if (process.env.NODE_ENV !== "production") return null
  return workspaceId ? null : forbiddenJson("workspace_id is required")
}

export function requireSameOrigin(req: Request): NextResponse | null {
  const origin = req.headers.get("origin")
  if (!origin) return null

  const expected = new URL(req.url).origin
  return origin === expected ? null : forbiddenJson("Cross-origin requests are not allowed")
}

export function requireSyncAuthorization(req: NextRequest): NextResponse | null {
  const secret = process.env.STACKER_SYNC_SECRET
  if (!secret) {
    return process.env.NODE_ENV === "production"
      ? forbiddenJson("STACKER_SYNC_SECRET is required in production")
      : requireSameOrigin(req)
  }

  const authorization = req.headers.get("authorization") ?? ""
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1]
  return token === secret ? null : forbiddenJson("Invalid sync authorization")
}

export function rateLimit(req: NextRequest, options?: { limit?: number; key?: string }): NextResponse | null {
  const limit = options?.limit ?? DEFAULT_API_RATE_LIMIT
  const forwardedFor = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
  const ip = forwardedFor || req.headers.get("x-real-ip") || "unknown"
  const key = `${options?.key ?? req.nextUrl.pathname}:${ip}`
  const now = Date.now()
  const bucket = rateLimitBuckets.get(key)

  if (!bucket || bucket.resetAt <= now) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + API_RATE_LIMIT_WINDOW_MS })
    return null
  }

  bucket.count += 1
  if (bucket.count <= limit) return null

  return NextResponse.json(
    { error: "Too many requests" },
    {
      status: 429,
      headers: {
        "Retry-After": Math.ceil((bucket.resetAt - now) / 1000).toString(),
      },
    },
  )
}
