import { NextResponse, type NextRequest } from "next/server"
import { NOTION_TOKEN_COOKIE } from "@/lib/notion-token"

const LOGIN_PATH = "/login"

function hasNotionToken(req: NextRequest): boolean {
  const value = req.cookies.get(NOTION_TOKEN_COOKIE)?.value
  return Boolean(value && value.length > 8)
}

export function middleware(req: NextRequest) {
  if (process.env.NODE_ENV !== "production") return NextResponse.next()

  const { pathname, search } = req.nextUrl
  if (pathname.startsWith(LOGIN_PATH)) return NextResponse.next()

  if (hasNotionToken(req)) return NextResponse.next()

  const url = req.nextUrl.clone()
  url.pathname = LOGIN_PATH
  url.search = search
  return NextResponse.redirect(url)
}

export const config = {
  matcher: ["/((?!api|_next|favicon.ico|.*\\..*).*)"],
}
