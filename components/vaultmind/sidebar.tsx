"use client"

import { useMemo, useState } from "react"
import {
  Brain,
  Eye,
  LogOut,
  MessageSquare,
  MoreHorizontal,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Plug,
  Search,
  Star,
  Trash2,
} from "lucide-react"
import { BrandMark } from "@/components/brand/brand-mark"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { ConfirmDialog } from "@/components/vaultmind/confirm-dialog"
import { cn } from "@/lib/utils"
import type { ChatHistoryItem } from "@/lib/vaultmind-types"
import type { SettingsSection } from "@/components/vaultmind/settings-dialog"

interface SidebarProps {
  history: ChatHistoryItem[]
  activeChatId: string | null
  onSelectChat: (id: string) => void
  onDeleteChat: (id: string) => void
  onToggleStar: (id: string) => void
  onNewChat: () => void
  onOpenSettings: (section?: SettingsSection) => void
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
  onToggleStar,
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
  const [searchQuery, setSearchQuery] = useState("")
  const [profileOpen, setProfileOpen] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const [logoutError, setLogoutError] = useState<string | null>(null)
  const deleteTarget = useMemo(
    () => history.find(chat => chat.id === deleteTargetId) ?? null,
    [deleteTargetId, history],
  )
  const visibleHistory = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    const filtered = query
      ? history.filter(chat =>
          `${chat.title} ${chat.preview}`.toLowerCase().includes(query),
        )
      : history
    return filtered.slice().sort((a, b) => b.createdAt - a.createdAt)
  }, [history, searchQuery])
  const pinnedChats = visibleHistory.filter(chat => chat.starred)
  const recentChats = visibleHistory.filter(chat => !chat.starred)

  const handleLogout = async () => {
    setLoggingOut(true)
    setLogoutError(null)
    try {
      const res = await fetch("/api/vaultmind/connect", { method: "DELETE" })
      if (!res.ok) throw new Error(`Status ${res.status}`)
      window.location.assign("/login")
    } catch (err) {
      setLogoutError(err instanceof Error ? err.message : "Failed to log out.")
      setLoggingOut(false)
    }
  }

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
        <button
          type="button"
          onClick={onNewChat}
          className={cn(
            "flex items-center gap-2 rounded-md transition-colors hover:text-foreground/80 focus:outline-none focus:ring-2 focus:ring-muted-foreground/20",
            collapsed && "justify-center",
          )}
          aria-label="Start new chat"
        >
          <BrandMark className="h-7 w-7" />
          {!collapsed && <span className="text-md font-semibold tracking-tight">graphyne</span>}
        </button>
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
        <div className={cn("mb-2 flex items-center", collapsed ? "justify-center" : "justify-end px-2")}>
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

        {!collapsed && (
          <div className="relative mb-2 px-2">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={event => setSearchQuery(event.target.value)}
              placeholder="Search chats"
              className="h-8 pl-8 text-xs"
            />
          </div>
        )}

        {collapsed ? null : history.length === 0 ? (
          <div className="px-3 py-6 text-center text-[11px] text-muted-foreground">
            Your conversations will appear here.
          </div>
        ) : visibleHistory.length === 0 ? (
          <div className="px-3 py-6 text-center text-[11px] text-muted-foreground">
            No chats match your search.
          </div>
        ) : (
          <div className="space-y-4">
            {pinnedChats.length > 0 && (
              <ChatSection
                title="Pinned"
                chats={pinnedChats}
                activeChatId={activeChatId}
                onSelectChat={onSelectChat}
                onToggleStar={onToggleStar}
                onDeleteChat={setDeleteTargetId}
              />
            )}
            <ChatSection
              title="Recents"
              chats={recentChats}
              activeChatId={activeChatId}
              onSelectChat={onSelectChat}
              onToggleStar={onToggleStar}
              onDeleteChat={setDeleteTargetId}
            />
          </div>
        )}
      </div>

      <div className={cn("flex shrink-0 border-t border-border p-3", collapsed ? "flex-col items-center gap-2" : "flex-col gap-2")}>
        <DropdownMenu open={profileOpen} onOpenChange={setProfileOpen}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(
                "flex min-w-0 items-center gap-2 rounded-md transition-colors hover:bg-muted focus:outline-none focus:ring-2 focus:ring-muted-foreground/20",
                collapsed ? "justify-center p-1" : "px-1 py-1 text-left",
              )}
              aria-label="Account menu"
              data-tour="account-button"
            >
              <ProfileAvatar profile={workspaceProfile} />
              {!collapsed && (
                <div className="min-w-0 text-left leading-tight">
                  <div className="truncate text-xs font-medium">{workspaceProfile?.name ?? "Account"}</div>
                  <div className="text-[10px] text-muted-foreground">{workspaceLabel}</div>
                </div>
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side={collapsed ? "right" : "top"}
            align="start"
            sideOffset={8}
            className="w-56"
          >
            <DropdownMenuLabel className="flex items-center gap-2">
              <ProfileAvatar profile={workspaceProfile} />
              <span className="min-w-0">
                <span className="block truncate text-xs font-medium">{workspaceProfile?.name ?? "Account"}</span>
                <span className="block truncate text-[10px] font-normal text-muted-foreground">{workspaceLabel}</span>
              </span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onOpenSettings("appearance")} className="text-xs">
              <Palette className="h-4 w-4" />
              Appearance
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onOpenSettings("models")} className="text-xs">
              <Brain className="h-4 w-4" />
              Models
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onOpenSettings("graph")} className="text-xs">
              <Eye className="h-4 w-4" />
              Graph display
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onOpenConnect} className="text-xs">
              <Plug className="h-4 w-4" />
              Modify connection
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={handleLogout}
              disabled={loggingOut}
              variant="destructive"
              className="text-xs"
            >
              <LogOut className="h-4 w-4" />
              {loggingOut ? "Logging out..." : "Log out"}
            </DropdownMenuItem>
            {logoutError && <p className="px-2 py-1 text-[11px] text-destructive">{logoutError}</p>}
          </DropdownMenuContent>
        </DropdownMenu>
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

function ProfileAvatar({
  profile,
}: {
  profile?: {
    name?: string | null
    avatarUrl?: string | null
  } | null
}) {
  if (profile?.avatarUrl) {
    return (
      <img
        src={profile.avatarUrl}
        alt={profile.name ? `${profile.name} profile` : "Profile"}
        className="h-8 w-8 shrink-0 rounded-full border border-border object-cover"
      />
    )
  }

  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-[11px] font-medium text-muted-foreground">
      {(profile?.name ?? "A").slice(0, 1).toUpperCase()}
    </div>
  )
}

function ChatSection({
  title,
  chats,
  activeChatId,
  onSelectChat,
  onToggleStar,
  onDeleteChat,
}: {
  title: string
  chats: ChatHistoryItem[]
  activeChatId: string | null
  onSelectChat: (id: string) => void
  onToggleStar: (id: string) => void
  onDeleteChat: (id: string) => void
}) {
  if (chats.length === 0) return null

  return (
    <section>
      <div className="mb-1 px-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {title}
      </div>
      <ul className="flex flex-col gap-0.5">
        {chats.map(chat => {
          const active = chat.id === activeChatId
          return (
            <li key={chat.id}>
              <div className="group relative">
                <button
                  onClick={() => onSelectChat(chat.id)}
                  className={cn(
                    "w-full rounded-md px-2.5 py-2 text-left transition-all duration-200 ease-out",
                    active
                      ? "bg-muted/70 text-foreground"
                      : "text-foreground/90 hover:bg-muted/55",
                  )}
                >
                  <div className="mb-0.5 flex items-center gap-2 pr-8">
                    <MessageSquare
                      className={cn(
                        "h-3 w-3 shrink-0",
                        active ? "text-foreground/70" : "text-muted-foreground group-hover:text-foreground",
                      )}
                    />
                    {chat.starred && <Star className="h-3 w-3 shrink-0 fill-muted-foreground/70 text-muted-foreground/70" />}
                    <span className="truncate text-xs font-medium">{chat.title}</span>
                  </div>
                  <p className="truncate pl-5 pr-8 text-[11px] leading-relaxed text-muted-foreground">
                    {chat.preview || "No messages yet"}
                  </p>
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label={`Open actions for ${chat.title}`}
                      className="absolute right-2 top-2 rounded-sm p-1 text-muted-foreground opacity-0 transition-colors hover:bg-muted hover:text-foreground focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-muted-foreground/20 group-hover:opacity-100"
                    >
                      <MoreHorizontal className="h-3.5 w-3.5" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" sideOffset={4} className="w-36">
                    <DropdownMenuItem onClick={() => onToggleStar(chat.id)} className="text-xs">
                      <Star className={cn("h-4 w-4", chat.starred && "fill-current")} />
                      {chat.starred ? "Unstar" : "Star"}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => onDeleteChat(chat.id)}
                      variant="destructive"
                      className="text-xs"
                    >
                      <Trash2 className="h-4 w-4" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
