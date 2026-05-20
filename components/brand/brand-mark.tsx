"use client"

import { useEffect, useState } from "react"
import { useTheme } from "next-themes"
import { cn } from "@/lib/utils"

export function BrandMark({
  className,
  alt = "",
}: {
  className?: string
  alt?: string
}) {
  const { resolvedTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const theme = mounted && resolvedTheme === "light" ? "light" : "dark"

  return (
    <img
      src={`/brand-assets/favicon-${theme}.svg`}
      alt={alt}
      className={cn(className)}
    />
  )
}
