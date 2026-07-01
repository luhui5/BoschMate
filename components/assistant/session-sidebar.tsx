"use client"

import { useMemo, useState } from "react"
import { Plus, Search, MessageSquare, Trash2, Folder, PanelLeftClose, PanelLeftOpen } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import type { AssistantSession } from "@/lib/assistant-sessions"

interface Group {
  label: string
  items: AssistantSession[]
}

function groupSessions(sessions: AssistantSession[]): Group[] {
  const now = Date.now()
  const day = 86_400_000
  const buckets: Record<string, AssistantSession[]> = {
    今天: [],
    昨天: [],
    "过去 7 天": [],
    更早: [],
  }
  for (const s of sessions) {
    const diff = now - new Date(s.updatedAt).getTime()
    if (diff < day) buckets["今天"].push(s)
    else if (diff < 2 * day) buckets["昨天"].push(s)
    else if (diff < 7 * day) buckets["过去 7 天"].push(s)
    else buckets["更早"].push(s)
  }
  return Object.entries(buckets)
    .filter(([, items]) => items.length > 0)
    .map(([label, items]) => ({ label, items }))
}

export function SessionSidebar({
  sessions,
  activeId,
  onSelect,
  onNew,
  onDelete,
  collapsed = false,
  onToggleCollapse,
}: {
  sessions: AssistantSession[]
  activeId: string
  onSelect: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
  collapsed?: boolean
  onToggleCollapse?: () => void
}) {
  const [query, setQuery] = useState("")

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const sorted = [...sessions].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    )
    if (!q) return sorted
    return sorted.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.messages.some((m) => m.content.toLowerCase().includes(q)),
    )
  }, [sessions, query])

  const groups = useMemo(() => groupSessions(filtered), [filtered])

  if (collapsed) {
    return (
      <aside className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-border bg-card/40 py-2.5">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onToggleCollapse}
          aria-label="展开会话列表"
          title="展开会话列表"
        >
          <PanelLeftOpen className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onNew}
          aria-label="新对话"
          title="新对话"
        >
          <Plus className="size-4" />
        </Button>
      </aside>
    )
  }

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-card/40">
      <div className="flex items-center gap-1.5 p-2.5">
        <Button className="flex-1 justify-start gap-2" size="sm" onClick={onNew}>
          <Plus className="size-4" />
          新对话
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onToggleCollapse}
          aria-label="最小化会话列表"
          title="最小化会话列表"
        >
          <PanelLeftClose className="size-4" />
        </Button>
      </div>

      <div className="px-2.5 pb-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索对话…"
            className="h-8 w-full rounded-md border border-border bg-background pl-8 pr-2 text-xs outline-none focus:border-ring"
            aria-label="搜索对话"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {groups.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            {query ? "没有匹配的对话" : "还没有对话记录"}
          </p>
        ) : (
          groups.map((g) => (
            <div key={g.label} className="mb-2">
              <p className="px-2 py-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                {g.label}
              </p>
              <div className="space-y-0.5">
                {g.items.map((s) => (
                  <div
                    key={s.id}
                    className={cn(
                      "group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                      s.id === activeId ? "bg-accent" : "hover:bg-accent/50",
                    )}
                  >
                    <button
                      onClick={() => onSelect(s.id)}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    >
                      <MessageSquare className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{s.title}</span>
                        {s.folder && (
                          <span className="mt-0.5 flex items-center gap-1 truncate font-mono text-[10px] text-muted-foreground">
                            <Folder className="size-2.5 shrink-0" />
                            {s.folder}
                          </span>
                        )}
                      </span>
                    </button>
                    <button
                      onClick={() => onDelete(s.id)}
                      className="shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                      aria-label={`删除对话 ${s.title}`}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </aside>
  )
}
