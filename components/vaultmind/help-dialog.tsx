"use client"

import { AlertCircle } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { useState, useEffect } from "react"

interface HelpDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceConnected: boolean
}

interface DiagnosticStatus {
  ok: boolean
  hasKey: boolean
  keyPreview?: string
  message?: string
  error?: string
  details?: string
  help?: string
  pagesFound?: number
}

export function HelpDialog({ open, onOpenChange, workspaceConnected }: HelpDialogProps) {
  const [diagnostic, setDiagnostic] = useState<DiagnosticStatus | null>(null)
  const [loading, setLoading] = useState(false)

  const checkConnection = async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/vaultmind/debug")
      const data = (await res.json()) as DiagnosticStatus
      setDiagnostic(data)
    } catch (err) {
      setDiagnostic({
        ok: false,
        hasKey: false,
        error: "Failed to check connection",
        details: err instanceof Error ? err.message : String(err),
      })
    }
    setLoading(false)
  }

  useEffect(() => {
    if (open && !diagnostic) {
      checkConnection()
    }
  }, [open, diagnostic])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-amber-500" />
            Notion Connection Diagnostics
          </DialogTitle>
          <DialogDescription>
            Check why your Notion integration isn&apos;t working and get setup instructions.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
              Checking connection...
            </div>
          ) : diagnostic ? (
            <>
              <div className={`p-4 rounded-lg border ${
                diagnostic.ok
                  ? "bg-green-50 border-green-200 dark:bg-green-950 dark:border-green-800"
                  : diagnostic.hasKey
                    ? "bg-amber-50 border-amber-200 dark:bg-amber-950 dark:border-amber-800"
                    : "bg-red-50 border-red-200 dark:bg-red-950 dark:border-red-800"
              }`}>
                {diagnostic.ok ? (
                  <p className="text-sm font-medium text-green-900 dark:text-green-100">
                    ✓ Connected! Found {diagnostic.pagesFound} page(s).
                  </p>
                ) : (
                  <>
                    <p className="text-sm font-medium text-red-900 dark:text-red-100 mb-2">
                      {diagnostic.error}
                    </p>
                    {diagnostic.details && (
                      <p className="text-xs text-red-800 dark:text-red-200 mb-2 font-mono bg-black/10 p-2 rounded">
                        {diagnostic.details}
                      </p>
                    )}
                  </>
                )}
              </div>

              <div className="space-y-3 bg-muted/50 p-4 rounded-lg">
                <h4 className="font-medium text-sm">Setup Instructions</h4>
                <ol className="space-y-2 text-sm text-foreground/80 list-decimal list-inside">
                  <li>
                    Go to{" "}
                    <a
                      href="https://www.notion.so/my-integrations"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline"
                    >
                      notion.so/my-integrations
                    </a>
                  </li>
                  <li>
                    Create or select an integration and copy the{" "}
                    <strong>Internal Integration Secret</strong> (starts with <code className="text-xs bg-black/10 px-1 py-0.5 rounded">secret_</code> or{" "}
                    <code className="text-xs bg-black/10 px-1 py-0.5 rounded">ntn_</code>)
                  </li>
                  <li>
                    Go to VaultMind Settings (top right) → Vars → add{" "}
                    <code className="text-xs bg-black/10 px-1 py-0.5 rounded">NOTION_API_KEY</code> with that secret
                  </li>
                  <li>
                    In Notion, open pages you want to query. Click <strong>Share</strong> at top right, find your integration, and grant access.
                  </li>
                  <li>
                    Refresh this page and try a query.
                  </li>
                </ol>
              </div>

              <div className="bg-blue-50 border border-blue-200 dark:bg-blue-950 dark:border-blue-800 p-3 rounded-lg text-xs text-blue-900 dark:text-blue-100">
                <strong>Tip:</strong> You must share individual pages with the integration. Notion doesn&apos;t grant workspace-wide access automatically.
              </div>
            </>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => checkConnection()} disabled={loading}>
              {loading ? "Checking..." : "Check Again"}
            </Button>
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
