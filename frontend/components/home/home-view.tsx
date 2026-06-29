"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import {
  Search,
  Plus,
  Server,
  Settings,
  Sun,
  Moon,
  FolderOpen,
  Trash2,
  Pin,
  GitBranch,
  ArrowRight,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Wordmark } from "@/components/brand"
import { CiBadge } from "@/components/ci-badge"
import { ProjectCard } from "@/components/home/project-card"
import { NewProjectDialog } from "@/components/home/new-project-dialog"
import { EmptyState, ErrorState, ProjectCardSkeleton, RowSkeleton, Skeleton } from "@/components/states"
import { useApp } from "@/components/app-provider"
import { projects as seedProjects } from "@/lib/mock-data"
import { timeAgo } from "@/lib/format"
import type { Project } from "@/lib/types"
import { isTauri, listProjects as tauriListProjects } from "@/lib/tauri-api"

type LoadStatus = "loading" | "error" | "ready"

export function HomeView() {
  const { resolvedTheme, toggleTheme } = useApp()
  const [projects, setProjects] = useState<Project[]>(seedProjects)
  const [query, setQuery] = useState("")
  const [dialog, setDialog] = useState<null | "new" | "ssh">(null)
  const [historyPage, setHistoryPage] = useState(0)
  const [status, setStatus] = useState<LoadStatus>("loading")

  useEffect(() => {
    let cancelled = false
    let tid: ReturnType<typeof setTimeout> | null = null

    const load = async () => {
      setStatus("loading")
      if (isTauri()) {
        try {
          const realProjects = await tauriListProjects()
          if (!cancelled && realProjects.length > 0) {
            setProjects(realProjects)
            setStatus("ready")
            return
          }
        } catch { /* fallback to mock */ }
      }
      if (!cancelled) {
        tid = setTimeout(() => {
          if (!cancelled) {
            setStatus("ready")
            setProjects(seedProjects as Project[])
          }
        }, 700)
      }
    }

    load()
    return () => {
      cancelled = true
      if (tid !== null) clearTimeout(tid)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return projects
    return projects.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.language.toLowerCase().includes(q) ||
        p.framework.toLowerCase().includes(q) ||
        p.lastChatSummary.toLowerCase().includes(q),
    )
  }, [projects, query])

  const pinned = filtered.filter((p) => p.pinned)
  const recent = [...filtered].sort(
    (a, b) => new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime(),
  )

  const togglePin = (id: string) =>
    setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, pinned: !p.pinned } : p)))

  const removeProject = (id: string) => setProjects((prev) => prev.filter((p) => p.id !== id))

  const addProject = (p: Project) => setProjects((prev) => [p, ...prev])

  const pageSize = 4
  const pagedHistory = recent.slice(historyPage * pageSize, historyPage * pageSize + pageSize)
  const totalPages = Math.max(1, Math.ceil(recent.length / pageSize))

  return (
    <div className="mx-auto flex min-h-dvh max-w-6xl flex-col px-4 pb-16 sm:px-6">
      {/* Top bar */}
      <header className="sticky top-0 z-20 -mx-4 flex items-center gap-3 border-b border-border bg-background/80 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <Wordmark />
        <div className="relative ml-2 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setHistoryPage(0)
            }}
            placeholder="搜索项目、语言、最近聊天…"
            className="h-9 pl-8"
            aria-label="搜索项目"
          />
        </div>
        <Button variant="secondary" size="sm" onClick={() => setDialog("ssh")}>
          <Server />
          连接 SSH
        </Button>
        <Button size="sm" onClick={() => setDialog("new")}>
          <Plus />
          新建项目
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={toggleTheme} aria-label="切换主题">
          {resolvedTheme === "dark" ? <Sun /> : <Moon />}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          nativeButton={false}
          render={<Link href="/settings" aria-label="设置" />}
        >
          <Settings />
        </Button>
      </header>

      <main className="flex flex-col gap-8 pt-8">
        {/* Loading 骨架屏 */}
        {status === "loading" ? (
          <div className="flex flex-col gap-8">
            <section>
              <Skeleton className="mb-3 h-3 w-24" />
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <ProjectCardSkeleton key={i} />
                ))}
              </div>
            </section>
            <section>
              <div className="overflow-hidden rounded-xl border border-border">
                {[0, 1, 2].map((i) => (
                  <div key={i} className={i !== 0 ? "border-t border-border" : ""}>
                    <RowSkeleton />
                  </div>
                ))}
              </div>
            </section>
          </div>
        ) : status === "error" ? (
          <ErrorState
            title="加载项目失败"
            description="无法读取本地项目索引，请检查权限或重试。"
            onRetry={loadProjects}
          />
        ) : filtered.length === 0 ? (
          query.trim() ? (
            <EmptyState
              icon={Search}
              title={`没有匹配 “${query}” 的项目`}
              description="尝试其它关键词，或打开你的第一个项目。"
              action={
                <Button size="sm" onClick={() => setDialog("new")}>
                  <Plus />
                  新建项目
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={FolderOpen}
              title="还没有项目"
              description="打开本地文件夹或连接远程 SSH，开始你的第一个 AI 编码会话。"
              action={
                <Button size="sm" onClick={() => setDialog("new")}>
                  <Plus />
                  打开第一个项目
                </Button>
              }
            />
          )
        ) : (
          <>
            {pinned.length > 0 && (
              <section>
                <div className="mb-3 flex items-center gap-2">
                  <Pin className="size-3.5 text-primary" />
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    置顶项目
                  </h2>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {pinned.map((p) => (
                    <ProjectCard key={p.id} project={p} onTogglePin={togglePin} />
                  ))}
                </div>
              </section>
            )}

            <section>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  全部项目
                </h2>
                <span className="text-xs text-muted-foreground">{filtered.length} 个项目</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {recent.map((p) => (
                  <ProjectCard key={p.id} project={p} onTogglePin={togglePin} />
                ))}
              </div>
            </section>

            {/* History */}
            <section>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  历史记录
                </h2>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="xs"
                    disabled={historyPage === 0}
                    onClick={() => setHistoryPage((p) => Math.max(0, p - 1))}
                  >
                    上一页
                  </Button>
                  <span className="px-1 text-xs text-muted-foreground">
                    {historyPage + 1}/{totalPages}
                  </span>
                  <Button
                    variant="ghost"
                    size="xs"
                    disabled={historyPage >= totalPages - 1}
                    onClick={() => setHistoryPage((p) => Math.min(totalPages - 1, p + 1))}
                  >
                    下一页
                  </Button>
                </div>
              </div>
              <div className="overflow-hidden rounded-xl border border-border">
                {pagedHistory.map((p, i) => (
                  <div
                    key={p.id}
                    className={`group flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-accent/40 ${
                      i !== 0 ? "border-t border-border" : ""
                    }`}
                  >
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-secondary text-muted-foreground">
                      {p.kind === "ssh" ? <Server className="size-3.5" /> : <FolderOpen className="size-3.5" />}
                    </span>
                    <Link href={`/project/${p.id}`} className="flex min-w-0 flex-1 items-center gap-2">
                      <span className="truncate text-sm font-medium">{p.name}</span>
                      {p.kind === "ssh" && (
                        <Badge variant="outline" className="hidden sm:inline-flex">
                          {p.sshHost}
                        </Badge>
                      )}
                      <span className="hidden items-center gap-1 text-xs text-muted-foreground sm:flex">
                        <GitBranch className="size-3" />
                        {p.gitBranch}
                      </span>
                    </Link>
                    <div className="hidden md:block">
                      <CiBadge status={p.ciStatus} />
                    </div>
                    <span className="hidden w-20 text-right text-xs text-muted-foreground sm:block">
                      {timeAgo(p.openedAt)}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label="置顶"
                      onClick={() => togglePin(p.id)}
                      className={p.pinned ? "text-primary" : "opacity-0 group-hover:opacity-100"}
                    >
                      <Pin className={p.pinned ? "fill-current" : ""} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label="删除记录"
                      onClick={() => removeProject(p.id)}
                      className="opacity-0 group-hover:opacity-100 hover:text-destructive"
                    >
                      <Trash2 />
                    </Button>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
      </main>

      <footer className="mt-auto flex items-center justify-between pt-10 text-xs text-muted-foreground">
        <span>BoschCode · 本地 AI Coding Agent</span>
        <Link href="/settings" className="flex items-center gap-1 hover:text-foreground">
          全局设置 <ArrowRight className="size-3" />
        </Link>
      </footer>

      <NewProjectDialog
        open={dialog !== null}
        mode={dialog ?? "new"}
        onClose={() => setDialog(null)}
        onCreate={addProject}
      />
    </div>
  )
}
