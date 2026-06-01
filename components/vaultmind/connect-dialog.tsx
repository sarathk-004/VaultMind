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
import { CheckCircle2, AlertCircle, Loader2, ExternalLink, LogOut, Plug, PlugZap } from "lucide-react"

interface ConnectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called after successful connect / logout so the parent can re-fetch the workspace. */
  onConnectionChange: () => void
}

interface DebugStatus {
  ok: boolean
  hasKey: boolean
  tokenSource: "oauth" | "env" | "none"
  keyPreview?: string
  workspaceName?: string
  pagesFound?: number
  message?: string
  error?: string
  help?: string
  details?: string
}

export function ConnectDialog({ open, onOpenChange, onConnectionChange }: ConnectDialogProps) {
  const [status, setStatus] = useState<DebugStatus | null>(null)
  const [statusLoading, setStatusLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null)

  const refreshStatus = async () => {
    setStatusLoading(true)
    try {
      const res = await fetch("/api/vaultmind/connect", { cache: "no-store" })
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
      const res = await fetch("/api/vaultmind/connect", { method: "POST" })
      const data = (await res.json()) as { ok: boolean; authorizeUrl?: string; error?: string }
      if (!data.ok || !data.authorizeUrl) {
        setSubmitError(data.error ?? "Failed to start Notion authorization")
        setSubmitting(false)
        return
      }

      window.location.assign(data.authorizeUrl)
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err))
      setSubmitting(false)
    }
  }

  const handleLogout = async () => {
    setLoggingOut(true)
    setSubmitError(null)
    setSubmitSuccess(null)
    try {
      const res = await fetch("/api/vaultmind/connect", { method: "DELETE" })
      if (!res.ok) throw new Error(`Status ${res.status}`)
      setSubmitSuccess("Logged out. Your Notion authorization has been cleared.")
      onConnectionChange()
      window.location.assign("/login")
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err))
      setLoggingOut(false)
    }
  }

  const isConnected = status?.ok === true
  const hasOAuthConnection = status?.tokenSource === "oauth"

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
            Authorize Graphyne with Notion OAuth. You choose which pages it can read during the
            Notion permission step.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div
            className={`rounded-md border p-3 text-xs ${
              isConnected
                ? "border-emerald-500/30 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/5 dark:text-emerald-200"
                : status?.hasKey
                  ? "border-amber-500/30 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/5 dark:text-amber-200"
                  : "border-border bg-card text-muted-foreground"
            }`}
          >
            {statusLoading ? (
              <span className="flex items-center gap-1.5">
                <Loader2 className="h-3 w-3 animate-spin" /> Checking...
              </span>
            ) : isConnected ? (
              <span className="flex items-start gap-1.5">
                <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0" />
                <span>
                  <strong className="font-medium">Connected.</strong>{" "}
                  {typeof status?.pagesFound === "number"
                    ? `${status.pagesFound}+ page(s) accessible`
                    : "Workspace authorization is active"}
                  {status?.workspaceName ? ` in ${status.workspaceName}.` : "."}
                </span>
              </span>
            ) : (
              <span className="flex items-start gap-1.5">
                <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" />
                <span>
                  <strong className="font-medium">{status?.error ?? "Not connected"}.</strong>{" "}
                  {status?.help}
                </span>
              </span>
            )}
          </div>

          <div className="rounded-md border border-border bg-card p-3 text-[11px] leading-relaxed text-muted-foreground">
            Notion will open in a new authorization screen. Pick the workspace and pages Graphyne
            should read, then Notion will send you back here.
          </div>

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

          <div className="flex items-center justify-between gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleLogout}
              disabled={submitting || loggingOut || !hasOAuthConnection}
              className="text-xs text-foreground/80 hover:text-foreground"
            >
              {loggingOut ? (
                <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
              ) : (
                <LogOut className="mr-1.5 h-3 w-3" />
              )}
              Log out
            </Button>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                onClick={handleConnect}
                disabled={submitting || loggingOut}
                className="gap-1.5 text-xs"
              >
                {submitting ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <ExternalLink className="h-3 w-3" />
                )}
                {submitting ? "Opening..." : "Continue with Notion"}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
