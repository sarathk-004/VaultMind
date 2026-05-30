import { NextResponse } from "next/server"
import {
  getPublicLlmSettings,
  getRequestLlmSettings,
  llmSettingsCookieOptions,
  LLM_SETTINGS_COOKIE,
  normalizeLlmSettings,
  serializeSettingsCookie,
} from "@/lib/llm-settings"

export async function GET() {
  return NextResponse.json(await getPublicLlmSettings())
}

function isSecureRequest(req: Request): boolean {
  if (req.url.startsWith("https://")) return true
  const forwarded = req.headers.get("x-forwarded-proto")
  return forwarded === "https"
}

export async function POST(req: Request) {
  const previous = await getRequestLlmSettings()
  const settings = normalizeLlmSettings(await req.json(), previous)
  const cookieOptions = {
    ...llmSettingsCookieOptions(),
    secure: llmSettingsCookieOptions().secure && isSecureRequest(req),
  }
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

export async function DELETE(req: Request) {
  const cookieOptions = {
    ...llmSettingsCookieOptions(),
    secure: llmSettingsCookieOptions().secure && isSecureRequest(req),
  }
  const res = NextResponse.json({ ok: true })
  res.cookies.set(LLM_SETTINGS_COOKIE, "", {
    ...cookieOptions,
    maxAge: 0,
  })
  return res
}
