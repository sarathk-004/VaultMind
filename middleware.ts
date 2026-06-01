import { NextRequest, NextResponse } from "next/server"
import { isLoginRequired } from "./lib/api-security"
import { NOTION_TOKEN_COOKIE } from "./lib/notion-constants"

function hasNotionToken(req: NextRequest): boolean {
  const token = req.cookies.get(NOTION_TOKEN_COOKIE)?.value
  return typeof token === "string" && token.trim().length > 8
}

export function middleware(req: NextRequest) {
  if (!isLoginRequired()) return NextResponse.next()

  if (hasNotionToken(req)) return NextResponse.next()

  const url = req.nextUrl.clone()
  url.pathname = "/login"
  return NextResponse.redirect(url)
}

export const config = {
  matcher: [
    "/((?!_next|api|login|opengraph-image|twitter-image|favicon.ico|robots.txt|sitemap.xml).*)",
  ],
}
