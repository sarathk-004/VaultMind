import { type NextRequest, NextResponse } from "next/server"
import {
  getPublicLlmSettings,
  getRequestLlmSettings,
  llmSettingsCookieOptions,
  LLM_SETTINGS_COOKIE,
  normalizeLlmSettings,
  serializeSettingsCookie,
} from "@/lib/llm-settings"
import { rateLimit, requireSameOrigin } from "@/lib/api-security"

export async function GET() {
  return NextResponse.json(await getPublicLlmSettings())
}

export async function POST(req: NextRequest) {
  const originError = requireSameOrigin(req)
  if (originError) return originError

  const limited = rateLimit(req, { limit: 10 })
  if (limited) return limited

  const previous = await getRequestLlmSettings()
  const payload = await req.json().catch(() => null)
  if (!payload || typeof payload !== "object") {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  const settings = normalizeLlmSettings(payload, previous)
  const cookieOptions = llmSettingsCookieOptions()
  const res = NextResponse.json({
    ok: true,
    provider: settings.provider,
    model: settings.model,
    hasKey: {
      openai: Boolean(settings.keys.openai),
      anthropic: Boolean(settings.keys.anthropic),
      gemini: Boolean(settings.keys.gemini),
      openrouter: Boolean(settings.keys.openrouter),
      nim: Boolean(settings.keys.nim),
    },
  })
  res.cookies.set(
    LLM_SETTINGS_COOKIE,
    serializeSettingsCookie(settings),
    cookieOptions,
  )
  return res
}

export async function DELETE(req: NextRequest) {
  const originError = requireSameOrigin(req)
  if (originError) return originError

  const limited = rateLimit(req, { limit: 10 })
  if (limited) return limited

  const cookieOptions = llmSettingsCookieOptions()
  const res = NextResponse.json({ ok: true })
  res.cookies.set(LLM_SETTINGS_COOKIE, "", {
    ...cookieOptions,
    maxAge: 0,
  })
  return res
}
