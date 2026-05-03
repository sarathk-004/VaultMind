"use client"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  showFullGraph: boolean
  onShowFullGraphChange: (v: boolean) => void
  graphMotion: boolean
  onGraphMotionChange: (v: boolean) => void
}

export function SettingsDialog({
  open,
  onOpenChange,
  showFullGraph,
  onShowFullGraphChange,
  graphMotion,
  onGraphMotionChange,
}: SettingsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-background border-border">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold tracking-tight">
            Settings
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Configure how VaultMind queries your workspace and renders the graph.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <Row
            label="Show full workspace graph at rest"
            hint="Render every page, database, task and note when no query is active."
          >
            <Switch
              checked={showFullGraph}
              onCheckedChange={onShowFullGraphChange}
              aria-label="Show full workspace graph"
            />
          </Row>

          <Row
            label="Animate graph layout"
            hint="Smoothly tween nodes when the graph changes."
          >
            <Switch
              checked={graphMotion}
              onCheckedChange={onGraphMotionChange}
              aria-label="Animate graph layout"
            />
          </Row>

          <Row
            label="Model"
            hint="The reasoning model VaultMind uses for answers."
          >
            <span className="inline-flex items-center px-2 py-1 rounded text-[10px] font-medium bg-primary/10 text-primary border border-primary/20">
              GPT-4o
            </span>
          </Row>

          <Row
            label="Workspace"
            hint="Connected via MCP."
          >
            <span className="text-xs text-foreground/80">Acme Notion</span>
          </Row>
        </div>

        <DialogFooter>
          <Button size="sm" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Row({
  label,
  hint,
  children,
}: {
  label: string
  hint: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex-1 min-w-0">
        <Label className="text-sm font-medium">{label}</Label>
        <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">{hint}</p>
      </div>
      <div className="shrink-0 pt-0.5">{children}</div>
    </div>
  )
}
