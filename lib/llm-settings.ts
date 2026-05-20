import { cookies } from "next/headers"

export const LLM_SETTINGS_COOKIE = "vm_llm_settings"
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30

export const LLM_PROVIDERS = [
  "auto",
  "openai",
  "anthropic",
  "gemini",
  "openrouter",
  "nim",
  "ollama",
] as const

export type LlmProvider = (typeof LLM_PROVIDERS)[number]
export type KeyedLlmProvider = Exclude<LlmProvider, "auto" | "ollama">

export interface LlmSettings {
  provider: LlmProvider
  model: string
  keys: Partial<Record<KeyedLlmProvider, string>>
}

export const DEFAULT_MODELS: Record<LlmProvider, string> = {
  auto: "",
  openai: "gpt-4.1-mini",
  anthropic: "claude-sonnet-4-20250514",
  gemini: "gemini-2.5-flash",
  openrouter: "openai/gpt-4o-mini",
  nim: "meta/llama-3.1-70b-instruct",
  ollama: "llama3.1",
}

export function llmSettingsCookieOptions() {
  return {
    httpOnly: true as const,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: COOKIE_MAX_AGE_SECONDS,
  }
}

export async function getRequestLlmSettings(): Promise<LlmSettings> {
  const store = await cookies()
  return parseSettingsCookie(store.get(LLM_SETTINGS_COOKIE)?.value)
}

export async function getPublicLlmSettings() {
  const settings = await getRequestLlmSettings()
  return {
    provider: settings.provider,
    model: settings.model,
    hasKey: {
      openai: Boolean(settings.keys.openai),
      anthropic: Boolean(settings.keys.anthropic),
      gemini: Boolean(settings.keys.gemini),
      openrouter: Boolean(settings.keys.openrouter),
      nim: Boolean(settings.keys.nim),
    },
  }
}

export function sanitizeProvider(value: unknown): LlmProvider {
  return typeof value === "string" && (LLM_PROVIDERS as readonly string[]).includes(value)
    ? (value as LlmProvider)
    : "auto"
}

export function normalizeLlmSettings(input: unknown, previous?: LlmSettings): LlmSettings {
  const obj = input && typeof input === "object" ? input as Record<string, unknown> : {}
  const provider = sanitizeProvider(obj.provider)
  const rawModel = typeof obj.model === "string" ? obj.model.trim() : ""
  const model = rawModel || DEFAULT_MODELS[provider]
  const rawKeys = obj.keys && typeof obj.keys === "object" ? obj.keys as Record<string, unknown> : {}
  const prevKeys = previous?.keys ?? {}
  const keys: LlmSettings["keys"] = { ...prevKeys }

  for (const providerKey of ["openai", "anthropic", "gemini", "openrouter", "nim"] as const) {
    if (!(providerKey in rawKeys)) continue
    const value = rawKeys[providerKey]
    if (value === null || value === "") {
      delete keys[providerKey]
    } else if (typeof value === "string") {
      const trimmed = value.trim()
      if (trimmed) keys[providerKey] = trimmed
    }
  }

  return { provider, model, keys }
}

export function hasUserLlmKey(settings: LlmSettings): boolean {
  if (settings.provider === "ollama") return true
  if (settings.provider === "auto") return Object.values(settings.keys).some(Boolean)
  return Boolean(settings.keys[settings.provider])
}

export function serializeSettingsCookie(settings: LlmSettings): string {
  return Buffer.from(JSON.stringify(settings), "utf8").toString("base64url")
}

function parseSettingsCookie(value?: string): LlmSettings {
  if (!value) return { provider: "auto", model: DEFAULT_MODELS.auto, keys: {} }
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"))
    return normalizeLlmSettings(parsed)
  } catch {
    return { provider: "auto", model: DEFAULT_MODELS.auto, keys: {} }
  }
}
