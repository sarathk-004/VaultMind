"use client"

import { useEffect } from "react"

export function ThemeFavicon() {
  useEffect(() => {
    const links = [
      {
        media: "(prefers-color-scheme: light)",
        href: "/brand-assets/favicon-light.svg",
      },
      {
        media: "(prefers-color-scheme: dark)",
        href: "/brand-assets/favicon-dark.svg",
      },
    ]

    for (const item of links) {
      let link = document.head.querySelector<HTMLLinkElement>(
        `link[rel='icon'][media='${item.media}']`,
      )
      if (!link) {
        link = document.createElement("link")
        link.rel = "icon"
        link.media = item.media
        document.head.appendChild(link)
      }
      link.type = "image/svg+xml"
      link.href = item.href
    }
  }, [])

  return null
}
