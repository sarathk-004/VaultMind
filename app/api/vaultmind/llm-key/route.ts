import { type NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import {
  ANTHROPIC_KEY_COOKIE,
  GEMINI_KEY_COOKIE,
  LLM_MODEL_COOKIE,
  LLM_PROVIDER_COOKIE,
  NIM_KEY_COOKIE,
  OPENAI_KEY_COOKIE,
  OPENROUTER_KEY_COOKIE,
  getRequestLlmSettings,
  llmKeyCookieOptions,
  type LlmProvider,
} from "@/lib/llm-key"

type KeyStatus = {
  hasKey: boolean
  source: "user" | "env" | "none"
  keyPreview: string
}

function keyPreview(value: string | null | undefined): string {
  if (!value) return "NOT SET"
  if (value.length <= 10) return `${value.slice(0, 3)}...${value.slice(-2)}`
  return `${value.slice(0, 6)}...${value.slice(-4)}`
}

function buildKeyStatus(userKey: string | null | undefined, envKey: string | null | undefined): KeyStatus {
  const effective = userKey ?? envKey ?? null
  const source = userKey ? "user" : envKey ? "env" : "none"
  return {
    hasKey: Boolean(effective),
    source,
    keyPreview: keyPreview(effective),
  }
}

const PROVIDERS = new Set<LlmProvider>([
  "auto",
  "openrouter",
  "openai",
  "anthropic",
  "gemini",
  "nim",
  "ollama",
  "github-models",
  "gateway",
])

export async function GET() {
  const settings = await getRequestLlmSettings()
  const openRouterEnv = process.env.OPENROUTER_API_KEY || process.env.OPEN_ROUTER_API_KEY
  const openAiEnv = process.env.OPENAI_API_KEY || process.env.OPENAI_KEY
  const anthropicEnv = process.env.ANTHROPIC_API_KEY
  const geminiEnv =
    process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GOOGLE_AI_API_KEY
  const nimEnv = process.env.NVIDIA_NIM_API_KEY

  const keys = {
    openrouter: buildKeyStatus(settings.keys?.openrouter ?? null, openRouterEnv),
    openai: buildKeyStatus(settings.keys?.openai ?? null, openAiEnv),
    anthropic: buildKeyStatus(settings.keys?.anthropic ?? null, anthropicEnv),
    gemini: buildKeyStatus(settings.keys?.gemini ?? null, geminiEnv),
    nim: buildKeyStatus(settings.keys?.nim ?? null, nimEnv),
  }

  return NextResponse.json({
    provider: settings.provider ?? null,
    model: settings.model ?? null,
    keys,
  })
}

export async function POST(req: NextRequest) {
  let body: {
    provider?: string
    model?: string
    keys?: {
      openrouter?: string | null
      openai?: string | null
      anthropic?: string | null
      gemini?: string | null
      nim?: string | null
    }
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 })
  }

  const store = await cookies()

  if (body.provider !== undefined) {
    const value = (body.provider ?? "").trim().toLowerCase()
    if (value && !PROVIDERS.has(value as LlmProvider)) {
      return NextResponse.json({ ok: false, error: "Unsupported provider" }, { status: 400 })
    }
    if (!value || value === "auto") {
      store.set(LLM_PROVIDER_COOKIE, "", { ...llmKeyCookieOptions(), maxAge: 0 })
    } else {
      store.set(LLM_PROVIDER_COOKIE, value, llmKeyCookieOptions())
    }
  }

  if (body.model !== undefined) {
    const model = (body.model ?? "").trim()
    if (!model) {
      store.set(LLM_MODEL_COOKIE, "", { ...llmKeyCookieOptions(), maxAge: 0 })
    } else {
      store.set(LLM_MODEL_COOKIE, model, llmKeyCookieOptions())
    }
  }

  const keys = body.keys ?? {}
  const maybeSet = (cookie: string, value?: string | null) => {
    if (value === undefined) return
    const trimmed = (value ?? "").trim()
    if (!trimmed) {
      store.set(cookie, "", { ...llmKeyCookieOptions(), maxAge: 0 })
    } else {
      store.set(cookie, trimmed, llmKeyCookieOptions())
    }
  }

  maybeSet(OPENROUTER_KEY_COOKIE, keys.openrouter)
  maybeSet(OPENAI_KEY_COOKIE, keys.openai)
  maybeSet(ANTHROPIC_KEY_COOKIE, keys.anthropic)
  maybeSet(GEMINI_KEY_COOKIE, keys.gemini)
  maybeSet(NIM_KEY_COOKIE, keys.nim)

  return NextResponse.json({ ok: true })
}

export async function DELETE() {
  const store = await cookies()
  const opts = { ...llmKeyCookieOptions(), maxAge: 0 }
  store.set(OPENROUTER_KEY_COOKIE, "", opts)
  store.set(OPENAI_KEY_COOKIE, "", opts)
  store.set(ANTHROPIC_KEY_COOKIE, "", opts)
  store.set(GEMINI_KEY_COOKIE, "", opts)
  store.set(NIM_KEY_COOKIE, "", opts)
  store.set(LLM_PROVIDER_COOKIE, "", opts)
  store.set(LLM_MODEL_COOKIE, "", opts)
  return NextResponse.json({ ok: true })
}
