"use client"

import { useEffect, Suspense } from "react"
import { useSearchParams } from "next/navigation"

function RedirectContent() {
  const searchParams = useSearchParams()
  const targetUrl = searchParams.get("url")

  useEffect(() => {
    if (targetUrl) {
      window.location.replace(targetUrl)
    }
  }, [targetUrl])

  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center bg-[#191919] text-[#FAFAFA]">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-[#F7F7F7] border-t-transparent"></div>
        <p className="text-sm font-medium tracking-tight">Redirecting to Notion securely...</p>
      </div>
    </div>
  )
}

export default function ConnectRedirectPage() {
  return (
    <Suspense fallback={null}>
      <RedirectContent />
    </Suspense>
  )
}
