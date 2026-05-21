"use client"

import { useMemo, useState } from "react"
import { AlertCircle, ExternalLink, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"

const ERROR_COPY: Record<string, string> = {
  missing_code: "Notion did not return a valid authorization code. Try again.",
  state_mismatch: "The login session expired or was interrupted. Please try again.",
  missing_oauth_env: "Notion OAuth is not configured. Contact the site admin.",
  token_exchange_failed: "Notion rejected the login request. Try again in a moment.",
  missing_access_token: "Notion did not issue an access token. Try again.",
  callback_failed: "Notion login failed. Please retry.",
}

interface LoginPanelProps {
  notion?: string
  reason?: string
}

export function LoginPanel({ notion, reason }: LoginPanelProps) {
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const queryError = useMemo(() => {
    if (notion !== "error") return null
    if (reason && ERROR_COPY[reason]) return ERROR_COPY[reason]
    return "Notion sign in failed. Please try again."
  }, [notion, reason])

  const handleConnect = async () => {
    setSubmitting(true)
    setSubmitError(null)
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

  const activeError = submitError ?? queryError

  return (
    <div className="rounded-2xl border border-border/60 bg-card/90 p-6 shadow-[0_25px_70px_rgba(0,0,0,0.18)] backdrop-blur">
      <div className="space-y-2">
        <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">Notion OAuth</p>
        <h2 className="text-2xl font-semibold tracking-tight">Continue with Notion</h2>
        <p className="text-sm text-muted-foreground">
          Connect once and Graphyne reads only the pages you approve. No manual tokens or API keys
          required.
        </p>
      </div>

      <div className="mt-6 space-y-3">
        <Button
          type="button"
          size="lg"
          onClick={handleConnect}
          disabled={submitting}
          className="w-full justify-center gap-2"
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink />}
          {submitting ? "Opening Notion..." : "Sign in with Notion"}
        </Button>
        <p className="text-[11px] text-muted-foreground">
          You will choose the workspace and pages during the Notion permission step.
        </p>
      </div>

      {activeError && (
        <div className="mt-5 flex gap-2 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{activeError}</span>
        </div>
      )}
    </div>
  )
}
