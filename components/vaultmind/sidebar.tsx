"use client"

import { BrainCircuit, MessageSquare, Plus, Settings } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface ChatHistoryItem {
  id: string
  title: string
  preview: string
}

const MOCK_HISTORY: ChatHistoryItem[] = [
  {
    id: "1",
    title: "Q1 roadmap review",
    preview: "Summarize the engineering priorities…",
  },
  {
    id: "2",
    title: "Customer feedback themes",
    preview: "Connect feedback to feature requests…",
  },
  {
    id: "3",
    title: "Sprint retro notes",
    preview: "What blockers came up last sprint?",
  },
]

interface SidebarProps {
  activeChatId: string
  onSelectChat: (id: string) => void
}

export function Sidebar({ activeChatId, onSelectChat }: SidebarProps) {
  return (
    <aside className="flex flex-col h-full w-[260px] shrink-0 border-r border-border bg-sidebar">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 h-14 border-b border-border shrink-0">
        <div className="h-7 w-7 rounded-md bg-primary/10 border border-primary/20 flex items-center justify-center">
          <BrainCircuit className="h-4 w-4 text-primary" aria-hidden />
        </div>
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-semibold tracking-tight">VaultMind</span>
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">v1.0</span>
        </div>
      </div>

      {/* Workspace */}
      <div className="px-4 py-4 border-b border-border">
        <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-2">
          Connected Workspace
        </div>
        <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-md bg-card border border-border">
          <span
            className="h-2 w-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]"
            aria-hidden
          />
          <div className="flex flex-col leading-tight min-w-0">
            <span className="text-xs font-medium truncate">Acme Notion</span>
            <span className="text-[10px] text-muted-foreground">12 integrations</span>
          </div>
        </div>
      </div>

      {/* Chat history */}
      <div className="flex-1 overflow-y-auto px-2 py-3">
        <div className="flex items-center justify-between px-2 mb-2">
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Chat History
          </span>
          <Button variant="ghost" size="icon" className="h-6 w-6" aria-label="New chat">
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>

        <ul className="flex flex-col gap-0.5">
          {MOCK_HISTORY.map(chat => {
            const active = chat.id === activeChatId
            return (
              <li key={chat.id}>
                <button
                  onClick={() => onSelectChat(chat.id)}
                  className={cn(
                    "w-full text-left px-2.5 py-2 rounded-md transition-colors group",
                    active
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-accent/50 text-foreground/80",
                  )}
                >
                  <div className="flex items-center gap-2 mb-0.5">
                    <MessageSquare
                      className={cn(
                        "h-3 w-3 shrink-0",
                        active ? "text-primary" : "text-muted-foreground",
                      )}
                      aria-hidden
                    />
                    <span className="text-xs font-medium truncate">{chat.title}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground truncate pl-5 leading-relaxed">
                    {chat.preview}
                  </p>
                </button>
              </li>
            )
          })}
        </ul>
      </div>

      {/* Footer */}
      <div className="border-t border-border p-3 flex items-center gap-2 shrink-0">
        <Button
          variant="outline"
          size="sm"
          className="flex-1 h-8 text-xs justify-start gap-2 bg-transparent"
        >
          <Plus className="h-3.5 w-3.5" />
          Add Integration
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label="Settings">
          <Settings className="h-3.5 w-3.5" />
        </Button>
      </div>
    </aside>
  )
}
