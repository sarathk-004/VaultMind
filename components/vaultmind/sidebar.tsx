"use client"

import { useMemo, useState } from "react"
import { MessageSquare, PanelLeftClose, PanelLeftOpen, Plus, Plug, Settings, Trash2 } from "lucide-react"
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
  onOpenConnect: () => void
  workspaceLabel?: string
  workspaceConnected?: boolean
  workspaceProfile?: {
    name?: string | null
    avatarUrl?: string | null
  } | null
  collapsed?: boolean
  onCollapsedChange?: (collapsed: boolean) => void
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
  workspaceProfile = null,
  collapsed = false,
  onCollapsedChange,
}: SidebarProps) {
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)
  const deleteTarget = useMemo(
    () => history.find(chat => chat.id === deleteTargetId) ?? null,
    [deleteTargetId, history],
  )

  return (
    <aside
      className={cn(
        "flex h-full w-full flex-col border-border bg-sidebar md:shrink-0 md:border-r transition-[width] duration-300 ease-out",
        collapsed ? "md:w-[56px]" : "md:w-[260px]",
      )}
    >
      <div
        className={cn(
          "flex shrink-0 border-b border-border",
          collapsed ? "h-[86px] flex-col items-center justify-center gap-2 px-2" : "h-14 items-center justify-between gap-2 px-4",
        )}
      >
        <div className={cn("flex items-center gap-2", collapsed && "justify-center")}>
          <BrandMark className="h-7 w-7" />
          {!collapsed && <span className="text-md font-semibold tracking-tight">graphyne</span>}
        </div>
        {onCollapsedChange && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            onClick={() => onCollapsedChange(!collapsed)}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </Button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
        <div className={cn("mb-2 flex items-center", collapsed ? "justify-center" : "justify-between px-2")}>
          {!collapsed && (
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Chat History
            </span>
          )}
          <Button
            variant="outline"
            size={collapsed ? "icon" : "sm"}
            onClick={onNewChat}
            className={cn("h-8 text-xs", collapsed ? "w-8 px-0" : "px-3")}
            aria-label="New chat"
          >
            <Plus className="h-3.5 w-3.5" />
            {!collapsed && <span className="ml-1">New chat</span>}
          </Button>
        </div>

        {collapsed ? null : history.length === 0 ? (
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
                        "w-full rounded-md px-2.5 py-2 text-left transition-all duration-200 ease-out",
                        active
                          ? "bg-accent text-accent-foreground dark:bg-sidebar-accent dark:text-sidebar-accent-foreground"
                          : "text-foreground/90 hover:bg-muted",
                      )}
                    >
                      <div className="mb-0.5 flex items-center gap-2 pr-6">
                        <MessageSquare
                          className={cn(
                            "h-3 w-3 shrink-0",
                            active ? "text-primary dark:text-sidebar-foreground" : "text-muted-foreground group-hover:text-foreground",
                          )}
                        />
                        <span className="truncate text-xs font-medium">{chat.title}</span>
                      </div>
                      <p className="truncate pl-5 text-[11px] leading-relaxed text-muted-foreground">
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
                      className="absolute right-2 top-2 rounded-sm p-1 text-muted-foreground opacity-0 transition-colors hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <div className={cn("flex shrink-0 border-t border-border p-3", collapsed ? "flex-col items-center gap-2" : "flex-col gap-2")}>
        {!collapsed && (
          <div className="flex items-center gap-2">
            <button
              onClick={onOpenConnect}
              className="group flex min-w-0 flex-1 items-center gap-2 rounded-md border border-border bg-card px-2 py-1.5 transition-colors hover:bg-muted"
            >
              <span
                className={cn(
                  "h-2 w-2 shrink-0 rounded-full",
                  workspaceConnected ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]" : "bg-amber-500/70",
                )}
              />
              <span className="truncate text-xs font-medium">{workspaceLabel}</span>
              <Plug className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground group-hover:text-foreground" />
            </button>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9"
              aria-label="Settings"
              onClick={onOpenSettings}
              data-tour="settings-button"
            >
              <Settings className="h-[18px] w-[18px]" />
            </Button>
          </div>
        )}

        <div className={cn("flex items-center gap-2", collapsed ? "flex-col" : "justify-end")}>
          {collapsed && (
            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Connect Notion" onClick={onOpenConnect} title={workspaceLabel}>
              <Plug className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className={cn("h-8 w-8", !collapsed && "hidden")}
            aria-label="Settings"
            onClick={onOpenSettings}
            data-tour="settings-button"
          >
            <Settings className="h-4 w-4" />
          </Button>
        </div>

        {workspaceProfile && (
          <div
            className={cn(
              "flex items-center gap-2",
              collapsed ? "justify-center" : "rounded-md px-1 py-1",
            )}
          >
            {workspaceProfile.avatarUrl ? (
              <img
                src={workspaceProfile.avatarUrl}
                alt={workspaceProfile.name ? `${workspaceProfile.name} profile` : "Notion profile"}
                className="h-8 w-8 rounded-full border border-border object-cover"
              />
            ) : (
              <div className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-muted text-[11px] font-medium text-muted-foreground">
                {(workspaceProfile.name ?? "N").slice(0, 1).toUpperCase()}
              </div>
            )}
            {!collapsed && (
              <div className="min-w-0 text-left leading-tight">
                <div className="truncate text-xs font-medium">{workspaceProfile.name ?? "Notion user"}</div>
                <div className="text-[10px] text-muted-foreground">Connected profile</div>
              </div>
            )}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={open => {
          if (!open) setDeleteTargetId(null)
        }}
        title="Delete conversation?"
        description={deleteTarget ? `Delete "${deleteTarget.title}"? This cannot be undone.` : "Delete this conversation? This cannot be undone."}
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
