"use client"

import { useState } from "react"
import Link from "next/link"
import {
  MessagesSquare,
  Brain,
  StickyNote,
  Plus,
  Pin,
  Lock,
  Search,
  MoreHorizontal,
  GitMerge,
  FileDown,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { timeAgo } from "@/lib/format"
import { isSessionPinned, toggleSessionPinned, sortSessionsPinnedFirst } from "@/lib/session-prefs"
import { downloadTextFile } from "@/lib/workspace-utils"
import type { Session, Memory, Note, Project } from "@/lib/types"

type Tab = "sessions" | "memory" | "notes"

const memoryTypeLabel: Record<Memory["type"], string> = {
  fact: "事实",
  interaction: "交互",
  behavior: "行为",
  plan: "计划",
}

export function LeftSidebar({
  project,
  sessions,
  memories,
  notes,
  activeSessionId,
  onSelectSession,
  onNewSession,
  onMergeSession,
  onSessionsChange,
}: {
  project: Project
  sessions: Session[]
  memories: Memory[]
  notes: Note[]
  activeSessionId: string
  onSelectSession: (id: string) => void
  onNewSession: () => void
  onMergeSession?: (sourceId: string, targetId: string) => void
  onSessionsChange?: () => void
}) {
  const [tab, setTab] = useState<Tab>("sessions")
  const [search, setSearch] = useState("")
  const [menuSessionId, setMenuSessionId] = useState<string | null>(null)

  const sortedSessions = sortSessionsPinnedFirst(sessions)

  const tabs: { id: Tab; label: string; icon: typeof MessagesSquare; count: number }[] = [
    { id: "sessions", label: "会话", icon: MessagesSquare, count: sessions.length },
    { id: "memory", label: "记忆", icon: Brain, count: memories.length },
    { id: "notes", label: "笔记", icon: StickyNote, count: notes.length },
  ]

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-border bg-sidebar">
      {/* Current project */}
      <div className="border-b border-border p-2">
        <div className="flex w-full items-center gap-2 rounded-md px-2 py-1.5">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary font-mono text-xs font-bold text-primary-foreground">
            {project.name.slice(0, 2).toUpperCase()}
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm font-semibold">{project.name}</span>
            <span className="truncate text-xs text-muted-foreground">{project.gitBranch}</span>
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border p-1">
        {tabs.map((t) => {
          const Icon = t.icon
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "flex flex-1 flex-col items-center gap-0.5 rounded-md py-1.5 text-xs transition-colors",
                tab === t.id ? "bg-sidebar-accent text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-4" />
              <span>{t.label}</span>
            </button>
          )
        })}
      </div>

      {/* Tab body */}
      <div className="flex min-h-0 flex-1 flex-col">
        {tab === "sessions" && (
          <>
            <div className="p-2">
              <Button size="sm" className="w-full" onClick={onNewSession}>
                <Plus />
                新建会话
              </Button>
            </div>
            <div className="flex-1 space-y-0.5 overflow-auto px-2 pb-2 scrollbar-thin">
              {sessions.length === 0 ? (
                <p className="px-2 py-8 text-center text-xs text-muted-foreground">暂无会话，点击上方新建。</p>
              ) : (
                sortedSessions.map((s) => (
                  <div key={s.id} className="relative">
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => onSelectSession(s.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault()
                          onSelectSession(s.id)
                        }
                      }}
                      className={cn(
                        "flex w-full flex-col gap-1 rounded-md px-2 py-2 pr-8 text-left transition-colors",
                        s.id === activeSessionId ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/50",
                      )}
                    >
                      <span className="flex items-center gap-1.5">
                        {(s.pinned || isSessionPinned(s.id)) && (
                          <Pin className="size-3 shrink-0 fill-current text-primary" />
                        )}
                        <span className="truncate text-sm font-medium">{s.title}</span>
                      </span>
                      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Badge variant="outline" className="text-[10px]">
                          {s.mode}
                        </Badge>
                        {s.status === "archived" && <span>· 已归档</span>}
                        <span className="ml-auto">{timeAgo(s.updatedAt)}</span>
                      </span>
                    </div>
                    <button
                      type="button"
                      className="absolute right-1 top-1.5 z-10 shrink-0 rounded p-0.5 hover:bg-background"
                      onClick={(e) => {
                        e.stopPropagation()
                        setMenuSessionId(menuSessionId === s.id ? null : s.id)
                      }}
                      aria-label="会话操作"
                      aria-expanded={menuSessionId === s.id}
                    >
                      <MoreHorizontal className="size-3.5 text-muted-foreground" />
                    </button>
                    {menuSessionId === s.id && (
                      <>
                        <div className="fixed inset-0 z-10" onClick={() => setMenuSessionId(null)} aria-hidden />
                        <div className="absolute right-2 top-8 z-20 min-w-[140px] rounded-md border border-border bg-popover py-1 shadow-lg">
                          <button
                            type="button"
                            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-accent"
                            onClick={() => {
                              toggleSessionPinned(s.id)
                              onSessionsChange?.()
                              setMenuSessionId(null)
                            }}
                          >
                            <Pin className="size-3" />
                            {isSessionPinned(s.id) ? "取消固定" : "固定会话"}
                          </button>
                          {onMergeSession && s.id !== activeSessionId && (
                            <button
                              type="button"
                              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-accent"
                              onClick={() => {
                                onMergeSession(s.id, activeSessionId)
                                setMenuSessionId(null)
                              }}
                            >
                              <GitMerge className="size-3" />
                              合并到当前
                            </button>
                          )}
                          <button
                            type="button"
                            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-accent"
                            onClick={() => {
                              const planMsgs = s.messages.filter((m) => m.mode === "plan" && m.role === "assistant")
                              const body = planMsgs.length
                                ? planMsgs.map((m) => m.content).join("\n\n---\n\n")
                                : s.messages.map((m) => `## ${m.role}\n\n${m.content}`).join("\n\n")
                              downloadTextFile(`${s.title || "plan"}.md`, `# ${s.title}\n\n${body}`)
                              setMenuSessionId(null)
                            }}
                          >
                            <FileDown className="size-3" />
                            导出 Plan
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ))
              )}
            </div>
          </>
        )}

        {tab === "memory" && (
          <>
            <div className="relative p-2">
              <Search className="pointer-events-none absolute left-4 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索记忆…"
                className="h-7 pl-7 text-xs"
              />
            </div>
            <div className="flex-1 space-y-1.5 overflow-auto px-2 pb-2 scrollbar-thin">
              {memories
                .filter((m) => m.content.toLowerCase().includes(search.toLowerCase()))
                .map((m) => (
                  <div key={m.id} className="rounded-md border border-border bg-card p-2">
                    <div className="mb-1 flex items-center gap-1.5">
                      <Badge variant="primary" className="text-[10px]">
                        {memoryTypeLabel[m.type]}
                      </Badge>
                      {m.encrypted && <Lock className="size-3 text-warning" />}
                      <span className="ml-auto text-[10px] text-muted-foreground">v{m.version}</span>
                    </div>
                    <p className="line-clamp-3 text-xs leading-relaxed text-foreground/90">{m.content}</p>
                    <div className="mt-1.5 flex items-center gap-2 text-[10px] text-muted-foreground">
                      <span className="flex-1">
                        <span className="inline-block h-1 w-10 overflow-hidden rounded-full bg-secondary align-middle">
                          <span
                            className="block h-full bg-primary"
                            style={{ width: `${m.importance * 100}%` }}
                          />
                        </span>
                        <span className="ml-1">重要度 {(m.importance * 100).toFixed(0)}%</span>
                      </span>
                      <span>命中 {m.accessCount}</span>
                    </div>
                  </div>
                ))}
              <Link
                href="/settings?tab=memory"
                className="block px-2 py-2 text-center text-xs text-primary hover:underline"
              >
                管理全部记忆 →
              </Link>
            </div>
          </>
        )}

        {tab === "notes" && (
          <div className="flex-1 space-y-1.5 overflow-auto p-2 scrollbar-thin">
            <Button variant="outline" size="sm" className="w-full">
              <Plus />
              新建笔记
            </Button>
            {notes.map((n) => (
              <div key={n.id} className="rounded-md border border-border bg-card p-2">
                <p className="text-sm font-medium">{n.title}</p>
                <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                  {n.body}
                </p>
                <p className="mt-1.5 text-[10px] text-muted-foreground">{timeAgo(n.updatedAt)}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  )
}
