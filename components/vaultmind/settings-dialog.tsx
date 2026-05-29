"use client"

import { useEffect, useMemo, useState } from "react"
import type { ReactNode } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Loader2, Sun, Moon } from "lucide-react"
import { useTheme } from "next-themes"

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  showFullGraph: boolean
  onShowFullGraphChange: (v: boolean) => void
  workspaceLabel?: string
  workspaceConnected?: boolean
  onLlmSettingsChange?: () => void
}

type LlmProvider = "auto" | "openai" | "anthropic" | "gemini" | "openrouter" | "nim" | "ollama"

const PROVIDERS: Array<{ value: LlmProvider; label: string; hint: string }> = [
  { value: "auto", label: "Auto", hint: "Use the best available saved key or env fallback, then deterministic mode." },
  { value: "openai", label: "OpenAI", hint: "api.openai.com" },
  { value: "anthropic", label: "Anthropic", hint: "Claude API" },
  { value: "gemini", label: "Google Gemini", hint: "AI Studio API" },
  { value: "openrouter", label: "OpenRouter", hint: "OpenAI-compatible aggregator" },
  { value: "nim", label: "NVIDIA NIM", hint: "integrate.api.nvidia.com" },
  { value: "ollama", label: "Ollama", hint: "Local, no key needed" },
]

const MODEL_OPTIONS: Record<LlmProvider, Array<{ value: string; label: string }>> = {
  auto: [{ value: "Auto choose", label: "Auto choose" }],
  openai: [
    { value: "gpt-4.1-mini", label: "GPT-4.1 Mini" },
    { value: "gpt-4.1", label: "GPT-4.1" },
    { value: "gpt-4.1-nano", label: "GPT-4.1 Nano" },
    { value: "gpt-4o", label: "GPT-4o" },
    { value: "gpt-4o-mini", label: "GPT-4o Mini" },
    { value: "o4-mini", label: "o4 Mini" },
    { value: "o3", label: "o3" },
    { value: "o3-mini", label: "o3 Mini" },
  ],
  anthropic: [
    { value: "claude-sonnet-4-20250514", label: "Claude Sonnet 4" },
    { value: "claude-opus-4-20250514", label: "Claude Opus 4" },
    { value: "claude-3-7-sonnet-latest", label: "Claude 3.7 Sonnet" },
    { value: "claude-3-5-sonnet-latest", label: "Claude 3.5 Sonnet" },
    { value: "claude-3-5-haiku-latest", label: "Claude 3.5 Haiku" },
  ],
  gemini: [
    { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
    { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
    { value: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite" },
    { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
    { value: "gemini-2.0-flash-lite", label: "Gemini 2.0 Flash Lite" },
    { value: "gemini-1.5-pro", label: "Gemini 1.5 Pro" },
    { value: "gemini-1.5-flash", label: "Gemini 1.5 Flash" },
  ],
  openrouter: [
    { value: "openai/gpt-4o-mini", label: "GPT-4o Mini" },
    { value: "openai/gpt-4.1-mini", label: "GPT-4.1 Mini" },
    { value: "anthropic/claude-sonnet-4", label: "Claude Sonnet 4" },
    { value: "anthropic/claude-3.7-sonnet", label: "Claude 3.7 Sonnet" },
    { value: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash" },
    { value: "meta-llama/llama-3.1-70b-instruct", label: "Llama 3.1 70B Instruct" },
    { value: "mistralai/mistral-large", label: "Mistral Large" },
    { value: "qwen/qwen-2.5-72b-instruct", label: "Qwen 2.5 72B Instruct" },
  ],
  nim: [
    { value: "meta/llama-3.1-70b-instruct", label: "Llama 3.1 70B Instruct" },
    { value: "meta/llama-3.1-405b-instruct", label: "Llama 3.1 405B Instruct" },
    { value: "nvidia/llama-3.1-nemotron-70b-instruct", label: "Nemotron 70B Instruct" },
    { value: "mistralai/mixtral-8x22b-instruct-v0.1", label: "Mixtral 8x22B Instruct" },
    { value: "google/gemma-2-27b-it", label: "Gemma 2 27B" },
  ],
  ollama: [
    { value: "llama3.1", label: "Llama 3.1" },
    { value: "llama3.2", label: "Llama 3.2" },
    { value: "mistral", label: "Mistral" },
    { value: "qwen2.5", label: "Qwen 2.5" },
    { value: "qwen2.5-coder", label: "Qwen 2.5 Coder" },
    { value: "gemma2", label: "Gemma 2" },
    { value: "phi3", label: "Phi-3" },
  ],
}

interface PublicLlmSettings {
  provider: LlmProvider
  model: string
  hasKey: Record<Exclude<LlmProvider, "auto" | "ollama">, boolean>
}

export function SettingsDialog({
  open,
  onOpenChange,
  showFullGraph,
  onShowFullGraphChange,
  workspaceLabel,
  workspaceConnected,
  onLlmSettingsChange,
}: SettingsDialogProps) {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  const [llmSettings, setLlmSettings] = useState<PublicLlmSettings | null>(null)
  const [provider, setProvider] = useState<LlmProvider>("auto")
  const [model, setModel] = useState("")
  const [autoKeyProvider, setAutoKeyProvider] = useState<Exclude<LlmProvider, "auto" | "ollama">>("openai")
  const [apiKey, setApiKey] = useState("")
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setStatus(null)
    fetch("/api/vaultmind/llm-settings", { cache: "no-store" })
      .then(res => res.json())
      .then((data: PublicLlmSettings) => {
        if (cancelled) return
        setLlmSettings(data)
        setProvider(data.provider)
        setModel(data.model || MODEL_OPTIONS[data.provider][0]?.value || "")
        setApiKey("")
      })
      .catch(() => setStatus("Couldn't load saved LLM settings."))
    return () => {
      cancelled = true
    }
  }, [open])

  const modelOptions = useMemo(() => MODEL_OPTIONS[provider], [provider])
  const keyProvider = provider === "auto"
    ? autoKeyProvider
    : provider !== "ollama"
      ? provider
      : null
  const selectedProvider = PROVIDERS.find(p => p.value === provider) ?? PROVIDERS[0]
  const selectedKeyProvider = PROVIDERS.find(p => p.value === keyProvider)
  const selectedHasKey = keyProvider ? Boolean(llmSettings?.hasKey[keyProvider]) : false
  const selectedModelLabel = provider === "auto"
    ? "Auto choose"
    : modelOptions.find(item => item.value === model)?.label ?? model

  const saveLlmSettings = async () => {
    setSaving(true)
    setStatus(null)
    try {
      const keys = keyProvider && apiKey.trim() ? { [keyProvider]: apiKey.trim() } : {}
      const res = await fetch("/api/vaultmind/llm-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, model, keys }),
      })
      if (!res.ok) throw new Error(`Status ${res.status}`)
      const data = (await res.json()) as PublicLlmSettings
      setLlmSettings(data)
      setApiKey("")
      setStatus("Saved. Future answers and graph linking will use this setting.")
      onLlmSettingsChange?.()
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Failed to save settings.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-1rem)] max-w-lg max-h-[calc(100dvh-1rem)] overflow-y-auto bg-background border-border p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold tracking-tight">Settings</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Configure how Graphyne queries your workspace and renders the graph.
          </DialogDescription>
        </DialogHeader>

        <Accordion type="multiple" defaultValue={[]} className="py-1">
          <AccordionItem value="appearance">
            <AccordionTrigger className="py-3 hover:no-underline">
              <div>
                <div>Appearance</div>
                <p className="mt-0.5 text-[11px] font-normal text-muted-foreground">
                  {mounted && resolvedTheme === "light" ? "Light" : "Dark"} theme - Graphyne brand colors
                </p>
              </div>
            </AccordionTrigger>
            <AccordionContent className="space-y-4 pb-3">
              <Row
                label="Light mode"
                hint="Switch between Graphyne's light and dark themes."
              >
                <div className="flex items-center gap-2">
                  <Moon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                  <Switch
                    checked={mounted && resolvedTheme === "light"}
                    onCheckedChange={checked => setTheme(checked ? "light" : "dark")}
                    aria-label="Use light mode"
                  />
                  <Sun className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                </div>
              </Row>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="llm">
            <AccordionTrigger className="py-3 hover:no-underline">
              <div>
                <div>Provider and model</div>
                <p className="mt-0.5 text-[11px] font-normal text-muted-foreground">
                  {selectedProvider.label} - {selectedModelLabel || "No model selected"}
                </p>
              </div>
            </AccordionTrigger>
            <AccordionContent className="space-y-3 pb-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Provider">
                  <Select
                    value={provider}
                    onValueChange={value => {
                      const next = value as LlmProvider
                      setProvider(next)
                      setModel(next === "auto" ? "" : MODEL_OPTIONS[next][0]?.value ?? "")
                      setApiKey("")
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PROVIDERS.map(item => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground">{selectedProvider.hint}</p>
                </Field>

                <Field label="Model">
                  <Select
                    value={provider === "auto" ? "Auto choose" : model}
                    onValueChange={value => setModel(value === "Auto choose" ? "" : value)}
                    disabled={provider === "auto"}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Choose model" />
                    </SelectTrigger>
                    <SelectContent>
                      {modelOptions.map(item => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>

              {provider === "auto" && (
                <Field
                  label="Key to save"
                  hint="Auto can store any provider key and will use saved keys before env fallbacks."
                >
                  <Select
                    value={autoKeyProvider}
                    onValueChange={value =>
                      setAutoKeyProvider(value as Exclude<LlmProvider, "auto" | "ollama">)
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PROVIDERS.filter(item => item.value !== "auto" && item.value !== "ollama").map(item => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}

              {keyProvider ? (
                <Field
                  label={`${selectedKeyProvider?.label ?? selectedProvider.label} API key`}
                  hint={
                    selectedHasKey
                      ? "A key is already saved in an HTTP-only cookie. Enter a new one only to replace it."
                      : "Stored in an HTTP-only cookie for this browser."
                  }
                >
                  <Input
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    value={apiKey}
                    onChange={e => setApiKey(e.target.value)}
                    placeholder={selectedHasKey ? "Saved key present" : "Paste API key"}
                    className="font-mono text-xs"
                  />
                </Field>
              ) : (
                <p className="rounded-md border border-border bg-card px-3 py-2 text-[11px] text-muted-foreground">
                  {provider === "ollama"
                    ? "Ollama uses your local server and does not need an API key."
                    : "Auto mode uses any saved user key first, then environment fallbacks with a short timeout."}
                </p>
              )}

              <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] text-muted-foreground">
                  No usable LLM key means Graphyne tries fast fallbacks, then uses traditional synthesis.
                </p>
                <Button size="sm" onClick={saveLlmSettings} disabled={saving}>
                  {saving && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
                  Save
                </Button>
              </div>
              {status && <p className="text-[11px] text-muted-foreground">{status}</p>}
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="graph">
            <AccordionTrigger className="py-3 hover:no-underline">
              <div>
                <div>Graph display</div>
                <p className="mt-0.5 text-[11px] font-normal text-muted-foreground">
                  Full graph {showFullGraph ? "on" : "off"}
                </p>
              </div>
            </AccordionTrigger>
            <AccordionContent className="space-y-4 pb-3">
              <Row
                label="Show full workspace graph"
                hint="Always render every page in the graph. When off, only the focused subgraph for the current query is shown."
              >
                <Switch
                  checked={showFullGraph}
                  onCheckedChange={onShowFullGraphChange}
                  aria-label="Show full workspace graph"
                />
              </Row>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="workspace">
            <AccordionTrigger className="py-3 hover:no-underline">
              <div>
                <div>Workspace</div>
                <p className="mt-0.5 text-[11px] font-normal text-muted-foreground">
                  {workspaceLabel ?? "Not connected"}
                </p>
              </div>
            </AccordionTrigger>
            <AccordionContent className="pb-3">
              <Row label="Workspace" hint="Connected via MCP / Notion API.">
                <span className="text-xs text-foreground/80 flex items-center gap-1.5">
                  <span
                    className={
                      "h-1.5 w-1.5 rounded-full " +
                      (workspaceConnected ? "bg-green-500" : "bg-muted-foreground/40")
                    }
                    aria-hidden
                  />
                  {workspaceLabel ?? "Not connected"}
                </span>
              </Row>
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        <DialogFooter>
          <Button size="sm" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium">{label}</Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground leading-relaxed">{hint}</p>}
    </div>
  )
}

function Row({
  label,
  hint,
  children,
}: {
  label: string
  hint: string
  children: ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex-1 min-w-0">
        <Label className="text-sm font-medium">{label}</Label>
        <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">{hint}</p>
      </div>
      <div className="shrink-0 pt-0.5">{children}</div>
    </div>
  )
}
