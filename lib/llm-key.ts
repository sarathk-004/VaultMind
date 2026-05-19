import { cookies } from "next/headers"

export type LlmProvider =
  | "auto"
  | "openrouter"
  | "openai"
  | "anthropic"
  | "gemini"
  | "nim"
  | "ollama"
  | "github-models"
  | "gateway"

export interface LlmKeySet {
  openrouter?: string | null
  openai?: string | null
  anthropic?: string | null
  gemini?: string | null
  nim?: string | null
}

export interface LlmSettings {
  provider?: LlmProvider | null
  model?: string | null
  keys?: LlmKeySet
}

export const OPENROUTER_KEY_COOKIE = "vm_openrouter_key"
export const OPENAI_KEY_COOKIE = "vm_openai_key"
export const ANTHROPIC_KEY_COOKIE = "vm_anthropic_key"
export const GEMINI_KEY_COOKIE = "vm_gemini_key"
export const NIM_KEY_COOKIE = "vm_nim_key"
export const LLM_PROVIDER_COOKIE = "vm_llm_provider"
export const LLM_MODEL_COOKIE = "vm_llm_model"

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30 // 30 days

export function llmKeyCookieOptions() {
  return {
    httpOnly: true as const,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: COOKIE_MAX_AGE_SECONDS,
  }
}

const PROVIDER_SET = new Set<LlmProvider>([
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

function coerceProvider(value?: string | null): LlmProvider | null {
  const v = (value ?? "").trim().toLowerCase()
  if (!v) return null
  return PROVIDER_SET.has(v as LlmProvider) ? (v as LlmProvider) : null
}

export async function getRequestLlmSettings(): Promise<LlmSettings> {
  try {
    const store = await cookies()
    return {
      provider: coerceProvider(store.get(LLM_PROVIDER_COOKIE)?.value),
      model: store.get(LLM_MODEL_COOKIE)?.value ?? null,
      keys: {
        openrouter: store.get(OPENROUTER_KEY_COOKIE)?.value ?? null,
        openai: store.get(OPENAI_KEY_COOKIE)?.value ?? null,
        anthropic: store.get(ANTHROPIC_KEY_COOKIE)?.value ?? null,
        gemini: store.get(GEMINI_KEY_COOKIE)?.value ?? null,
        nim: store.get(NIM_KEY_COOKIE)?.value ?? null,
      },
    }
  } catch {
    return { provider: null, model: null, keys: {} }
  }
}
