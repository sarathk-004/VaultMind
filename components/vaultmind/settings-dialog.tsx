"use client"

import { useEffect, useState } from "react"
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

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  showFullGraph: boolean
  onShowFullGraphChange: (v: boolean) => void
  graphMotion: boolean
  onGraphMotionChange: (v: boolean) => void
  workspaceLabel?: string
  workspaceConnected?: boolean
}

interface KeyStatus {
  hasKey: boolean
  source: "user" | "env" | "none"
  keyPreview: string
}

interface LlmSettingsResponse {
  provider: string | null
  model: string | null
  keys: {
    openrouter: KeyStatus
    openai: KeyStatus
    anthropic: KeyStatus
    gemini: KeyStatus
    nim: KeyStatus
  }
}

export function SettingsDialog({
  open,
  onOpenChange,
  showFullGraph,
  onShowFullGraphChange,
  graphMotion,
  onGraphMotionChange,
  workspaceLabel,
  workspaceConnected,
}: SettingsDialogProps) {
  const [llmStatus, setLlmStatus] = useState<LlmSettingsResponse | null>(null)
  const [llmLoading, setLlmLoading] = useState(false)
  const [llmProvider, setLlmProvider] = useState("auto")
  const [llmModel, setLlmModel] = useState("")
  const [openRouterKey, setOpenRouterKey] = useState("")
  const [openAiKey, setOpenAiKey] = useState("")
  const [anthropicKey, setAnthropicKey] = useState("")
  const [geminiKey, setGeminiKey] = useState("")
  const [nimKey, setNimKey] = useState("")
  const [llmBusy, setLlmBusy] = useState(false)
  const [llmError, setLlmError] = useState<string | null>(null)
  const [llmSuccess, setLlmSuccess] = useState<string | null>(null)

  const refreshLlmStatus = async () => {
    setLlmLoading(true)
    try {
      const res = await fetch("/api/vaultmind/llm-key", { cache: "no-store" })
      const data = (await res.json()) as LlmSettingsResponse
      setLlmStatus(data)
      setLlmProvider(data.provider ?? "auto")
      setLlmModel(data.model ?? "")
    } catch (err) {
      setLlmStatus(null)
      setLlmError(err instanceof Error ? err.message : String(err))
    } finally {
      setLlmLoading(false)
    }
  }

  useEffect(() => {
    if (open) {
      setLlmError(null)
      setLlmSuccess(null)
      void refreshLlmStatus()
    }
  }, [open])

  const handleSaveLlmSettings = async () => {
    setLlmBusy(true)
    setLlmError(null)
    setLlmSuccess(null)

    const keys: {
      openrouter?: string
      openai?: string
      anthropic?: string
      gemini?: string
      nim?: string
    } = {}

    if (openRouterKey.trim()) keys.openrouter = openRouterKey.trim()
    if (openAiKey.trim()) keys.openai = openAiKey.trim()
    if (anthropicKey.trim()) keys.anthropic = anthropicKey.trim()
    if (geminiKey.trim()) keys.gemini = geminiKey.trim()
    if (nimKey.trim()) keys.nim = nimKey.trim()

    try {
      const res = await fetch("/api/vaultmind/llm-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: llmProvider,
          model: llmModel,
          keys: Object.keys(keys).length > 0 ? keys : undefined,
        }),
      })
      const data = (await res.json()) as { ok: boolean; error?: string }
      if (!data.ok) {
        setLlmError(data.error ?? "Failed to save settings")
      } else {
        setLlmSuccess("LLM settings saved for this browser.")
        setOpenRouterKey("")
        setOpenAiKey("")
        setAnthropicKey("")
        setGeminiKey("")
        setNimKey("")
        await refreshLlmStatus()
      }
    } catch (err) {
      setLlmError(err instanceof Error ? err.message : String(err))
    } finally {
      setLlmBusy(false)
    }
  }

  const handleClearKey = async (provider: "openrouter" | "openai" | "anthropic" | "gemini" | "nim") => {
    setLlmBusy(true)
    setLlmError(null)
    setLlmSuccess(null)
    try {
      await fetch("/api/vaultmind/llm-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keys: { [provider]: "" } }),
      })
      setLlmSuccess("LLM key cleared.")
      await refreshLlmStatus()
    } catch (err) {
      setLlmError(err instanceof Error ? err.message : String(err))
    } finally {
      setLlmBusy(false)
    }
  }

  const formatKeyStatus = (status?: KeyStatus) => {
    if (!status) return "Status: unknown"
    if (!status.hasKey) return "Status: not set"
    return `Status: ${status.source} (${status.keyPreview})`
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg w-[95vw] max-h-[85vh] overflow-y-auto bg-background border-border">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold tracking-tight">Settings</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Configure how VaultMind queries your workspace and renders the graph.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 py-2">
          <Accordion type="single" collapsible defaultValue="graph" className="w-full">
            <AccordionItem value="graph">
              <AccordionTrigger>Graph options</AccordionTrigger>
              <AccordionContent>
                <div className="grid gap-3">
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

                  <Row
                    label="Animate graph layout"
                    hint="Smoothly tween nodes when the graph changes."
                  >
                    <Switch
                      checked={graphMotion}
                      onCheckedChange={onGraphMotionChange}
                      aria-label="Animate graph layout"
                    />
                  </Row>

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
                </div>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="llm">
              <AccordionTrigger>LLM provider & model</AccordionTrigger>
              <AccordionContent>
                <div className="rounded-md border border-border bg-card p-3 space-y-3">
                  <div>
                    <Label className="text-sm font-medium">Provider</Label>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Choose the provider and optional model override for chat and graph runs.
                    </p>
                  </div>
                  <div className="grid gap-2">
                    <div className="flex items-center justify-between gap-3">
                      <Label className="text-xs font-medium">Provider</Label>
                      <Select value={llmProvider} onValueChange={setLlmProvider}>
                        <SelectTrigger size="sm" className="min-w-40 text-xs">
                          <SelectValue placeholder="Auto" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="auto">Auto (env defaults)</SelectItem>
                          <SelectItem value="openrouter">OpenRouter</SelectItem>
                          <SelectItem value="openai">OpenAI</SelectItem>
                          <SelectItem value="anthropic">Anthropic</SelectItem>
                          <SelectItem value="gemini">Gemini</SelectItem>
                          <SelectItem value="nim">NVIDIA NIM</SelectItem>
                          <SelectItem value="ollama">Ollama (local)</SelectItem>
                          <SelectItem value="github-models">GitHub Models</SelectItem>
                          <SelectItem value="gateway">AI Gateway</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <Label className="text-xs font-medium">Model</Label>
                      <Input
                        type="text"
                        autoComplete="off"
                        spellCheck={false}
                        placeholder="Leave blank to use defaults"
                        value={llmModel}
                        onChange={e => setLlmModel(e.target.value)}
                        disabled={llmBusy}
                        className="h-8 text-xs"
                        aria-label="LLM model override"
                      />
                    </div>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Keys are pulled from your saved entries first, then server defaults.
                  </p>
                </div>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="keys">
              <AccordionTrigger>LLM API keys</AccordionTrigger>
              <AccordionContent>
                <div className="rounded-md border border-border bg-card p-3 space-y-3">
                  <div>
                    <Label className="text-sm font-medium">LLM API keys</Label>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Stored in an HTTP-only cookie for this browser only. Leave blank to keep existing.
                    </p>
                  </div>

                  <KeyRow
                    label="OpenRouter API key"
                    placeholder="sk-or-..."
                    value={openRouterKey}
                    onChange={setOpenRouterKey}
                    status={formatKeyStatus(llmStatus?.keys.openrouter)}
                    onClear={() => handleClearKey("openrouter")}
                    disabled={llmBusy}
                  />
                  <KeyRow
                    label="OpenAI API key"
                    placeholder="sk-..."
                    value={openAiKey}
                    onChange={setOpenAiKey}
                    status={formatKeyStatus(llmStatus?.keys.openai)}
                    onClear={() => handleClearKey("openai")}
                    disabled={llmBusy}
                  />
                  <KeyRow
                    label="Anthropic API key"
                    placeholder="sk-ant-..."
                    value={anthropicKey}
                    onChange={setAnthropicKey}
                    status={formatKeyStatus(llmStatus?.keys.anthropic)}
                    onClear={() => handleClearKey("anthropic")}
                    disabled={llmBusy}
                  />
                  <KeyRow
                    label="Gemini API key"
                    placeholder="AIza..."
                    value={geminiKey}
                    onChange={setGeminiKey}
                    status={formatKeyStatus(llmStatus?.keys.gemini)}
                    onClear={() => handleClearKey("gemini")}
                    disabled={llmBusy}
                  />
                  <KeyRow
                    label="NVIDIA NIM API key"
                    placeholder="nvapi-..."
                    value={nimKey}
                    onChange={setNimKey}
                    status={formatKeyStatus(llmStatus?.keys.nim)}
                    onClear={() => handleClearKey("nim")}
                    disabled={llmBusy}
                  />

                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-muted-foreground">
                      {llmLoading ? "Checking keys..." : "Ready"}
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={handleSaveLlmSettings}
                      disabled={llmBusy}
                      className="h-7 px-2 text-[11px]"
                    >
                      Save settings
                    </Button>
                  </div>
                  {llmError && (
                    <div className="rounded-md border border-red-500/30 bg-red-500/5 p-2 text-[11px] text-red-300">
                      {llmError}
                    </div>
                  )}
                  {llmSuccess && (
                    <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2 text-[11px] text-emerald-200">
                      {llmSuccess}
                    </div>
                  )}
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>

        <DialogFooter>
          <Button size="sm" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Row({
  label,
  hint,
  children,
}: {
  label: string
  hint: string
  children: React.ReactNode
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

function KeyRow({
  label,
  placeholder,
  value,
  onChange,
  status,
  onClear,
  disabled,
}: {
  label: string
  placeholder: string
  value: string
  onChange: (next: string) => void
  status: string
  onClear: () => void
  disabled?: boolean
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs font-medium">{label}</Label>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onClear}
          disabled={disabled}
          className="h-6 px-2 text-[10px] text-muted-foreground hover:text-foreground"
        >
          Clear
        </Button>
      </div>
      <Input
        type="password"
        autoComplete="off"
        spellCheck={false}
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        className="font-mono text-xs"
      />
      <p className="text-[10px] text-muted-foreground">{status}</p>
    </div>
  )
}
