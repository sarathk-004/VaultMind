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

      const redirectUrl = `/connect-redirect?url=${encodeURIComponent(data.authorizeUrl)}`
      window.open(redirectUrl, "_blank")
      setSubmitting(false)
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err))
      setSubmitting(false)
    }
  }

  const activeError = submitError ?? queryError

  return (
    <section className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden bg-[#191919] px-6 py-20 md:min-h-screen md:py-12">
      <div className="login-pixels" aria-hidden>
        <svg className="login-pixel-links" viewBox="0 0 100 100" preserveAspectRatio="none">
          <path d="M6 8 L14 18 L9 30 L18 42 L10 56 L16 70 L8 84" />
          <path d="M24 12 L30 6 L42 10 L58 8 L70 12 L86 10 L92 22" />
          <path d="M92 22 L84 36 L90 50 L82 66 L88 78 L94 88" />
          <path d="M28 90 L46 86 L62 92 L74 84 L88 78" />
          <path d="M18 42 L42 10 L70 12 L84 36" />
          <path d="M10 56 L46 86 L82 66" />
        </svg>
        <span className="login-pixel" style={{ left: "6%", top: "8%", width: "10px", height: "10px", backgroundColor: "#CECBF6", animationDelay: "0.2s", opacity: 0.34 }} />
        <span className="login-pixel" style={{ left: "14%", top: "18%", width: "8px", height: "8px", backgroundColor: "#F4F4F4", animationDelay: "0.9s", opacity: 0.3 }} />
        <span className="login-pixel" style={{ left: "9%", top: "30%", width: "9px", height: "9px", backgroundColor: "#D9592A", animationDelay: "1.4s", opacity: 0.32 }} />
        <span className="login-pixel" style={{ left: "18%", top: "42%", width: "8px", height: "8px", backgroundColor: "#3F3A3A", animationDelay: "0.4s", opacity: 0.28 }} />
        <span className="login-pixel" style={{ left: "10%", top: "56%", width: "10px", height: "10px", backgroundColor: "#CECBF6", animationDelay: "1.1s", opacity: 0.33 }} />
        <span className="login-pixel" style={{ left: "16%", top: "70%", width: "8px", height: "8px", backgroundColor: "#F4F4F4", animationDelay: "1.7s", opacity: 0.29 }} />
        <span className="login-pixel" style={{ left: "8%", top: "84%", width: "9px", height: "9px", backgroundColor: "#D9592A", animationDelay: "0.5s", opacity: 0.3 }} />
        <span className="login-pixel" style={{ left: "24%", top: "12%", width: "8px", height: "8px", backgroundColor: "#3F3A3A", animationDelay: "2.1s", opacity: 0.26 }} />
        <span className="login-pixel" style={{ left: "30%", top: "6%", width: "9px", height: "9px", backgroundColor: "#D9592A", animationDelay: "1.9s", opacity: 0.3 }} />
        <span className="login-pixel" style={{ left: "42%", top: "10%", width: "8px", height: "8px", backgroundColor: "#F4F4F4", animationDelay: "0.6s", opacity: 0.28 }} />
        <span className="login-pixel" style={{ left: "58%", top: "8%", width: "8px", height: "8px", backgroundColor: "#CECBF6", animationDelay: "1.3s", opacity: 0.32 }} />
        <span className="login-pixel" style={{ left: "70%", top: "12%", width: "9px", height: "9px", backgroundColor: "#F4F4F4", animationDelay: "0.7s", opacity: 0.3 }} />
        <span className="login-pixel" style={{ left: "86%", top: "10%", width: "10px", height: "10px", backgroundColor: "#CECBF6", animationDelay: "0.3s", opacity: 0.34 }} />
        <span className="login-pixel" style={{ left: "92%", top: "22%", width: "8px", height: "8px", backgroundColor: "#D9592A", animationDelay: "1.6s", opacity: 0.32 }} />
        <span className="login-pixel" style={{ left: "84%", top: "36%", width: "9px", height: "9px", backgroundColor: "#3F3A3A", animationDelay: "1.2s", opacity: 0.26 }} />
        <span className="login-pixel" style={{ left: "90%", top: "50%", width: "10px", height: "10px", backgroundColor: "#F4F4F4", animationDelay: "0.8s", opacity: 0.3 }} />
        <span className="login-pixel" style={{ left: "82%", top: "66%", width: "8px", height: "8px", backgroundColor: "#CECBF6", animationDelay: "1.5s", opacity: 0.32 }} />
        <span className="login-pixel" style={{ left: "88%", top: "78%", width: "9px", height: "9px", backgroundColor: "#D9592A", animationDelay: "0.4s", opacity: 0.3 }} />
        <span className="login-pixel" style={{ left: "94%", top: "88%", width: "8px", height: "8px", backgroundColor: "#3F3A3A", animationDelay: "1.1s", opacity: 0.26 }} />
        <span className="login-pixel" style={{ left: "28%", top: "90%", width: "9px", height: "9px", backgroundColor: "#F4F4F4", animationDelay: "2.2s", opacity: 0.28 }} />
        <span className="login-pixel" style={{ left: "46%", top: "86%", width: "8px", height: "8px", backgroundColor: "#CECBF6", animationDelay: "0.9s", opacity: 0.32 }} />
        <span className="login-pixel" style={{ left: "62%", top: "92%", width: "9px", height: "9px", backgroundColor: "#D9592A", animationDelay: "0.6s", opacity: 0.3 }} />
        <span className="login-pixel" style={{ left: "74%", top: "84%", width: "8px", height: "8px", backgroundColor: "#F4F4F4", animationDelay: "1.8s", opacity: 0.28 }} />
      </div>
      {onBack && (
        <Button
          type="button"
          variant="ghost"
          className="login-carousel-control absolute bottom-10 z-10 w-[30%] rounded-none border border-[#EAEAEA] bg-[#d5d5d5] text-[21px] font-bold tracking-[-0.03em] text-[#3F3A3A] hover:bg-[#F0F0F0] hover:text-[#3F3A3A] active:bg-[#DDDDDD] sm:w-[30%] md:w-[50%] lg:w-[400px]"
          onClick={onBack}
        >
          Back
        </Button>
      )}

      <div className="relative z-10 flex w-full max-w-[520px] -translate-y-[5dvh] flex-col items-center md:translate-y-0 md:pt-0">
        <BrandMark className="h-[72px] w-[72px] sm:h-[84px] sm:w-[84px] md:h-[92px] md:w-[92px]" alt="Graphyne" />
        <h2 className="mt-6 text-center text-[24px] font-bold leading-none tracking-[-0.03em] text-[#FAFAFA] sm:mt-7 sm:text-[26px] md:mt-9 md:text-[28px]">
          Welcome to graphyne!
        </h2>

        <Button
          type="button"
          onClick={handleConnect}
          disabled={submitting}
          className="mt-8 h-[58px] w-[min(100%,460px)] rounded-none border border-[#EAEAEA] bg-[#F7F7F7] text-[18px] font-bold tracking-[-0.03em] text-[#3B3B3B] transition-[background-color,box-shadow,border-color] duration-200 ease-out hover:border-white hover:bg-white hover:shadow-[0_0_0_1px_rgba(255,255,255,0.5),0_14px_30px_rgba(0,0,0,0.18)] active:bg-[#F2F2F2] sm:mt-9 sm:h-[68px] sm:w-[min(100%,500px)] sm:text-[21px]"
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
      className="mr-3 h-6 w-6 sm:h-8 sm:w-8"
      aria-hidden
    />
  )
}
