"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { LoginIntroSlide } from "./login-carousel"
import { LoginPanel } from "./login-panel"
import { LoginArrow } from "./login-arrow"

interface MobileLoginFlowProps {
  notion?: string
  reason?: string
}

export function MobileLoginFlow({ notion, reason }: MobileLoginFlowProps) {
  const [showSignIn, setShowSignIn] = useState(false)

  if (showSignIn) {
    return <LoginPanel notion={notion} reason={reason} onBack={() => setShowSignIn(false)} />
  }

  return (
    <div className="relative min-h-[100dvh]">
      <LoginIntroSlide />
      <div className="absolute left-1/2 top-6 -translate-x-1/2">
        <img
          src="/brand-assets/favicon-light.svg"
          alt="Graphyne"
          className="h-18 w-18"
        />
      </div>
      <Button
        type="button"
        className="login-carousel-control absolute inset-x-6 bottom-10 h-[64px] rounded-none border border-[#EAEAEA] bg-[#FAFAFA] text-[21px] font-bold tracking-[-0.03em] text-[#3F3A3A] hover:bg-white hover:text-[#3F3A3A]"
        onClick={() => setShowSignIn(true)}
        aria-label="Continue to sign in"
      >
        Continue
        <LoginArrow direction="right" className="ml-3 h-14 w-14" />
      </Button>
    </div>
  )
}
