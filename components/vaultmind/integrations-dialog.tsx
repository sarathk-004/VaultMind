"use client"

import { useState } from "react"
import { Check, Plus } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface IntegrationsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface Integration {
  id: string
  name: string
  description: string
  badge: string
  badgeColor: string
}

const AVAILABLE: Integration[] = [
  {
    id: "notion",
    name: "Notion",
    description: "Pages, databases, and notes via MCP",
    badge: "N",
    badgeColor: "#ffffff",
  },
  {
    id: "linear",
    name: "Linear",
    description: "Issues, projects, and cycles",
    badge: "L",
    badgeColor: "#5e6ad2",
  },
  {
    id: "github",
    name: "GitHub",
    description: "Repos, PRs, and issues",
    badge: "G",
    badgeColor: "#a5a5a5",
  },
  {
    id: "slack",
    name: "Slack",
    description: "Channels and threads",
    badge: "S",
    badgeColor: "#e01e5a",
  },
  {
    id: "gdrive",
    name: "Google Drive",
    description: "Docs, sheets, and folders",
    badge: "D",
    badgeColor: "#22c55e",
  },
  {
    id: "figma",
    name: "Figma",
    description: "Files and design libraries",
    badge: "F",
    badgeColor: "#f24e1e",
  },
]

export function IntegrationsDialog({ open, onOpenChange }: IntegrationsDialogProps) {
  // Notion is connected by default; others are toggleable.
  const [connected, setConnected] = useState<Set<string>>(new Set(["notion"]))

  const toggle = (id: string) => {
    setConnected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg bg-background border-border">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold tracking-tight">
            Add Integration
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Connect data sources via MCP. VaultMind will index them and surface their content in answers and the graph.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2 py-2 max-h-[420px] overflow-y-auto">
          {AVAILABLE.map(integration => {
            const isConnected = connected.has(integration.id)
            return (
              <button
                key={integration.id}
                onClick={() => toggle(integration.id)}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-md border text-left transition-colors",
                  isConnected
                    ? "border-primary/40 bg-primary/5"
                    : "border-border bg-card hover:bg-accent/40",
                )}
              >
                <div
                  className="h-8 w-8 rounded-md flex items-center justify-center text-xs font-semibold shrink-0"
                  style={{
                    backgroundColor: `${integration.badgeColor}20`,
                    color: integration.badgeColor,
                    border: `1px solid ${integration.badgeColor}40`,
                  }}
                  aria-hidden
                >
                  {integration.badge}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium leading-tight">{integration.name}</div>
                  <div className="text-[11px] text-muted-foreground truncate mt-0.5">
                    {integration.description}
                  </div>
                </div>
                <span
                  className={cn(
                    "shrink-0 inline-flex items-center gap-1 h-6 px-2 rounded text-[10px] font-medium border",
                    isConnected
                      ? "bg-primary/10 text-primary border-primary/30"
                      : "bg-muted/40 text-muted-foreground border-border",
                  )}
                >
                  {isConnected ? (
                    <>
                      <Check className="h-3 w-3" />
                      Connected
                    </>
                  ) : (
                    <>
                      <Plus className="h-3 w-3" />
                      Connect
                    </>
                  )}
                </span>
              </button>
            )
          })}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
