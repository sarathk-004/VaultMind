"use client"

import { useMemo, useState } from "react"
import { AlertCircle, Loader2 } from "lucide-react"
import { BrandMark } from "@/components/brand/brand-mark"
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
  onBack?: () => void
}

export function LoginPanel({ notion, reason, onBack }: LoginPanelProps) {
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
    <section className="relative flex min-h-[100dvh] items-center justify-center bg-[#191919] px-6 py-12 md:min-h-screen">
      {onBack && (
        <Button
          type="button"
          variant="ghost"
          className="login-carousel-control absolute w-[30%] sm:w-[30%] md:w-[50%] lg:w-[400px] bottom-10 h-[64px] rounded-none border border-[#EAEAEA] bg-[#d5d5d5] text-[21px] font-bold tracking-[-0.03em] text-[#3F3A3A] hover:bg-[#F0F0F0] hover:text-[#3F3A3A] active:bg-[#DDDDDD]"
          onClick={onBack}
        >
          Back
        </Button>
      )}

      <div className="flex w-full max-w-[520px] flex-col items-center">
        <BrandMark className="h-[92px] w-[92px]" alt="Graphyne" />
        <h2 className="mt-9 text-center text-[28px] font-bold leading-none tracking-[-0.03em] text-[#FAFAFA]">
          Welcome to graphyne!
        </h2>

        <Button
          type="button"
          onClick={handleConnect}
          disabled={submitting}
          className="mt-10 h-[68px] w-[min(100%,500px)] rounded-none border border-[#EAEAEA] bg-[#F7F7F7] text-[21px] font-bold tracking-[-0.03em] text-[#3B3B3B] transition-[background-color,box-shadow,border-color] duration-200 ease-out hover:border-white hover:bg-white hover:shadow-[0_0_0_1px_rgba(255,255,255,0.5),0_14px_30px_rgba(0,0,0,0.18)] active:bg-[#F2F2F2]"
        >
          {submitting ? <Loader2 className="mr-3 h-6 w-6 animate-spin" /> : <NotionIcon />}
          {submitting ? "Opening Notion..." : "Sign In with Notion"}
        </Button>

        {activeError && (
          <div className="mt-5 flex w-full gap-2 border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-100">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{activeError}</span>
          </div>
        )}
      </div>
    </section>
  )
}

function NotionIcon() {
  return (
    <img
      src="/brand-assets/notion-logo.svg"
      alt=""
      className="mr-3 h-8 w-8"
      aria-hidden
    />
  )
}
