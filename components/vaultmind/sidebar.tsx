"use client"

import { useMemo, useState } from "react"
import { MessageSquare, Plus, Settings, Plug, Trash2 } from "lucide-react"
import { BrandMark } from "@/components/brand/brand-mark"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/vaultmind/confirm-dialog"
import { cn } from "@/lib/utils"
import type { ChatHistoryItem } from "@/lib/vaultmind-types"

interface SidebarProps {
  history: ChatHistoryItem[]
  activeChatId: string | null
  onSelectChat: (id: string) => void
  onDeleteChat: (id: string) => void
  onNewChat: () => void
  onOpenSettings: () => void
  /** Open the "Connect Notion" dialog (BYO token). */
  onOpenConnect: () => void
  workspaceLabel?: string
  workspaceConnected?: boolean
}

export function Sidebar({
  history,
  activeChatId,
  onSelectChat,
  onDeleteChat,
  onNewChat,
  onOpenSettings,
  onOpenConnect,
  workspaceLabel = "Notion Workspace",
  workspaceConnected = true,
}: SidebarProps) {
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)

  const deleteTarget = useMemo(
    () => history.find(chat => chat.id === deleteTargetId) ?? null,
    [deleteTargetId, history],
  )

  return (
    <aside className="flex flex-col h-full w-full md:w-[260px] md:shrink-0 md:border-r border-border bg-sidebar">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 h-14 border-b border-border shrink-0">
        <BrandMark className="h-7 w-7" />
        <span className="text-md font-semibold tracking-tight">graphyne</span>
      </div>

      {/* Workspace */}
      <div className="px-4 py-4 border-b border-border">
        <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-2">
          Connected Workspace
        </div>
        <button
          onClick={onOpenConnect}
          className="group w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md bg-card border border-border hover:bg-accent/35 transition-colors"
        >
          <span
            className={cn(
              "h-2 w-2 rounded-full",
              workspaceConnected
                ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]"
                : "bg-amber-500/70",
            )}
            aria-hidden
          />
          <div className="flex flex-col leading-tight min-w-0 text-left">
            <span className="text-xs font-medium truncate">{workspaceLabel}</span>
            <span className="text-[10px] text-muted-foreground">
              {workspaceConnected ? "Live · click to manage" : "Click to connect"}
            </span>
          </div>
          <Plug
            className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground ml-auto shrink-0"
            aria-hidden
          />
        </button>
      </div>

      {/* Chat history */}
      <div className="flex-1 overflow-y-auto px-2 py-3 min-h-0">
        <div className="flex items-center justify-between px-2 mb-2">
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Chat History
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={onNewChat}
            className="h-8 px-3 text-xs"
            aria-label="New chat"
          >
            <Plus className="h-3.5 w-3.5" />
            <span className="ml-1">New chat</span>
          </Button>
        </div>

        {history.length === 0 ? (
          <div className="px-3 py-6 text-center text-[11px] text-muted-foreground">
            Your conversations will appear here.
          </div>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {history.map(chat => {
              const active = chat.id === activeChatId
              return (
                <li key={chat.id}>
                  <div className="group relative">
                    <button
                      onClick={() => onSelectChat(chat.id)}
                      className={cn(
                        "group w-full text-left px-2.5 py-2 rounded-md transition-colors",
                        active
                          ? "bg-accent text-accent-foreground dark:bg-sidebar-accent dark:text-sidebar-accent-foreground"
                          : "hover:bg-accent/40 text-foreground/90",
                      )}
                    >
                      <div className="flex items-center gap-2 mb-0.5 pr-6">
                        <MessageSquare
                          className={cn(
                            "h-3 w-3 shrink-0",
                            active
                              ? "text-primary dark:text-sidebar-foreground"
                              : "text-muted-foreground group-hover:text-foreground",
                          )}
                          aria-hidden
                        />
                        <span className="text-xs font-medium truncate">{chat.title}</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground truncate pl-5 leading-relaxed">
                        {chat.preview || "No messages yet"}
                      </p>
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete ${chat.title}`}
                      onClick={event => {
                        event.stopPropagation()
                        setDeleteTargetId(chat.id)
                      }}
                      className="absolute right-2 top-2 rounded-sm p-1 text-red-600 dark:text-red-400 opacity-0 transition-opacity hover:text-red-700 dark:hover:text-red-300 group-hover:opacity-100"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-border p-3 flex items-center gap-2 shrink-0">
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          aria-label="Connect Notion"
          onClick={onOpenConnect}
          title="Connect Notion workspace"
        >
          <Plug className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          aria-label="Settings"
          onClick={onOpenSettings}
          data-tour="settings-button"
        >
          <Settings className="h-3.5 w-3.5" />
        </Button>
      </div>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={open => {
          if (!open) setDeleteTargetId(null)
        }}
        title="Delete conversation?"
        description={
          deleteTarget
            ? `Delete "${deleteTarget.title}"? This cannot be undone.`
            : "Delete this conversation? This cannot be undone."
        }
        confirmLabel="Delete"
        confirmVariant="destructive"
        onConfirm={() => {
          if (deleteTarget) onDeleteChat(deleteTarget.id)
          setDeleteTargetId(null)
        }}
      />
    </aside>
  )
}
