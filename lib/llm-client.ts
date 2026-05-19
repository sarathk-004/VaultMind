/**
 * Unified LLM client with provider fallback.
 *
 * Provider order for linking tasks:
 *   1. Gemini (Google AI Studio) when GEMINI_API_KEY is set
 *   2. Ollama (local) when enabled via VAULTMIND_LLM_PROVIDER=auto|ollama
 *   3. NVIDIA NIM when NVIDIA_NIM_API_KEY is set
 *   4. Existing deterministic graph method (caller fallback)
 *
 * Provider order for non-linking tasks:
 *   1. Gemini when forced with VAULTMIND_LLM_PROVIDER=gemini
 *   2. NVIDIA NIM
 *   3. GitHub Models
 *   4. Vercel AI Gateway
 */

import OpenAI from "openai"
import { generateText, Output } from "ai"
import { z } from "zod"

type LlmProvider =
  | "auto"
  | "openrouter"
  | "openai"
  | "anthropic"
  | "gemini"
  | "nim"
  | "ollama"
  | "github-models"
  | "gateway"

type LlmKeySet = {
  openrouter?: string | null
  openai?: string | null
  anthropic?: string | null
  gemini?: string | null
  nim?: string | null
}

const NIM_BASE_URL = "https://integrate.api.nvidia.com/v1"
const NIM_MODEL = process.env.NVIDIA_NIM_MODEL || "google/gemma-2-2b-it"
const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "")
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini"
const ANTHROPIC_BASE_URL = (process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com/v1").replace(/\/+$/, "")
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-20240620"
const ANTHROPIC_VERSION = process.env.ANTHROPIC_VERSION || "2023-06-01"
const GEMINI_BASE_URL = (process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta").replace(/\/+$/, "")
const GEMINI_MODEL = process.env.GEMINI_MODEL || process.env.GOOGLE_GEMINI_MODEL || "gemini-2.5-flash"
const GEMINI_MAX_OUTPUT_TOKENS = Number(process.env.GEMINI_MAX_OUTPUT_TOKENS ?? "")
const GITHUB_MODELS_BASE_URL = process.env.GITHUB_MODELS_BASE_URL || "https://models.github.ai/inference"
const GITHUB_MODELS_MODEL = process.env.GITHUB_MODELS_MODEL || "openai/gpt-4o-mini"
const GATEWAY_MODEL = "openai/gpt-5-mini"

// OpenRouter configuration
const OPENROUTER_BASE_URL = process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1"
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || "gemma-31b"
const OPENROUTER_FALLBACK_BASE_URL = "https://api.openrouter.ai/v1"


const DEFAULT_OLLAMA_URL = "http://localhost:11434"
const DEFAULT_OLLAMA_MODEL = "mistral"
const DEFAULT_OLLAMA_MODELS = [
  "mistral",
  "qwen2.5:1.5b-instruct",
  "phi3:mini",
]
const DEFAULT_OLLAMA_TIMEOUT_MS = 45_000
const DEFAULT_NIM_MAX_TOKENS = 2048
const HARD_NIM_MAX_TOKENS = 4096
const DEFAULT_GEMINI_LINKING_MAX_TOKENS = 8192

// Gemini retry/circuit configuration
const GEMINI_MAX_RETRIES = Number(process.env.GEMINI_MAX_RETRIES ?? "3")
const GEMINI_INITIAL_BACKOFF_MS = Number(process.env.GEMINI_INITIAL_BACKOFF_MS ?? "500")
const GEMINI_CIRCUIT_OPEN_MS = Number(process.env.GEMINI_CIRCUIT_OPEN_MS ?? "60000")
const GEMINI_FAILURE_THRESHOLD = Number(process.env.GEMINI_FAILURE_THRESHOLD ?? "3")
const GEMINI_JITTER_PCT = 0.3

let geminiFailureCount = 0
let geminiOpenedAt = 0

function isGeminiCircuitOpen(): boolean {
  if (geminiOpenedAt === 0) return false
  if (Date.now() - geminiOpenedAt > GEMINI_CIRCUIT_OPEN_MS) {
    geminiOpenedAt = 0
    geminiFailureCount = 0
    return false
  }
  return true
}

function openGeminiCircuit() {
  geminiOpenedAt = Date.now()
  console.warn(`[v0] Gemini circuit opened for ${GEMINI_CIRCUIT_OPEN_MS}ms`)
  emitGeminiMetric("circuit_open", { openedAt: geminiOpenedAt })
}

function emitGeminiMetric(event: string, details?: unknown) {
  // Placeholder metric emitter; replace with real metrics/alerts if desired
  try {
    console.error(`[metric] gemini.${event}`, details ?? {})
  } catch {}
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function callGeminiWithRetries<T>(apiKey: string, model: string, opts: StructuredOptions<T>): Promise<T> {
  if (isGeminiCircuitOpen()) {
    throw new Error("Gemini is temporarily unavailable (circuit open)")
  }

  let lastErr: unknown = null
  const maxRetries = Math.max(0, GEMINI_MAX_RETRIES)
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const out = await callGemini(apiKey, model, opts)
      if (geminiFailureCount > 0) {
        geminiFailureCount = 0
        emitGeminiMetric("recovered", { attempt })
      }
      return out
    } catch (err) {
      lastErr = err
      const msg = err instanceof Error ? err.message : String(err)
      emitGeminiMetric("request_failed", { attempt, message: msg })

      // Only retry on transient 503 / UNAVAILABLE errors; surface others immediately
      const is503 = /HTTP 503|\b503\b|UNAVAILABLE/i.test(msg as string)
      if (!is503) throw err

      if (attempt === maxRetries) break

      // exponential backoff with jitter
      const backoff = GEMINI_INITIAL_BACKOFF_MS * Math.pow(2, attempt)
      const jitter = Math.round((Math.random() * 2 - 1) * GEMINI_JITTER_PCT * backoff)
      const wait = Math.max(0, Math.round(backoff + jitter))
      await sleep(wait)
    }
  }

  // After retries failed: increment failure counter and possibly open circuit
  geminiFailureCount++
  emitGeminiMetric("failure_count", { geminiFailureCount })
  if (geminiFailureCount >= GEMINI_FAILURE_THRESHOLD) {
    openGeminiCircuit()
  }

  throw lastErr
}

let nimClient: OpenAI | null = null
let nimClientKey = ""
function getNimClient(apiKey?: string | null): OpenAI | null {
  const key = (apiKey ?? process.env.NVIDIA_NIM_API_KEY ?? "").trim()
  if (!key) return null
  if (!nimClient || nimClientKey !== key) {
    nimClient = new OpenAI({ apiKey: key, baseURL: NIM_BASE_URL })
    nimClientKey = key
  }
  return nimClient
}

let openAiClient: OpenAI | null = null
let openAiClientKey = ""
let openAiClientBaseUrl = ""
function getOpenAiClient(apiKey: string, baseUrl = OPENAI_BASE_URL): OpenAI {
  const trimmedKey = apiKey.trim()
  if (!trimmedKey) throw new Error("OPENAI_API_KEY is missing or blank")
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "")
  if (!openAiClient || openAiClientKey !== trimmedKey || openAiClientBaseUrl !== normalizedBaseUrl) {
    openAiClient = new OpenAI({ apiKey: trimmedKey, baseURL: normalizedBaseUrl })
    openAiClientKey = trimmedKey
    openAiClientBaseUrl = normalizedBaseUrl
  }
  return openAiClient
}

let githubModelsClient: OpenAI | null = null
function getGitHubModelsClient(): OpenAI | null {
  const apiKey = process.env.GITHUB_MODELS_TOKEN || process.env.GITHUB_TOKEN
  if (!apiKey) return null
  if (!githubModelsClient) {
    githubModelsClient = new OpenAI({
      apiKey,
      baseURL: GITHUB_MODELS_BASE_URL,
      defaultHeaders: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    })
  }
  return githubModelsClient
}

let openRouterClient: OpenAI | null = null
let openRouterClientKey = ""
let openRouterClientBaseUrl = ""
function getOpenRouterClient(apiKey: string, baseUrl: string): OpenAI {
  const trimmedKey = apiKey.trim()
  if (!trimmedKey) throw new Error("OPENROUTER_API_KEY is missing or blank")
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "")
  if (
    !openRouterClient ||
    openRouterClientKey !== trimmedKey ||
    openRouterClientBaseUrl !== normalizedBaseUrl
  ) {
    openRouterClient = new OpenAI({
      apiKey: trimmedKey,
      baseURL: normalizedBaseUrl,
      defaultHeaders: {
        "HTTP-Referer": process.env.OPENROUTER_REFERER || "http://localhost:3000",
        "X-Title": process.env.OPENROUTER_TITLE || "VaultMind",
      },
    })
    openRouterClientKey = trimmedKey
    openRouterClientBaseUrl = normalizedBaseUrl
  }
  return openRouterClient
}

function getGeminiApiKey(): string | null {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GOOGLE_AI_API_KEY || null
}

function getOpenAiApiKey(): string | null {
  return process.env.OPENAI_API_KEY || process.env.OPENAI_KEY || null
}

function getAnthropicApiKey(): string | null {
  return process.env.ANTHROPIC_API_KEY || null
}

function getNimApiKey(): string | null {
  return process.env.NVIDIA_NIM_API_KEY || null
}

function getOpenRouterApiKey(): string | null {
  return process.env.OPENROUTER_API_KEY || process.env.OPEN_ROUTER_API_KEY || null
}

function getOpenRouterModel(): string {
  return process.env.OPENROUTER_MODEL || process.env.OPEN_ROUTER_MODEL || "google/gemma-3-27b-it:free"
}

function getOpenRouterBaseUrl(): string {
  return (process.env.OPENROUTER_BASE_URL || process.env.OPEN_ROUTER_BASE_URL || "https://openrouter.ai/api/v1").replace(/\/+$/, "")
}

function resolveModel(defaultModel: string, override?: string | null): string {
  const candidate = (override ?? "").trim()
  return candidate ? candidate : defaultModel
}

function logOpenRouterDebug(details: { baseUrl: string; model: string; keyLength: number }) {
  if (process.env.VAULTMIND_DEBUG_OPENROUTER !== "1") return
  console.log(
    `[v0] OpenRouter debug: baseUrl=${details.baseUrl}, model=${details.model}, keyLength=${details.keyLength}`,
  )
}

function resolveGeminiMaxOutputTokens(useCase: "linking" | "general", explicit?: number): number {
  if (Number.isFinite(explicit) && (explicit ?? 0) > 0) return explicit!

  const linkingEnv = Number(process.env.VAULTMIND_LINKING_MAX_TOKENS ?? "")
  if (useCase === "linking" && Number.isFinite(linkingEnv) && linkingEnv > 0) return linkingEnv

  if (Number.isFinite(GEMINI_MAX_OUTPUT_TOKENS) && GEMINI_MAX_OUTPUT_TOKENS > 0) return GEMINI_MAX_OUTPUT_TOKENS

  // Linking/classifier batches can be large; keep a higher default than 2048
  // to reduce JSON truncation and parse failures.
  if (useCase === "linking") return DEFAULT_GEMINI_LINKING_MAX_TOKENS

  return DEFAULT_NIM_MAX_TOKENS
}

export interface StructuredOptions<T> {
  schema: z.ZodType<T>
  system: string
  prompt: string
  signal?: AbortSignal
  label?: string
  maxTokens?: number
  useCase?: "linking" | "general"
  providerOverride?: LlmProvider | null
  modelOverride?: string | null
  keys?: LlmKeySet
}

export async function generateStructured<T>(opts: StructuredOptions<T>): Promise<T> {
  const useCase = opts.useCase ?? "general"
  const mode = (process.env.VAULTMIND_LLM_PROVIDER ?? "auto").toLowerCase()
  const providerOverride = (opts.providerOverride ?? "auto").toLowerCase() as LlmProvider
  const envForcedProvider: LlmProvider | null =
    mode === "openai" || mode === "anthropic" ? (mode as LlmProvider) : null
  const effectiveProviderOverride = providerOverride !== "auto" ? providerOverride : envForcedProvider
  const modelOverride = opts.modelOverride ?? null
  const keys = opts.keys ?? {}
  const forceGateway = mode === "gateway"
  const forceNim = mode === "nim"
  const forceGitHub = mode === "github" || mode === "github-models"
  const forceGemini = mode === "gemini" || mode === "google" || mode === "google-ai"
  const forceOllama = mode === "ollama" || mode === "local"
  const linking = useCase === "linking"
  const allowGemini =
    (linking && mode === "auto") ||
    forceGemini
  const allowOllama = linking && (mode === "auto" || forceOllama)

  const geminiKey = keys.gemini ?? getGeminiApiKey()
  const openRouterKey = keys.openrouter ?? getOpenRouterApiKey()
  const openAiKey = keys.openai ?? getOpenAiApiKey()
  const anthropicKey = keys.anthropic ?? getAnthropicApiKey()
  const nimKey = keys.nim ?? getNimApiKey()
  const openRouterModel = resolveModel(getOpenRouterModel(), modelOverride)
  const openRouterBaseUrl = getOpenRouterBaseUrl()
  const openAiModel = resolveModel(OPENAI_MODEL, modelOverride)
  const anthropicModel = resolveModel(ANTHROPIC_MODEL, modelOverride)
  const geminiModel = resolveModel(GEMINI_MODEL, modelOverride)
  const nimModel = resolveModel(NIM_MODEL, modelOverride)
  const forceOpenRouter = mode === "openrouter" || mode === "openrouter-gemma"
  const allowOpenRouter = forceOpenRouter || ((linking && mode === "auto") || forceOpenRouter)

  if (effectiveProviderOverride) {
    switch (effectiveProviderOverride) {
      case "openrouter": {
        if (!openRouterKey?.trim()) {
          throw new Error("OpenRouter provider selected but no API key is configured")
        }
        const out = await callOpenRouter(openRouterKey.trim(), openRouterModel, openRouterBaseUrl, opts)
        console.log(`[v0] LLM (${opts.label ?? "structured call"}): provider=openrouter`)
        return out
      }
      case "openai": {
        if (!openAiKey?.trim()) {
          throw new Error("OpenAI provider selected but no API key is configured")
        }
        const client = getOpenAiClient(openAiKey)
        const out = await callOpenAi(client, openAiModel, opts)
        console.log(`[v0] LLM (${opts.label ?? "structured call"}): provider=openai`)
        return out
      }
      case "anthropic": {
        if (!anthropicKey?.trim()) {
          throw new Error("Anthropic provider selected but no API key is configured")
        }
        const out = await callAnthropic(anthropicKey.trim(), anthropicModel, ANTHROPIC_BASE_URL, opts)
        console.log(`[v0] LLM (${opts.label ?? "structured call"}): provider=anthropic`)
        return out
      }
      case "gemini": {
        if (!geminiKey?.trim()) {
          throw new Error("Gemini provider selected but no API key is configured")
        }
        const out = await callGeminiWithRetries(geminiKey.trim(), geminiModel, opts)
        console.log(`[v0] LLM (${opts.label ?? "structured call"}): provider=gemini`)
        return out
      }
      case "nim": {
        const client = getNimClient(nimKey)
        if (!client) {
          throw new Error("NIM provider selected but NVIDIA_NIM_API_KEY is missing")
        }
        const out = await callNim(client, nimModel, opts)
        console.log(`[v0] LLM (${opts.label ?? "structured call"}): provider=nim`)
        return out
      }
      case "ollama": {
        const out = await callOllama(opts, modelOverride)
        console.log(`[v0] LLM (${opts.label ?? "structured call"}): provider=ollama`)
        return out
      }
      case "github-models": {
        const githubClient = getGitHubModelsClient()
        if (!githubClient) {
          throw new Error("GitHub Models provider selected but token is missing")
        }
        const out = await callGitHubModels(githubClient, resolveModel(GITHUB_MODELS_MODEL, modelOverride), opts)
        console.log(`[v0] LLM (${opts.label ?? "structured call"}): provider=github-models`)
        return out
      }
      case "gateway": {
        const out = await callGateway(opts)
        console.log(`[v0] LLM (${opts.label ?? "structured call"}): provider=gateway`)
        return out
      }
      default:
        break
    }
  }
  if (!forceGateway && !forceGitHub && !forceNim && !forceOllama && allowOpenRouter && openRouterKey?.trim()) {
    try {
      const out = await callOpenRouter(openRouterKey.trim(), openRouterModel, openRouterBaseUrl, opts)
      console.log(`[v0] LLM (${opts.label ?? "structured call"}): provider=openrouter`)
      return out
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(
        `[v0] OpenRouter (${opts.label ?? "structured call"}) failed - falling back: ${msg}`,
      )
      if (forceOpenRouter) {
        throw new Error(
          `OpenRouter-only mode failed for ${opts.label ?? "structured call"}: ${msg}`,
        )
      }
    }
  } else if (forceOpenRouter) {
    throw new Error("OpenRouter-only mode requested but no OpenRouter API key is configured")
  }
  if (!forceGateway && !forceGitHub && !forceNim && !forceOllama && allowGemini && geminiKey) {
    try {
      const out = await callGeminiWithRetries(geminiKey, geminiModel, opts)
      console.log(`[v0] LLM (${opts.label ?? "structured call"}): provider=gemini`)
      return out
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(
        `[v0] Gemini (${opts.label ?? "structured call"}) failed - falling back: ${msg}`,
      )
      if (forceGemini) {
        throw new Error(
          `Gemini-only mode failed for ${opts.label ?? "structured call"}: ${msg}`,
        )
      }
    }
  } else if (forceGemini) {
    throw new Error("Gemini-only mode requested but GEMINI_API_KEY is missing")
  }

  if (!forceGateway && !forceGitHub && allowOllama) {
    try {
      const out = await callOllama(opts, modelOverride)
      console.log(`[v0] LLM (${opts.label ?? "structured call"}): provider=ollama`)
      return out
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(
        `[v0] Ollama (${opts.label ?? "structured call"}) failed - falling back: ${msg}`,
      )
      if (forceOllama) {
        throw new Error(
          `Ollama-only mode failed for ${opts.label ?? "structured call"}: ${msg}`,
        )
      }
    }
  }

  const client = forceGateway || forceGitHub || forceGemini || forceOllama ? null : getNimClient(nimKey)
  if (client) {
    try {
      const out = await callNim(client, nimModel, opts)
      console.log(`[v0] LLM (${opts.label ?? "structured call"}): provider=nim`)
      return out
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(
        `[v0] NVIDIA NIM (${opts.label ?? "structured call"}) failed - falling back: ${msg}`,
      )
      if (forceNim) {
        throw new Error(
          `NIM-only mode failed for ${opts.label ?? "structured call"}: ${msg}`,
        )
      }
    }
  } else if (forceNim) {
    throw new Error("NIM-only mode requested but NVIDIA_NIM_API_KEY is missing")
  }

  if (linking && !forceGateway && !forceGitHub) {
    throw new Error(
      "No graph LLM provider succeeded; falling back to deterministic graph builder",
    )
  }

  const githubClient = forceGateway || forceNim ? null : getGitHubModelsClient()
  if (githubClient) {
    try {
      const out = await callGitHubModels(githubClient, resolveModel(GITHUB_MODELS_MODEL, modelOverride), opts)
      console.log(`[v0] LLM (${opts.label ?? "structured call"}): provider=github-models`)
      return out
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(
        `[v0] GitHub Models (${opts.label ?? "structured call"}) failed - falling back to gateway: ${msg}`,
      )
      if (forceGitHub) {
        throw new Error(
          `GitHub Models-only mode failed for ${opts.label ?? "structured call"}: ${msg}`,
        )
      }
    }
  } else if (forceGitHub) {
    throw new Error("GitHub Models-only mode requested but GITHUB_MODELS_TOKEN or GITHUB_TOKEN is missing")
  }

  const out = await callGateway(opts)
  console.log(`[v0] LLM (${opts.label ?? "structured call"}): provider=gateway`)
  return out
}

async function callGemini<T>(apiKey: string, model: string, opts: StructuredOptions<T>): Promise<T> {
  const userMessage =
    `${opts.prompt}\n\n` +
    `Return ONLY a single valid JSON value that matches the schema described above. ` +
    `No markdown fences, no commentary, no preface. Begin with { or [.`

  const modelName = model.replace(/^models\//, "")
  const useCase = opts.useCase ?? "general"
  const maxOutputTokens = resolveGeminiMaxOutputTokens(useCase, opts.maxTokens)
  const res = await fetch(`${GEMINI_BASE_URL}/models/${encodeURIComponent(modelName)}:generateContent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: opts.system }],
      },
      contents: [
        {
          role: "user",
          parts: [{ text: userMessage }],
        },
      ],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json",
        maxOutputTokens,
      },
    }),
    signal: opts.signal,
  })

  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(`HTTP ${res.status}: ${truncate(body, 300)}`)
  }

  const data = (await res.json()) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{ text?: string }>
      }
      finishReason?: string
    }>
    promptFeedback?: unknown
  }
  const raw = data.candidates?.[0]?.content?.parts
    ?.map(part => part.text ?? "")
    .join("")
    .trim()
  if (!raw) {
    const reason = data.candidates?.[0]?.finishReason
    throw new Error(`Gemini returned empty content${reason ? ` (${reason})` : ""}`)
  }
  const value = extractJson(raw)
  try {
    return opts.schema.parse(value)
  } catch (err) {
    // Gemini occasionally returns a bare JSON array even when asked for an
    // object wrapper. For our graph/linking calls we know the common wrappers.
    if (Array.isArray(value)) {
      try {
        return opts.schema.parse({ classifications: value })
      } catch (e1) {
        try {
          return opts.schema.parse({ results: value })
        } catch (e2) {
          // If it's an array of "issues" objects (code/expected/received/path),
          // surface a clearer error so logs don't look like our own Zod errors.
          const first = value[0]
          const looksLikeIssues =
            first &&
            typeof first === "object" &&
            "code" in (first as any) &&
            ("expected" in (first as any) || "received" in (first as any))
          if (looksLikeIssues) {
            throw new Error(
              `Gemini returned an error-like array instead of a schema object: ${truncate(JSON.stringify(first), 160)}`,
            )
          }
          // Prefer the wrapper parse error because it reflects the expected shape.
          throw (e1 instanceof Error ? e1 : e2)
        }
      }
    }
    throw err
  }
}

async function callOllama<T>(opts: StructuredOptions<T>, overrideModel?: string | null): Promise<T> {
  const base = (process.env.VAULTMIND_OLLAMA_URL ?? DEFAULT_OLLAMA_URL).replace(/\/+$/, "")
  const timeoutMs = Number(process.env.VAULTMIND_OLLAMA_TIMEOUT_MS ?? DEFAULT_OLLAMA_TIMEOUT_MS)
  const models = resolveOllamaModels(overrideModel)

  const timeoutController = new AbortController()
  const timer = setTimeout(
    () => timeoutController.abort(),
    Number.isFinite(timeoutMs) ? timeoutMs : DEFAULT_OLLAMA_TIMEOUT_MS,
  )
  const signal = composeSignals(opts.signal, timeoutController.signal)

  const userMessage =
    `${opts.prompt}\n\n` +
    `Return ONLY a single valid JSON value that matches the schema described above. ` +
    `No markdown fences, no commentary, no preface. Begin with { or [.`

  try {
    let lastError: string | null = null
    for (const model of models) {
      try {
        const out = await callSingleOllamaModel({
          base,
          model,
          system: opts.system,
          prompt: userMessage,
          signal,
        })
        if (models.length > 1) {
          console.log(
            `[v0] Ollama (${opts.label ?? "structured call"}): using model=${model}`,
          )
        }
        return opts.schema.parse(out)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        lastError = `${model}: ${msg}`
        console.warn(
          `[v0] Ollama (${opts.label ?? "structured call"}): model=${model} failed (${msg})`,
        )
      }
    }
    throw new Error(lastError ?? "all configured Ollama models failed")
  } finally {
    clearTimeout(timer)
  }
}

async function callSingleOllamaModel(opts: {
  base: string
  model: string
  system: string
  prompt: string
  signal: AbortSignal
}): Promise<unknown> {
  const res = await fetch(`${opts.base}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: opts.model,
      system: opts.system,
      prompt: opts.prompt,
      stream: false,
      options: { temperature: 0.2 },
    }),
    signal: opts.signal,
  })

  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(`HTTP ${res.status}: ${truncate(body, 200)}`)
  }

  const data = (await res.json()) as { response?: string }
  if (!data?.response) throw new Error("Ollama returned empty response")
  return extractJson(data.response)
}

function resolveOllamaModels(overrideModel?: string | null): string[] {
  const override = (overrideModel ?? "").trim()
  const preferred = override || (process.env.VAULTMIND_OLLAMA_MODEL ?? DEFAULT_OLLAMA_MODEL).trim()
  const configured = (process.env.VAULTMIND_OLLAMA_MODELS ?? "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean)

  const candidates = configured.length > 0 ? [preferred, ...configured] : [preferred, ...DEFAULT_OLLAMA_MODELS]
  const deduped: string[] = []
  const seen = new Set<string>()
  for (const c of candidates) {
    if (seen.has(c)) continue
    seen.add(c)
    deduped.push(c)
  }
  return deduped
}

async function callNim<T>(client: OpenAI, model: string, opts: StructuredOptions<T>): Promise<T> {
  const userMessage =
    `${opts.prompt}\n\n` +
    `Return ONLY a single valid JSON value that matches the schema described above. ` +
    `No markdown fences, no commentary, no preface. Begin with { or [.`

  const envNimMax = Number(process.env.NVIDIA_NIM_MAX_TOKENS ?? "")
  const configuredCap =
    Number.isFinite(envNimMax) && envNimMax > 0
      ? Math.min(envNimMax, HARD_NIM_MAX_TOKENS)
      : HARD_NIM_MAX_TOKENS
  const maxTokens = Math.min(opts.maxTokens ?? DEFAULT_NIM_MAX_TOKENS, configuredCap)

  try {
    const completion = await client.chat.completions.create(
      {
        model,
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: userMessage },
        ],
        temperature: 0.2,
        top_p: 0.95,
        max_tokens: maxTokens,
        stream: false,
      },
      { signal: opts.signal },
    )
    const raw = completion.choices?.[0]?.message?.content ?? ""
    if (!raw) throw new Error("NIM returned empty content")
    return opts.schema.parse(extractJson(raw))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (!/system role not supported/i.test(msg)) throw err
    // Some NIM-hosted models reject the "system" role. Retry with a single
    // user message that inlines system instructions.
    const mergedPrompt =
      `System instructions:\\n${opts.system}\\n\\n` +
      `User request:\\n${userMessage}`
    const completion = await client.chat.completions.create(
      {
        model,
        messages: [{ role: "user", content: mergedPrompt }],
        temperature: 0.2,
        top_p: 0.95,
        max_tokens: maxTokens,
        stream: false,
      },
      { signal: opts.signal },
    )
    const raw = completion.choices?.[0]?.message?.content ?? ""
    if (!raw) throw new Error("NIM returned empty content on systemless retry")
    return opts.schema.parse(extractJson(raw))
  }
}

async function callGitHubModels<T>(client: OpenAI, model: string, opts: StructuredOptions<T>): Promise<T> {
  const userMessage =
    `${opts.prompt}\n\n` +
    `Return ONLY a single valid JSON value that matches the schema described above. ` +
    `No markdown fences, no commentary, no preface. Begin with { or [.`

  const completion = await client.chat.completions.create(
    {
      model,
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: userMessage },
      ],
      temperature: 0.2,
      max_tokens: opts.maxTokens ?? DEFAULT_NIM_MAX_TOKENS,
      stream: false,
    },
    { signal: opts.signal },
  )

  const raw = completion.choices?.[0]?.message?.content ?? ""
  if (!raw) throw new Error("GitHub Models returned empty content")
  return opts.schema.parse(extractJson(raw))
}

async function callOpenAi<T>(client: OpenAI, model: string, opts: StructuredOptions<T>): Promise<T> {
  const userMessage =
    `${opts.prompt}\n\n` +
    `Return ONLY a single valid JSON value that matches the schema described above. ` +
    `No markdown fences, no commentary, no preface. Begin with { or [.`

  const completion = await client.chat.completions.create(
    {
      model,
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: userMessage },
      ],
      temperature: 0.2,
      max_tokens: opts.maxTokens ?? DEFAULT_NIM_MAX_TOKENS,
      stream: false,
    },
    { signal: opts.signal },
  )

  const raw = completion.choices?.[0]?.message?.content ?? ""
  if (!raw) throw new Error("OpenAI returned empty content")
  return opts.schema.parse(extractJson(raw))
}

async function callAnthropic<T>(apiKey: string, model: string, baseUrl: string, opts: StructuredOptions<T>): Promise<T> {
  const userMessage =
    `${opts.prompt}\n\n` +
    `Return ONLY a single valid JSON value that matches the schema described above. ` +
    `No markdown fences, no commentary, no preface. Begin with { or [.`

  const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model,
      system: opts.system,
      max_tokens: opts.maxTokens ?? DEFAULT_NIM_MAX_TOKENS,
      temperature: 0.2,
      messages: [{ role: "user", content: userMessage }],
    }),
    signal: opts.signal,
  })

  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(`HTTP ${res.status}: ${truncate(body, 300)}`)
  }

  const data = (await res.json().catch(() => ({} as any))) as {
    content?: Array<{ type?: string; text?: string }>
  }
  const raw =
    data.content
      ?.map(c => (c?.type === "text" ? c.text ?? "" : ""))
      .join("")
      .trim() ?? ""
  if (!raw) throw new Error("Anthropic returned empty content")
  return opts.schema.parse(extractJson(raw))
}

async function callOpenRouter<T>(apiKey: string, model: string, baseUrl: string, opts: StructuredOptions<T>): Promise<T> {
  const userMessage =
    `${opts.prompt}\n\n` +
    `Return ONLY a single valid JSON value that matches the schema described above. ` +
    `No markdown fences, no commentary, no preface. Begin with { or [.`

  let data: any
  try {
    const normalizedBaseUrl = baseUrl.replace(/\/+$/, "")
    logOpenRouterDebug({
      baseUrl: normalizedBaseUrl,
      model,
      keyLength: apiKey.trim().length,
    })
    const client = getOpenRouterClient(apiKey, normalizedBaseUrl)
    data = await client.chat.completions.create(
      {
        model,
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: userMessage },
        ],
        temperature: 0.2,
        max_tokens: opts.maxTokens ?? DEFAULT_NIM_MAX_TOKENS,
      },
      { signal: opts.signal },
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const normalizedBaseUrl = baseUrl.replace(/\/+$/, "")
    const shouldRetryAuth = /Missing Authentication header/i.test(msg)
    const alreadyApiHost = /api\.openrouter\.ai/i.test(normalizedBaseUrl)
    if (shouldRetryAuth && !alreadyApiHost) {
      try {
        const retryBaseUrl = OPENROUTER_FALLBACK_BASE_URL
        logOpenRouterDebug({
          baseUrl: retryBaseUrl,
          model,
          keyLength: apiKey.trim().length,
        })
        const retryClient = getOpenRouterClient(apiKey, retryBaseUrl)
        data = await retryClient.chat.completions.create({
          model,
          messages: [
            { role: "system", content: opts.system },
            { role: "user", content: userMessage },
          ],
          temperature: 0.2,
          max_tokens: opts.maxTokens ?? DEFAULT_NIM_MAX_TOKENS,
        })
      } catch (retryErr) {
        const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr)
        throw new Error(
          `OpenRouter request failed (${normalizedBaseUrl} -> ${OPENROUTER_FALLBACK_BASE_URL}, model=${model}): ${retryMsg}`,
        )
      }
    } else {
      throw new Error(`OpenRouter request failed (${normalizedBaseUrl}, model=${model}): ${msg}`)
    }
  }

  const raw =
    (data.choices?.[0]?.message?.content as string) ||
    (data.choices?.[0]?.text as string) ||
    (data.output?.[0]?.content as string) ||
    ""
  if (!raw) throw new Error(`OpenRouter returned empty content (model=${model})`)
  return opts.schema.parse(extractJson(raw))
}

async function callGateway<T>(opts: StructuredOptions<T>): Promise<T> {
  const { output } = await generateText({
    model: GATEWAY_MODEL,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    output: Output.object({ schema: opts.schema as any }),
    system: opts.system,
    prompt: opts.prompt,
    abortSignal: opts.signal,
  })
  return output as T
}

function extractJson(raw: string): unknown {
  let s = raw.trim()

  const fenceMatch = s.match(/^```(?:json|JSON)?\s*([\s\S]*?)\s*```$/m)
  if (fenceMatch) {
    s = fenceMatch[1]!.trim()
  } else {
    s = s.replace(/^```(?:json|JSON)?\s*/i, "").replace(/\s*```\s*$/i, "")
  }

  const firstObj = s.indexOf("{")
  const firstArr = s.indexOf("[")
  let start = -1
  let closeCh = ""
  if (firstObj >= 0 && (firstArr < 0 || firstObj < firstArr)) {
    start = firstObj
    closeCh = "}"
  } else if (firstArr >= 0) {
    start = firstArr
    closeCh = "]"
  }

  if (start < 0) {
    throw new Error(`No JSON object/array found in model output: ${truncate(raw, 200)}`)
  }
  const end = s.lastIndexOf(closeCh)
  if (end <= start) {
    throw new Error(`Malformed JSON (no closing ${closeCh}) in model output`)
  }

  const candidate = s.slice(start, end + 1)
  try {
    return JSON.parse(candidate)
  } catch {
    const repaired = candidate.replace(/,(\s*[}\]])/g, "$1")
    try {
      return JSON.parse(repaired)
    } catch (err) {
      throw new Error(
        `JSON parse failed: ${err instanceof Error ? err.message : String(err)}. ` +
          `Snippet: ${truncate(candidate, 200)}`,
      )
    }
  }
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n) + "..."
}

function composeSignals(...sigs: Array<AbortSignal | undefined>): AbortSignal {
  const ctrl = new AbortController()
  for (const s of sigs) {
    if (!s) continue
    if (s.aborted) {
      ctrl.abort()
      break
    }
    s.addEventListener("abort", () => ctrl.abort(), { once: true })
  }
  return ctrl.signal
}

export function activeLlmProvider(
  useCase: "linking" | "general" = "general",
  options?: { providerOverride?: LlmProvider | null; keys?: LlmKeySet },
):
  | "openrouter"
  | "openai"
  | "anthropic"
  | "gemini"
  | "ollama"
  | "nvidia-nim"
  | "github-models"
  | "ai-gateway"
  | "deterministic" {
  const mode = (process.env.VAULTMIND_LLM_PROVIDER ?? "auto").toLowerCase()
  const providerOverride = (options?.providerOverride ?? "auto").toLowerCase() as LlmProvider
  if (providerOverride && providerOverride !== "auto") {
    if (providerOverride === "nim") return "nvidia-nim"
    return providerOverride === "gateway" ? "ai-gateway" : providerOverride
  }

  const openRouterKey = options?.keys?.openrouter?.trim() || getOpenRouterApiKey()
  const geminiKey = options?.keys?.gemini?.trim() || getGeminiApiKey()
  const openAiKey = options?.keys?.openai?.trim() || getOpenAiApiKey()
  const anthropicKey = options?.keys?.anthropic?.trim() || getAnthropicApiKey()
  const nimKey = options?.keys?.nim?.trim() || getNimApiKey()

  if (mode === "openrouter" || mode === "openrouter-gemma") return "openrouter"
  if (mode === "openai") return "openai"
  if (mode === "anthropic") return "anthropic"
  if (mode === "gemini" || mode === "google" || mode === "google-ai") return "gemini"
  if (mode === "ollama" || mode === "local") return "ollama"
  if (mode === "github" || mode === "github-models") return "github-models"
  if (mode === "nim") return "nvidia-nim"
  if (mode === "gateway") return "ai-gateway"

  if (useCase === "linking" && openRouterKey) return "openrouter"
  if (useCase === "linking" && geminiKey) return "gemini"
  if (useCase === "linking") return "ollama"

  if (nimKey) return "nvidia-nim"
  if (openAiKey) return "openai"
  if (anthropicKey) return "anthropic"
  if (process.env.GITHUB_MODELS_TOKEN || process.env.GITHUB_TOKEN) return "github-models"
  return "ai-gateway"
}
