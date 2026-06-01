import { z } from "zod"
import {
  DEFAULT_MODELS,
  type KeyedLlmProvider,
  type LlmProvider,
  type LlmSettings,
} from "./llm-settings"

type LlmUseCase = "answer" | "linking"
type ProviderName = Exclude<LlmProvider, "auto">

interface GenerateStructuredArgs<T extends z.ZodTypeAny> {
  schema: T
  system: string
  prompt: string
  signal?: AbortSignal
  label?: string
  useCase?: LlmUseCase
  providerOverride?: LlmProvider | "github-models" | "gateway" | null
  modelOverride?: string | null
  keys?: Partial<Record<KeyedLlmProvider, string | null>>
}

interface ResolvedProvider {
  provider: ProviderName
  model: string
  apiKey?: string
}

export function activeLlmProvider(
  _useCase: LlmUseCase = "answer",
  opts: {
    providerOverride?: LlmProvider | "github-models" | "gateway" | null
    keys?: Partial<Record<KeyedLlmProvider, string | null>>
  } = {},
): ProviderName {
  return resolveProviderCandidates({
    provider: normalizeProviderAlias(opts.providerOverride ?? "auto"),
    model: "",
    keys: normalizeKeys(opts.keys),
  })[0].provider
}

export async function generateStructured<T extends z.ZodTypeAny>(
  args: GenerateStructuredArgs<T>,
): Promise<z.infer<T>> {
  const candidates = resolveProviderCandidates({
    provider: normalizeProviderAlias(args.providerOverride ?? "auto"),
    model: args.modelOverride ?? "",
    keys: normalizeKeys(args.keys),
  })
  const errors: string[] = []
  let raw: string | null = null
  for (const candidate of candidates) {
    try {
      raw = await callProvider(candidate, args.system, args.prompt, args.signal)
      break
    } catch (error) {
      errors.push(`${candidate.provider}: ${error instanceof Error ? error.message : String(error)}`)
      if (args.signal?.aborted) throw error
    }
  }
  if (raw === null) {
    throw new Error(`All LLM providers failed: ${errors.join("; ")}`)
  }
  const json = extractJson(raw)
  const parsed = JSON.parse(json)
  const result = args.schema.safeParse(parsed)
  if (!result.success) {
    throw new Error(`${args.label ?? "LLM"} returned invalid JSON: ${result.error.message}`)
  }
  return result.data
}

export function providerOptionsFromSettings(settings: LlmSettings): {
  providerOverride: LlmProvider
  modelOverride: string | null
  keys: Partial<Record<KeyedLlmProvider, string | null>>
} {
  return {
    providerOverride: settings.provider,
    modelOverride: settings.model || null,
    keys: settings.keys,
  }
}

function normalizeProviderAlias(
  provider: LlmProvider | "github-models" | "gateway" | null | undefined,
): LlmProvider {
  if (provider === "github-models" || provider === "gateway") return "auto"
  return provider ?? "auto"
}

function normalizeKeys(
  keys: Partial<Record<KeyedLlmProvider, string | null>> | undefined,
): Partial<Record<KeyedLlmProvider, string>> {
  return Object.fromEntries(
    Object.entries(keys ?? {}).filter((entry): entry is [KeyedLlmProvider, string] =>
      typeof entry[1] === "string" && entry[1].trim().length > 0,
    ),
  ) as Partial<Record<KeyedLlmProvider, string>>
}

function resolveProviderCandidates(settings: LlmSettings): ResolvedProvider[] {
  const envKey = {
    openai: process.env.OPENAI_API_KEY,
    anthropic: process.env.ANTHROPIC_API_KEY,
    gemini: process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? process.env.GEMINI_API_KEY,
    openrouter: process.env.OPENROUTER_API_KEY,
    nim: process.env.NVIDIA_API_KEY ?? process.env.NIM_API_KEY,
  } satisfies Record<KeyedLlmProvider, string | undefined>

  const ordered: ProviderName[] =
    settings.provider === "auto"
      ? ["openai", "anthropic", "gemini", "openrouter", "nim", "ollama"]
      : [settings.provider]

  const candidates: ResolvedProvider[] = []
  for (const provider of ordered) {
    const model = settings.provider === "auto"
      ? DEFAULT_MODELS[provider]
      : settings.model || DEFAULT_MODELS[provider]
    if (provider === "ollama") {
      candidates.push({ provider, model })
      continue
    }
    const key = settings.keys[provider] ?? envKey[provider]
    if (key) candidates.push({ provider, model, apiKey: key })
  }

  if (candidates.length === 0) throw new Error("No LLM API key configured")
  return candidates
}

async function callProvider(
  resolved: ResolvedProvider,
  system: string,
  prompt: string,
  signal?: AbortSignal,
): Promise<string> {
  switch (resolved.provider) {
    case "anthropic":
      return callAnthropic(resolved, system, prompt, signal)
    case "gemini":
      return callGemini(resolved, system, prompt, signal)
    case "ollama":
      return callOpenAiCompatible({
        ...resolved,
        baseUrl: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1",
      }, system, prompt, signal)
    case "openrouter":
      return callOpenAiCompatible({
        ...resolved,
        baseUrl: process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1",
      }, system, prompt, signal)
    case "nim":
      return callOpenAiCompatible({
        ...resolved,
        baseUrl: process.env.NVIDIA_NIM_BASE_URL ?? "https://integrate.api.nvidia.com/v1",
      }, system, prompt, signal)
    case "openai":
    default:
      return callOpenAiCompatible({
        ...resolved,
        baseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
      }, system, prompt, signal)
  }
}

async function callOpenAiCompatible(
  resolved: ResolvedProvider & { baseUrl: string },
  system: string,
  prompt: string,
  signal?: AbortSignal,
): Promise<string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (resolved.apiKey) headers.Authorization = `Bearer ${resolved.apiKey}`
  if (resolved.provider === "openrouter") {
    headers["HTTP-Referer"] = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
    headers["X-Title"] = "Graphyne"
  }

  const res = await fetch(`${resolved.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers,
    signal,
    body: JSON.stringify({
      model: resolved.model,
      messages: [
        { role: "system", content: `${system}\n\nReturn only valid JSON.` },
        { role: "user", content: prompt },
      ],
      temperature: 0.2,
      response_format: { type: "json_object" },
    }),
  })
  if (!res.ok) throw new Error(`${resolved.provider} failed with ${res.status}: ${await res.text()}`)
  const data = await res.json()
  const content = data?.choices?.[0]?.message?.content
  if (typeof content !== "string") throw new Error(`${resolved.provider} returned no text`)
  return content
}

async function callAnthropic(
  resolved: ResolvedProvider,
  system: string,
  prompt: string,
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": resolved.apiKey ?? "",
      "anthropic-version": "2023-06-01",
    },
    signal,
    body: JSON.stringify({
      model: resolved.model,
      max_tokens: 1200,
      temperature: 0.2,
      system: `${system}\n\nReturn only valid JSON.`,
      messages: [{ role: "user", content: prompt }],
    }),
  })
  if (!res.ok) throw new Error(`anthropic failed with ${res.status}: ${await res.text()}`)
  const data = await res.json()
  const text = data?.content?.map((part: { text?: string }) => part.text ?? "").join("")
  if (typeof text !== "string" || !text) throw new Error("anthropic returned no text")
  return text
}

async function callGemini(
  resolved: ResolvedProvider,
  system: string,
  prompt: string,
  signal?: AbortSignal,
): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(resolved.model)}:generateContent?key=${encodeURIComponent(resolved.apiKey ?? "")}`
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: `${system}\n\nReturn only valid JSON.` }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, responseMimeType: "application/json" },
    }),
  })
  if (!res.ok) throw new Error(`gemini failed with ${res.status}: ${await res.text()}`)
  const data = await res.json()
  const text = data?.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text ?? "").join("")
  if (typeof text !== "string" || !text) throw new Error("gemini returned no text")
  return text
}

function extractJson(text: string): string {
  const trimmed = text.trim()
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return trimmed
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced?.[1]) return fenced[1].trim()
  const firstObj = trimmed.indexOf("{")
  const lastObj = trimmed.lastIndexOf("}")
  if (firstObj >= 0 && lastObj > firstObj) return trimmed.slice(firstObj, lastObj + 1)
  throw new Error("LLM response did not include JSON")
}
