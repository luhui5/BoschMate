"use client"

import { useMemo, useState, type ReactNode } from "react"
import Link from "next/link"
import {
  Plus,
  ChevronDown,
  ChevronRight,
  MessageSquare,
  Trash2,
  Folder,
  Server,
  Home,
  BookUp,
  Settings,
  Sun,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { BoschGradientBorder } from "@/components/bosch-gradient-border"
import { useApp } from "@/components/app-provider"
import type { AssistantSession } from "@/lib/assistant-sessions"
import type { AssistantWorkspace } from "@/lib/assistant-workspaces"
import { NewProjectDialog } from "@/components/home/new-project-dialog"
import type { Project } from "@/lib/types"

function WorkspaceIcon({ ws, className }: { ws: AssistantWorkspace; className?: string }) {
  if (ws.isHome) return <Home className={className} />
  if (ws.kind === "ssh") return <Server className={className} />
  return <Folder className={className} />
}

function SidebarProcessingBorder({
  active,
  innerClassName,
  children,
}: {
  active: boolean
  innerClassName?: string
  children: ReactNode
}) {
  if (!active) return <>{children}</>
  return (
    <BoschGradientBorder
      spinActive
      className="rounded-md"
      innerClassName={cn("rounded-[5px] bg-card/40", innerClassName)}
    >
      {children}
    </BoschGradientBorder>
  )
}

function CollapsedIconButton({
  active,
  title,
  ariaLabel,
  onClick,
  badge,
  children,
}: {
  active?: boolean
  title: string
  ariaLabel: string
  onClick?: () => void
  badge?: number
  children: ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={ariaLabel}
      onClick={onClick}
      className={cn(
        "relative flex size-10 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
        active && "bg-accent text-foreground",
      )}
    >
      {children}
      {badge != null && badge > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-primary text-[9px] font-medium text-primary-foreground">
          {badge > 9 ? "9+" : badge}
        </span>
      )}
    </button>
  )
}

export function WorkspaceSidebar({
  workspaces,
  sessionsByWorkspace,
  activeWorkspaceId,
  activeSessionId,
  processingSessionIds,
  onSelectWorkspace,
  onSelectSession,
  onNewSession,
  onDeleteSession,
  onAddLocalWorkspace,
  onAddSshWorkspace,
  onRemoveWorkspace,
  onOpenKnowledge,
  knowledgeCount,
  collapsed = false,
  onToggleCollapse,
}: {
  workspaces: AssistantWorkspace[]
  sessionsByWorkspace: Map<string, AssistantSession[]>
  activeWorkspaceId: string
  activeSessionId: string
  processingSessionIds: ReadonlySet<string>
  onSelectWorkspace: (id: string) => void
  onSelectSession: (id: string) => void
  onNewSession: (workspaceId: string) => void
  onDeleteSession: (id: string) => void
  onAddLocalWorkspace: () => void | Promise<void>
  onAddSshWorkspace: (input: { name: string; host: string; remotePath: string }) => void | Promise<void>
  onRemoveWorkspace: (workspace: AssistantWorkspace) => void | Promise<void>
  onOpenKnowledge: () => void
  knowledgeCount: number
  collapsed?: boolean
  onToggleCollapse?: () => void
}) {
  const { resolvedTheme, toggleTheme } = useApp()
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(workspaces.map((w) => w.projectId)))
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const [sshOpen, setSshOpen] = useState(false)
  const [query, setQuery] = useState("")

  const filteredTree = useMemo(() => {
    const q = query.trim().toLowerCase()
    return workspaces
      .map((ws) => {
        const sessions = sessionsByWorkspace.get(ws.projectId) ?? []
        if (!q) return { ws, sessions }
        const matched = sessions.filter(
          (s) =>
            s.title.toLowerCase().includes(q) ||
            s.messages.some((m) => m.content.toLowerCase().includes(q)),
        )
        if (matched.length > 0 || ws.name.toLowerCase().includes(q)) {
          return { ws, sessions: matched.length > 0 ? matched : sessions }
        }
        return null
      })
      .filter(Boolean) as { ws: AssistantWorkspace; sessions: AssistantSession[] }[]
  }, [workspaces, sessionsByWorkspace, query])

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectWorkspaceFromRail = (workspaceId: string) => {
    onSelectWorkspace(workspaceId)
  }

  const sshDialog = (
    <NewProjectDialog
      open={sshOpen}
      onClose={() => setSshOpen(false)}
      onCreate={(p: Project) => {
        void onAddSshWorkspace({
          name: p.name,
          host: p.sshHost ?? "",
          remotePath: p.localPath,
        })
      }}
    />
  )

  if (collapsed) {
    return (
      <>
        <aside className="flex h-full w-14 shrink-0 flex-col items-center gap-1.5 border-r border-border bg-card/40 px-1 py-2.5">
          <CollapsedIconButton
            title="展开侧栏"
            ariaLabel="展开侧栏"
            onClick={onToggleCollapse}
          >
            <PanelLeftOpen className="size-5" />
          </CollapsedIconButton>

          <div className="flex min-h-0 w-full flex-1 flex-col items-center gap-1 overflow-y-auto scrollbar-thin">
            {workspaces.map((ws) => {
              const wsSessions = sessionsByWorkspace.get(ws.projectId) ?? []
              const wsProcessing = wsSessions.some((s) => processingSessionIds.has(s.id))
              return (
                <SidebarProcessingBorder key={ws.projectId} active={wsProcessing}>
                  <CollapsedIconButton
                    active={ws.projectId === activeWorkspaceId}
                    title={`${ws.name}\n${ws.subtitle}`}
                    ariaLabel={ws.name}
                    onClick={() => selectWorkspaceFromRail(ws.projectId)}
                  >
                    <WorkspaceIcon ws={ws} className="size-5" />
                  </CollapsedIconButton>
                </SidebarProcessingBorder>
              )
            })}
          </div>

          <div className="mt-auto flex flex-col items-center gap-1">
            <CollapsedIconButton
              title="知识库"
              ariaLabel="知识库"
              onClick={onOpenKnowledge}
              badge={knowledgeCount}
            >
              <BookUp className="size-5" />
            </CollapsedIconButton>
            <CollapsedIconButton
              title="切换主题"
              ariaLabel="切换主题"
              onClick={toggleTheme}
            >
              {resolvedTheme === "dark" ? <Sun className="size-5" /> : <Moon className="size-5" />}
            </CollapsedIconButton>
            <Link
              href="/settings"
              title="设置"
              aria-label="设置"
              className="flex size-10 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Settings className="size-5" />
            </Link>
          </div>
        </aside>
        {sshDialog}
      </>
    )
  }

  return (
    <>
      <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-card/40">
        <div className="flex items-center justify-between gap-1 px-2 py-2">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onToggleCollapse}
            aria-label="收起侧栏"
            title="收起侧栏"
          >
            <PanelLeftClose className="size-5" />
          </Button>
          <div className="relative">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="添加工作区"
              aria-expanded={addMenuOpen}
              onClick={() => setAddMenuOpen((o) => !o)}
            >
              <Plus className="size-5" />
            </Button>
            {addMenuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setAddMenuOpen(false)} aria-hidden />
                <div className="absolute right-0 top-full z-20 mt-1 w-44 overflow-hidden rounded-lg border border-border bg-popover py-1 shadow-xl">
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
                    onClick={() => {
                      setAddMenuOpen(false)
                      void onAddLocalWorkspace()
                    }}
                  >
                    <Folder className="size-3.5 text-muted-foreground" />
                    添加本地目录
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
                    onClick={() => {
                      setAddMenuOpen(false)
                      setSshOpen(true)
                    }}
                  >
                    <Server className="size-3.5 text-muted-foreground" />
                    Connect SSH
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="px-2.5 py-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索对话…"
            className="h-8 w-full rounded-md border border-border bg-background px-2.5 text-xs outline-none focus:border-ring"
            aria-label="搜索对话"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2 scrollbar-thin">
          {filteredTree.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">没有匹配的工作区或对话</p>
          ) : (
            filteredTree.map(({ ws, sessions }) => {
              const isExpanded = expanded.has(ws.projectId)
              const isActiveWs = ws.projectId === activeWorkspaceId
              const wsProcessing = sessions.some((s) => processingSessionIds.has(s.id))
              return (
                <div key={ws.projectId} className="mb-1">
                  <SidebarProcessingBorder
                    active={wsProcessing}
                    innerClassName={isActiveWs ? "bg-accent/60" : undefined}
                  >
                    <div
                      className={cn(
                        "group flex items-center gap-1 rounded-md px-1 py-1",
                        isActiveWs && "bg-accent/60",
                      )}
                    >
                    <button
                      type="button"
                      onClick={() => {
                        toggleExpanded(ws.projectId)
                        onSelectWorkspace(ws.projectId)
                      }}
                      className="flex min-w-0 flex-1 items-center gap-1 text-left"
                    >
                      {isExpanded ? (
                        <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                      )}
                      <WorkspaceIcon ws={ws} className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium">{ws.name}</span>
                        <span className="block truncate font-mono text-[10px] text-muted-foreground">
                          {ws.subtitle}
                        </span>
                      </span>
                    </button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="shrink-0 opacity-0 group-hover:opacity-100"
                      aria-label={`在 ${ws.name} 新建对话`}
                      onClick={() => onNewSession(ws.projectId)}
                    >
                      <Plus className="size-3" />
                    </Button>
                    {!ws.isHome && (
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="shrink-0 text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100"
                        aria-label={`删除 ${ws.name}`}
                        onClick={() => void onRemoveWorkspace(ws)}
                      >
                        <Trash2 className="size-3" />
                      </Button>
                    )}
                  </div>
                  </SidebarProcessingBorder>
                  {isExpanded && (
                    <div className="ml-4 space-y-0.5 border-l border-border/60 pl-2">
                      {sessions.length === 0 ? (
                        <p className="px-2 py-2 text-[10px] text-muted-foreground">暂无对话</p>
                      ) : (
                        sessions.map((s) => (
                          <SidebarProcessingBorder
                            key={s.id}
                            active={processingSessionIds.has(s.id)}
                            innerClassName={s.id === activeSessionId ? "bg-accent" : undefined}
                          >
                            <div
                              className={cn(
                                "group flex items-center gap-1 rounded-md px-1.5 py-1",
                                s.id === activeSessionId ? "bg-accent" : "hover:bg-accent/50",
                              )}
                            >
                            <button
                              type="button"
                              onClick={() => {
                                onSelectSession(s.id)
                              }}
                              className="flex min-w-0 flex-1 items-center gap-2 text-left"
                            >
                              <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
                              <span className="truncate text-xs">{s.title}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => onDeleteSession(s.id)}
                              className="shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                              aria-label={`删除对话 ${s.title}`}
                            >
                              <Trash2 className="size-3" />
                            </button>
                            </div>
                          </SidebarProcessingBorder>
                        ))
                      )}
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>

        <div className="mt-auto p-1.5">
          <button
            type="button"
            onClick={onOpenKnowledge}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <BookUp className="size-5" />
            <span className="flex-1 text-left">知识库</span>
            {knowledgeCount > 0 && (
              <span className="rounded-full bg-primary/15 px-1.5 text-[10px] text-primary">
                {knowledgeCount}
              </span>
            )}
          </button>
          <Link
            href="/settings"
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Settings className="size-5" />
            设置
          </Link>
          <button
            type="button"
            onClick={toggleTheme}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label="切换主题"
          >
            {resolvedTheme === "dark" ? <Sun className="size-5" /> : <Moon className="size-5" />}
            主题
          </button>
        </div>
      </aside>
      {sshDialog}
    </>
  )
}
