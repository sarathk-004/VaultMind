/**
 * Unified LLM client with provider fallback.
 *
 * Provider order:
 *   1. NVIDIA NIM (MiniMax-M2.7) — used whenever NVIDIA_NIM_API_KEY is set.
 *      Free for the user, OpenAI-compatible API, hosted at
 *      https://integrate.api.nvidia.com/v1.
 *   2. Vercel AI Gateway (openai/gpt-5-mini) — fallback when NIM is missing,
 *      times out, or returns unparseable output.
 *
 * Why provider abstraction:
 *   - The page classifier and link-intent classifier both want
 *     STRUCTURED output validated by a Zod schema. NIM exposes a plain
 *     OpenAI-compatible chat endpoint and does NOT (reliably) support
 *     `response_format: json_schema`. So we ask for JSON via prompt
 *     instructions, then parse + Zod-validate. The AI Gateway path uses
 *     AI SDK's `Output.object`, which handles strict JSON schema natively.
 *   - Whichever path is taken, callers get the SAME shape back: a parsed
 *     object that already passed Zod validation. They never need to know
 *     which provider was used.
 *
 * Robustness notes:
 *   - NIM models commonly wrap JSON in ```json fences even when asked for
 *     "ONLY JSON". `extractJson` strips fences, isolates the outer
 *     {...}/[...] block, and tries one repair pass before giving up.
 *   - If NIM returns malformed JSON or fails Zod validation, we fall back
 *     to the AI Gateway for that single call (not the whole batch).
 *   - All calls accept an AbortSignal so callers' budget timers still
 *     work end-to-end.
 */

import OpenAI from "openai"
import { generateText, Output } from "ai"
import { z } from "zod"

const NIM_BASE_URL = "https://integrate.api.nvidia.com/v1"
const NIM_MODEL = "minimaxai/minimax-m2.7"
const GATEWAY_MODEL = "openai/gpt-5-mini"

// Lazy singleton — avoids constructing a client if no work is ever done.
let nimClient: OpenAI | null = null
function getNimClient(): OpenAI | null {
  const apiKey = process.env.NVIDIA_NIM_API_KEY
  if (!apiKey) return null
  if (!nimClient) {
    nimClient = new OpenAI({ apiKey, baseURL: NIM_BASE_URL })
  }
  return nimClient
}

export interface StructuredOptions<T> {
  /** Zod schema used to validate the parsed JSON output. */
  schema: z.ZodType<T>
  /** System prompt — describes the task and output schema in plain prose. */
  system: string
  /** User prompt — the actual content to classify / decide on. */
  prompt: string
  /** Caller-provided abort signal (e.g. from an overall budget timer). */
  signal?: AbortSignal
  /** Short label used only for logging which call failed. */
  label?: string
  /** Token cap for NIM. AI Gateway ignores this (handled by SDK defaults). */
  maxTokens?: number
}

/**
 * Generate structured output validated by `schema`. Tries NVIDIA NIM first
 * (when configured), then falls back to the AI Gateway.
 */
export async function generateStructured<T>(opts: StructuredOptions<T>): Promise<T> {
  const client = getNimClient()
  if (client) {
    try {
      return await callNim(client, opts)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(
        `[v0] NVIDIA NIM (${opts.label ?? "structured call"}) failed — ` +
          `falling back to AI Gateway: ${msg}`,
      )
    }
  }
  return await callGateway(opts)
}

// ── NIM (OpenAI-compatible) ─────────────────────────────────────────────────

async function callNim<T>(client: OpenAI, opts: StructuredOptions<T>): Promise<T> {
  // We append a reinforcement instruction to the user prompt so the model
  // emits JSON only. The system prompt already describes the schema in
  // detail; this just guards against decorative wrappers.
  const userMessage =
    `${opts.prompt}\n\n` +
    `Return ONLY a single valid JSON value that matches the schema described above. ` +
    `No markdown fences, no commentary, no preface. Begin with { or [.`

  const completion = await client.chat.completions.create(
    {
      model: NIM_MODEL,
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: userMessage },
      ],
      temperature: 0.2, // low — we want deterministic structured output
      top_p: 0.95,
      max_tokens: opts.maxTokens ?? 8192,
      stream: false,
    },
    { signal: opts.signal },
  )

  const raw = completion.choices?.[0]?.message?.content ?? ""
  if (!raw) throw new Error("NIM returned empty content")

  const json = extractJson(raw)
  return opts.schema.parse(json)
}

// ── Vercel AI Gateway ───────────────────────────────────────────────────────

async function callGateway<T>(opts: StructuredOptions<T>): Promise<T> {
  // AI SDK's structured output. The `as any` is needed because Output.object
  // is typed against a slightly narrower Zod constraint than ours.
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

// ── JSON extraction ─────────────────────────────────────────────────────────

/**
 * Best-effort extraction of a JSON value from a model's raw text response.
 * Handles:
 *   - markdown code fences (```json ... ``` or ``` ... ```)
 *   - leading/trailing prose ("Sure! Here's the JSON: { ... } Hope this helps!")
 *   - trailing commas inside arrays / objects (a common minor failure mode)
 */
function extractJson(raw: string): unknown {
  let s = raw.trim()

  // Strip code fences if present.
  const fenceMatch = s.match(/^```(?:json|JSON)?\s*([\s\S]*?)\s*```$/m)
  if (fenceMatch) {
    s = fenceMatch[1]!.trim()
  } else {
    // Sometimes only the opening fence is present.
    s = s.replace(/^```(?:json|JSON)?\s*/i, "").replace(/\s*```\s*$/i, "")
  }

  // Locate the outer { } or [ ] block. We pick whichever delimiter appears
  // first, then find its matching close by scanning from the end.
  const firstObj = s.indexOf("{")
  const firstArr = s.indexOf("[")
  let start = -1
  let openCh = ""
  let closeCh = ""
  if (firstObj >= 0 && (firstArr < 0 || firstObj < firstArr)) {
    start = firstObj
    openCh = "{"
    closeCh = "}"
  } else if (firstArr >= 0) {
    start = firstArr
    openCh = "["
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
    // One repair pass: strip trailing commas (`,}` and `,]`).
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
  return s.length <= n ? s : s.slice(0, n) + "…"
}

// ── Provider visibility (handy for logs) ────────────────────────────────────

export function activeLlmProvider(): "nvidia-nim" | "ai-gateway" {
  return process.env.NVIDIA_NIM_API_KEY ? "nvidia-nim" : "ai-gateway"
}
