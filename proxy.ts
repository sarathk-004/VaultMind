import { NextResponse, type NextRequest } from "next/server"
import { NOTION_TOKEN_COOKIE } from "@/lib/notion-constants"

const LOGIN_PATH = "/login"

function isLoginRequired(): boolean {
  const flag = process.env.NEXT_PUBLIC_REQUIRE_NOTION_LOGIN
  if (process.env.NODE_ENV !== "production") return flag === "true"
  return flag !== "false"
}

function hasNotionToken(req: NextRequest): boolean {
  const value = req.cookies.get(NOTION_TOKEN_COOKIE)?.value
  return Boolean(value && value.length > 8)
}

export function proxy(req: NextRequest) {
  if (!isLoginRequired()) return NextResponse.next()

  const { pathname, search } = req.nextUrl
  const connected = hasNotionToken(req)

  if (pathname.startsWith(LOGIN_PATH)) {
    if (!connected) return NextResponse.next()
    const url = req.nextUrl.clone()
    url.pathname = "/"
    url.search = search
    return NextResponse.redirect(url)
  }

  if (connected) return NextResponse.next()

  const url = req.nextUrl.clone()
  url.pathname = LOGIN_PATH
  url.search = search
  return NextResponse.redirect(url)
}

export const config = {
  matcher: ["/((?!api|_next|favicon.ico|.*\\..*).*)"],
}
