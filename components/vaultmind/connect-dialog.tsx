"use client"

import { useEffect, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  CheckCircle2,
  AlertCircle,
  Loader2,
  ExternalLink,
  Plug,
  PlugZap,
} from "lucide-react"

interface ConnectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called after successful connect / disconnect so the parent can re-fetch the workspace. */
  onConnectionChange: () => void
}

interface DebugStatus {
  ok: boolean
  hasKey: boolean
  tokenSource: "user" | "env" | "none"
  keyPreview?: string
  pagesFound?: number
  message?: string
  error?: string
  help?: string
  details?: string
}

export function ConnectDialog({ open, onOpenChange, onConnectionChange }: ConnectDialogProps) {
  const [status, setStatus] = useState<DebugStatus | null>(null)
  const [statusLoading, setStatusLoading] = useState(false)
  const [token, setToken] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null)

  const refreshStatus = async () => {
    setStatusLoading(true)
    try {
      const res = await fetch("/api/vaultmind/debug")
      const data = (await res.json()) as DebugStatus
      setStatus(data)
    } catch (err) {
      setStatus({
        ok: false,
        hasKey: false,
        tokenSource: "none",
        error: "Couldn't reach the diagnostic endpoint",
        details: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setStatusLoading(false)
    }
  }

  useEffect(() => {
    if (open) {
      setSubmitError(null)
      setSubmitSuccess(null)
      refreshStatus()
    }
  }, [open])

  const handleConnect = async () => {
    setSubmitting(true)
    setSubmitError(null)
    setSubmitSuccess(null)
    try {
      const res = await fetch("/api/vaultmind/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token.trim() }),
      })
      const data = (await res.json()) as { ok: boolean; pagesFound?: number; error?: string }
      if (!data.ok) {
        setSubmitError(data.error ?? "Failed to connect")
      } else {
        setSubmitSuccess(
          data.pagesFound && data.pagesFound > 0
            ? `Connected. Found ${data.pagesFound}+ accessible page(s).`
            : "Token saved, but no pages are shared yet. Share pages with the integration in Notion.",
        )
        setToken("")
        onConnectionChange()
        await refreshStatus()
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  const handleDisconnect = async () => {
    setSubmitting(true)
    setSubmitError(null)
    setSubmitSuccess(null)
    try {
      await fetch("/api/vaultmind/connect", { method: "DELETE" })
      setSubmitSuccess("Disconnected. Your token has been cleared.")
      onConnectionChange()
      await refreshStatus()
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  const isConnected = status?.ok === true
  const hasUserToken = status?.tokenSource === "user"

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            {isConnected ? (
              <PlugZap className="h-5 w-5 text-emerald-500" />
            ) : (
              <Plug className="h-5 w-5 text-amber-500" />
            )}
            Connect your Notion workspace
          </DialogTitle>
          <DialogDescription className="text-xs">
            Bring your own Notion integration secret. Stored only in a secure cookie for this
            browser session — never shared with other users.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Status card */}
          <div
            className={`rounded-md border p-3 text-xs ${
              isConnected
                ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-200"
                : status?.hasKey
                  ? "border-amber-500/30 bg-amber-500/5 text-amber-200"
                  : "border-border bg-card text-muted-foreground"
            }`}
          >
            {statusLoading ? (
              <span className="flex items-center gap-1.5">
                <Loader2 className="h-3 w-3 animate-spin" /> Checking…
              </span>
            ) : isConnected ? (
              <span className="flex items-start gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 mt-px shrink-0" />
                <span>
                  <strong className="font-medium">Connected.</strong> {status?.pagesFound}+
                  page(s) accessible
                  {hasUserToken ? " using your token." : " using the shared default key."}
                </span>
              </span>
            ) : (
              <span className="flex items-start gap-1.5">
                <AlertCircle className="h-3.5 w-3.5 mt-px shrink-0" />
                <span>
                  <strong className="font-medium">{status?.error ?? "Not connected"}.</strong>{" "}
                  {status?.help}
                </span>
              </span>
            )}
          </div>

          {/* Token input */}
          <div className="space-y-2">
            <Label htmlFor="notion-token" className="text-xs font-medium">
              Notion Internal Integration Secret
            </Label>
            <Input
              id="notion-token"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="secret_…  or  ntn_…"
              value={token}
              onChange={e => setToken(e.target.value)}
              disabled={submitting}
              className="font-mono text-xs"
            />
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Get it from{" "}
              <a
                href="https://www.notion.so/profile/integrations"
                target="_blank"
                rel="noreferrer"
                className="text-primary inline-flex items-center gap-0.5 hover:underline"
              >
                notion.so/profile/integrations
                <ExternalLink className="h-2.5 w-2.5" />
              </a>{" "}
              → create or open an integration → Internal Integration Secret. Then share each
              page with the integration in Notion (page → … → Connections).
            </p>
          </div>

          {/* Errors / success */}
          {submitError && (
            <div className="rounded-md border border-red-500/30 bg-red-500/5 p-2.5 text-[11px] text-red-300">
              {submitError}
            </div>
          )}
          {submitSuccess && (
            <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2.5 text-[11px] text-emerald-200">
              {submitSuccess}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-between gap-2 pt-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleDisconnect}
              disabled={submitting || !hasUserToken}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Disconnect
            </Button>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onOpenChange(false)}
                disabled={submitting}
                className="text-xs"
              >
                Close
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handleConnect}
                disabled={submitting || token.trim().length < 10}
                className="text-xs gap-1.5"
              >
                {submitting && <Loader2 className="h-3 w-3 animate-spin" />}
                {submitting ? "Verifying…" : "Connect"}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
