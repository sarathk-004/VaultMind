"use client"

import { MessageSquare, Plus, Settings, Plug } from "lucide-react"
import { BrandMark } from "@/components/brand/brand-mark"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { ChatHistoryItem } from "@/lib/vaultmind-types"

interface SidebarProps {
  history: ChatHistoryItem[]
  activeChatId: string | null
  onSelectChat: (id: string) => void
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
  onNewChat,
  onOpenSettings,
  onOpenConnect,
  workspaceLabel = "Notion Workspace",
  workspaceConnected = true,
}: SidebarProps) {
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
          className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md bg-card border border-border hover:bg-accent/50 transition-colors"
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
          <Plug className="h-3.5 w-3.5 text-muted-foreground ml-auto shrink-0" aria-hidden />
        </button>
      </div>

      {/* Chat history */}
      <div className="flex-1 overflow-y-auto px-2 py-3 min-h-0">
        <div className="flex items-center justify-between px-2 mb-2">
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Chat History
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            aria-label="New chat"
            onClick={onNewChat}
          >
            <Plus className="h-3.5 w-3.5" />
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
                  <button
                    onClick={() => onSelectChat(chat.id)}
                    className={cn(
                      "w-full text-left px-2.5 py-2 rounded-md transition-colors group",
                      active
                        ? "bg-accent text-accent-foreground dark:bg-sidebar-accent dark:text-sidebar-accent-foreground"
                        : "hover:bg-accent/50 text-foreground/80",
                    )}
                  >
                    <div className="flex items-center gap-2 mb-0.5">
                      <MessageSquare
                        className={cn(
                          "h-3 w-3 shrink-0",
                          active ? "text-primary dark:text-sidebar-foreground" : "text-muted-foreground",
                        )}
                        aria-hidden
                      />
                      <span className="text-xs font-medium truncate">{chat.title}</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground truncate pl-5 leading-relaxed">
                      {chat.preview || "No messages yet"}
                    </p>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-border p-3 flex items-center gap-2 shrink-0">
        <Button
          variant="outline"
          size="sm"
          onClick={onNewChat}
          className="flex-1 h-8 text-xs justify-start gap-2 bg-transparent"
        >
          <Plus className="h-3.5 w-3.5" />
          New chat
        </Button>
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
    </aside>
  )
}
