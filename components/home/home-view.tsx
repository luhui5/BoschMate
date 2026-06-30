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
  Pin,
  ChevronLeft,
  ChevronRight,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Wordmark } from "@/components/brand"
import { ProjectCard } from "@/components/home/project-card"
import { NewProjectDialog } from "@/components/home/new-project-dialog"
import { EmptyState, ErrorState, ProjectCardSkeleton, Skeleton } from "@/components/states"
import { useApp } from "@/components/app-provider"
import { projects as seedProjects } from "@/lib/mock-data"
import type { Project } from "@/lib/types"
import { isTauri, listProjects as tauriListProjects } from "@/lib/tauri-api"

type LoadStatus = "loading" | "error" | "ready"

const CARDS_PER_PAGE = 9 // 3 columns x 3 rows

export function HomeView() {
  const { resolvedTheme, toggleTheme } = useApp()
  const [projects, setProjects] = useState<Project[]>(seedProjects)
  const [query, setQuery] = useState("")
  const [dialog, setDialog] = useState<null | "new" | "ssh">(null)
  const [projectPage, setProjectPage] = useState(0)
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
  const unpinned = [...filtered].sort(
    (a, b) => new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime(),
  )

  const addProject = (p: Project) => setProjects((prev) => [p, ...prev])

  const totalPages = Math.max(1, Math.ceil(unpinned.length / CARDS_PER_PAGE))
  const pagedProjects = unpinned.slice(
    projectPage * CARDS_PER_PAGE,
    projectPage * CARDS_PER_PAGE + CARDS_PER_PAGE,
  )

  const handleSearch = (value: string) => {
    setQuery(value)
    setProjectPage(0)
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-6xl flex-col px-4 pb-8 sm:px-6">
      {/* Top bar */}
      <header className="sticky top-0 z-20 -mx-4 flex items-center gap-3 border-b border-border bg-background/80 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <Wordmark />
        <div className="relative ml-2 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search projects, language, chat history..."
            className="h-9 pl-8"
            aria-label="Search projects"
          />
        </div>
        <Button variant="secondary" size="sm" onClick={() => setDialog("ssh")}>
          <Server />
          Connect SSH
        </Button>
        <Button size="sm" onClick={() => setDialog("new")}>
          <Plus />
          New Project
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={toggleTheme} aria-label="Toggle theme">
          {resolvedTheme === "dark" ? <Sun /> : <Moon />}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          nativeButton={false}
          render={<Link href="/settings" aria-label="Settings" />}
        >
          <Settings />
        </Button>
      </header>

      <main className="flex flex-col gap-4 pt-4">
        {/* Loading */}
        {status === "loading" ? (
          <section>
            <Skeleton className="mb-3 h-3 w-24" />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: CARDS_PER_PAGE }, (_, i) => (
                <ProjectCardSkeleton key={i} />
              ))}
            </div>
          </section>
        ) : status === "error" ? (
          <ErrorState
            title="Failed to load projects"
            description="Could not read local project index. Check permissions and retry."
            onRetry={() => window.location.reload()}
          />
        ) : filtered.length === 0 ? (
          query.trim() ? (
            <EmptyState
              icon={Search}
              title={`No projects matching "${query}"`}
              description="Try another keyword, or open your first project."
              action={
                <Button size="sm" onClick={() => setDialog("new")}>
                  <Plus />
                  New Project
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={FolderOpen}
              title="No projects yet"
              description="Open a local folder or connect via SSH to start your first AI coding session."
              action={
                <Button size="sm" onClick={() => setDialog("new")}>
                  <Plus />
                  Open First Project
                </Button>
              }
            />
          )
        ) : (
          <>
            {/* Pinned projects */}
            {pinned.length > 0 && (
              <section>
                <div className="mb-3 flex items-center gap-2">
                  <Pin className="size-3.5 text-primary" />
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Pinned
                  </h2>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {pinned.map((p) => (
                    <ProjectCard key={p.id} project={p} />
                  ))}
                </div>
              </section>
            )}

            {/* All projects - paginated grid */}
            <section>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  All Projects
                </h2>
                <span className="text-xs text-muted-foreground">
                  {filtered.length} projects
                </span>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {pagedProjects.map((p) => (
                  <ProjectCard key={p.id} project={p} />
                ))}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-2">
                  <Button
                    variant="ghost"
                    size="xs"
                    disabled={projectPage === 0}
                    onClick={() => setProjectPage((p) => p - 1)}
                  >
                    <ChevronLeft className="size-3.5" />
                  </Button>
                  {Array.from({ length: totalPages }, (_, i) => (
                    <Button
                      key={i}
                      variant={i === projectPage ? "default" : "ghost"}
                      size="xs"
                      className="min-w-[2rem]"
                      onClick={() => setProjectPage(i)}
                    >
                      {i + 1}
                    </Button>
                  ))}
                  <Button
                    variant="ghost"
                    size="xs"
                    disabled={projectPage >= totalPages - 1}
                    onClick={() => setProjectPage((p) => p + 1)}
                  >
                    <ChevronRight className="size-3.5" />
                  </Button>
                </div>
              )}
            </section>
          </>
        )}
      </main>

      <NewProjectDialog
        open={dialog !== null}
        mode={dialog ?? "new"}
        onClose={() => setDialog(null)}
        onCreate={addProject}
      />
    </div>
  )
}
