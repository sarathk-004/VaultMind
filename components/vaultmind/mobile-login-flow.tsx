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
        <svg
          className="h-12 w-12 text-[#FAFAFA]"
          viewBox="0 0 96 96"
          role="img"
          aria-label="Graphyne"
        >
          <path
            d="M24 61 48 27 73 61"
            fill="none"
            stroke="currentColor"
            strokeWidth="7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="24" cy="61" r="7" fill="#D9592A" />
          <circle cx="48" cy="27" r="7" fill="currentColor" />
          <circle cx="73" cy="61" r="7" fill="#D9592A" />
          <path d="M32 69h33" stroke="currentColor" strokeWidth="7" strokeLinecap="round" />
        </svg>
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
