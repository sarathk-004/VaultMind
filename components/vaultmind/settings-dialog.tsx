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
import { Brain, Check, Eye, Loader2, LogOut, Moon, Palette, Plug, Sun } from "lucide-react"
import { ConfirmDialog } from "@/components/vaultmind/confirm-dialog"
import { StatusDialog } from "@/components/vaultmind/status-dialog"
import { useTheme } from "next-themes"
import { cn } from "@/lib/utils"

export type SettingsSection = "appearance" | "models" | "graph" | "workspace"

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialSection?: SettingsSection
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
  initialSection,
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
  const [saved, setSaved] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const [logoutError, setLogoutError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setStatus(null)
    fetch("/api/vaultmind/llm-settings", { cache: "no-store", credentials: "include" })
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
  const availableProviders = PROVIDERS.filter(item =>
    item.value !== "auto" &&
    item.value !== "ollama" &&
    Boolean(llmSettings?.hasKey[item.value as Exclude<LlmProvider, "auto" | "ollama">]),
  )
  const hasAnyKey = availableProviders.length > 0
  const preferenceLabel = selectedKeyProvider?.label ?? availableProviders[0]?.label
  const providerSummary = !hasAnyKey && provider !== "ollama"
    ? "No models added"
    : provider === "ollama"
      ? `Ollama - ${selectedModelLabel || "Local"}`
      : provider === "auto"
        ? availableProviders.length > 1
          ? `Auto · preference: ${preferenceLabel ?? "Provider"}`
          : `Auto · ${preferenceLabel ?? "Provider"}`
        : `${selectedProvider.label} - ${selectedModelLabel || "No model selected"}`

  const saveLlmSettings = async () => {
    setSaving(true)
    setStatus(null)
    try {
      const keys = keyProvider && apiKey.trim() ? { [keyProvider]: apiKey.trim() } : {}
      const res = await fetch("/api/vaultmind/llm-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ provider, model, keys }),
      })
      if (!res.ok) throw new Error(`Status ${res.status}`)
      const data = (await res.json()) as PublicLlmSettings
      setLlmSettings(data)
      setApiKey("")
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      onLlmSettingsChange?.()
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Failed to save settings.")
    } finally {
      setSaving(false)
    }
  }

  const deleteLlmKey = async (targetProvider: string) => {
    setSaving(true)
    setStatus(null)
    try {
      const res = await fetch("/api/vaultmind/llm-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          provider,
          model,
          keys: { [targetProvider]: null },
        }),
      })
      if (!res.ok) throw new Error(`Status ${res.status}`)
      const data = (await res.json()) as PublicLlmSettings
      setLlmSettings(data)
      setApiKey("")
      setStatus("Key deleted successfully.")
      onLlmSettingsChange?.()
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Failed to delete key.")
    } finally {
      setSaving(false)
    }
  }

  const handleLogout = async () => {
    setLoggingOut(true)
    setLogoutError(null)
    try {
      const res = await fetch("/api/vaultmind/connect", { method: "DELETE" })
      if (!res.ok) throw new Error(`Status ${res.status}`)
      window.location.assign("/login")
    } catch (err) {
      setLogoutError(err instanceof Error ? err.message : "Failed to log out.")
      setLoggingOut(false)
    }
  }

  const section = initialSection ?? "appearance"
  const sectionMeta: Record<SettingsSection, { title: string; description: string; icon: typeof Palette }> = {
    appearance: {
      title: "Appearance",
      description: "Switch the interface theme.",
      icon: Palette,
    },
    models: {
      title: "Models",
      description: "Choose the provider and model Graphyne uses for answers and linking.",
      icon: Brain,
    },
    graph: {
      title: "Graph display",
      description: "Control how much of the workspace graph is visible by default.",
      icon: Eye,
    },
    workspace: {
      title: "Workspace",
      description: "Review or clear this browser's Notion connection.",
      icon: Plug,
    },
  }
  const SectionIcon = sectionMeta[section].icon

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-1rem)] max-w-lg max-h-[calc(100dvh-1rem)] overflow-y-auto bg-background border-border p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-semibold tracking-tight">
            <SectionIcon className="h-4 w-4 text-muted-foreground" aria-hidden />
            {sectionMeta[section].title}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {sectionMeta[section].description}
          </DialogDescription>
        </DialogHeader>

        {section === "appearance" && (
          <div className="space-y-4 py-2">
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
          </div>
        )}

        {section === "models" && (
          <div className="space-y-3 py-2">
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
                      ? undefined
                      : "Stored in an HTTP-only cookie for this browser."
                  }
                >
                  <div className="relative flex items-center">
                    <Input
                      type="password"
                      autoComplete="off"
                      spellCheck={false}
                      value={apiKey}
                      onChange={e => setApiKey(e.target.value)}
                      placeholder={selectedHasKey ? "Saved key present" : "Paste API key"}
                      className="font-mono text-xs pr-20"
                    />
                    {selectedHasKey && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => deleteLlmKey(keyProvider)}
                        className="absolute right-1 h-7 text-[10px] font-semibold text-destructive hover:bg-destructive/10 hover:text-destructive focus:ring-0"
                        disabled={saving}
                      >
                        Delete key
                      </Button>
                    )}
                  </div>
                </Field>
              ) : (
                <p className="rounded-md border border-border bg-card px-3 py-2 text-[11px] text-muted-foreground">
                  {provider === "ollama"
                    ? "Ollama uses your local server and does not need an API key."
                    : "Auto mode uses any saved user key first, then environment fallbacks with a short timeout."}
                </p>
              )}

              <div className="flex items-center justify-between gap-3 mt-4">
                <p className="text-[11px] text-muted-foreground text-left max-w-[70%] leading-normal">
                  {selectedHasKey && "A key is already saved in an HTTP-only cookie. Enter a new one only to replace it."}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={saveLlmSettings}
                  disabled={saving || saved}
                  className={cn(
                    "shrink-0 transition-all duration-300",
                    saved && "border-green-500 bg-green-50/10 text-green-500 dark:bg-green-950/20 dark:text-green-400"
                  )}
                >
                  {saving ? (
                    <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                  ) : saved ? (
                    <span className="flex items-center gap-1.5 animate-in fade-in zoom-in-75 duration-200">
                      <Check className="h-3.5 w-3.5" /> Saved!
                    </span>
                  ) : (
                    "Save"
                  )}
                </Button>
              </div>
              {status && <p className="text-[11px] text-muted-foreground">{status}</p>}
          </div>
        )}

        {section === "graph" && (
          <div className="space-y-4 py-2">
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
          </div>
        )}

        {section === "workspace" && (
          <div className="py-2">
              <div className="space-y-4">
                <Row label="Workspace" hint="Connected through your Notion authorization.">
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

                <Row
                  label="Log out"
                  hint="Clear this browser's Notion authorization and return to sign in."
                >
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={handleLogout}
                    disabled={loggingOut}
                  >
                    {loggingOut ? (
                      <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                    ) : (
                      <LogOut className="mr-1.5 h-3 w-3" aria-hidden />
                    )}
                    Log out
                  </Button>
                </Row>
                {logoutError && <p className="text-[11px] text-destructive">{logoutError}</p>}
              </div>
          </div>
        )}

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
