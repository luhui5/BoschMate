"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import {
  Search,
  Plus,
  Server,
  Code2,
  FolderOpen,
  Pin,
  ChevronLeft,
  ChevronRight,
  Loader2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ProjectCard } from "@/components/home/project-card"
import { NewProjectDialog } from "@/components/home/new-project-dialog"
import { EmptyState, ErrorState, ProjectCardSkeleton, Skeleton } from "@/components/states"
import type { Project } from "@/lib/types"
import { isTauri, listProjects as tauriListProjects, removeProject } from "@/lib/tauri-api"
import { applyProjectPins, toggleProjectPinned, clearProjectPin } from "@/lib/project-prefs"
import { pickAndOpenLocalProject } from "@/lib/open-local-project"
import { projectPath } from "@/lib/project-route"

type LoadStatus = "loading" | "error" | "ready"

const CARDS_PER_PAGE = 12 // fills up to 4 columns x 3 rows on wide desktop windows

export function HomeView() {
  const router = useRouter()
  const [projects, setProjects] = useState<Project[]>([])
  const [query, setQuery] = useState("")
  const [sshDialogOpen, setSshDialogOpen] = useState(false)
  const [openingLocal, setOpeningLocal] = useState(false)
  const [openError, setOpenError] = useState<string | null>(null)
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
          if (!cancelled) {
            setProjects(applyProjectPins(realProjects))
            setStatus("ready")
          }
          return
        } catch {
          if (!cancelled) setStatus("error")
          return
        }
      }
      if (!cancelled) {
        const { projects: seedProjects } = await import("@/lib/mock-data")
        tid = setTimeout(() => {
          if (!cancelled) {
            setProjects(applyProjectPins(seedProjects as Project[]))
            setStatus("ready")
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

  const addProject = (p: Project) => setProjects((prev) => applyProjectPins([p, ...prev]))

  const upsertProject = (p: Project) => {
    setProjects((prev) => {
      const rest = prev.filter((item) => item.id !== p.id)
      return applyProjectPins([p, ...rest])
    })
  }

  const handleOpenLocalProject = async () => {
    setOpenError(null)
    setOpeningLocal(true)
    try {
      const project = await pickAndOpenLocalProject()
      if (!project) return
      upsertProject(project)
      router.push(projectPath(project.id))
    } catch (e) {
      setOpenError(e instanceof Error ? e.message : "打开项目失败")
    } finally {
      setOpeningLocal(false)
    }
  }

  const handleTogglePin = (id: string) => {
    toggleProjectPinned(id)
    setProjects((prev) =>
      prev.map((p) => (p.id === id ? { ...p, pinned: !p.pinned } : p)),
    )
  }

  const handleDeleteProject = async (id: string) => {
    if (isTauri()) {
      try {
        await removeProject(id)
      } catch {
        return
      }
    }
    clearProjectPin(id)
    setProjects((prev) => prev.filter((p) => p.id !== id))
  }

  const projectCardProps = {
    onTogglePin: handleTogglePin,
    onDelete: (id: string) => void handleDeleteProject(id),
  }

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
    <div className="w-full px-4 pb-4 sm:px-6">
      {/* Top bar */}
      <header className="sticky top-[34px] z-20 -mx-4 flex items-center gap-3 border-b border-border bg-background/80 px-4 py-2.5 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="flex items-center gap-2">
          <Code2 className="size-5 text-primary" />
          <span className="text-sm font-semibold">Coding Agent</span>
        </div>
        <div className="relative ml-2 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="搜索项目、语言、对话历史…"
            className="h-9 pl-8"
            aria-label="Search projects"
          />
        </div>
        <Button variant="secondary" size="sm" onClick={() => setSshDialogOpen(true)}>
          <Server />
          Connect SSH
        </Button>
        <Button size="sm" onClick={() => void handleOpenLocalProject()} disabled={openingLocal}>
          {openingLocal ? <Loader2 className="size-4 animate-spin" /> : <Plus />}
          New Project
        </Button>
      </header>

      {openError && (
        <p className="mt-2 text-xs text-destructive" role="alert">
          {openError}
        </p>
      )}

      <main className="pt-3">
        {/* Loading */}
        {status === "loading" ? (
          <section>
            <Skeleton className="mb-2.5 h-3 w-24" />
            <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
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
                <Button size="sm" onClick={() => void handleOpenLocalProject()} disabled={openingLocal}>
                  {openingLocal ? <Loader2 className="size-4 animate-spin" /> : <Plus />}
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
                <Button size="sm" onClick={() => void handleOpenLocalProject()} disabled={openingLocal}>
                  {openingLocal ? <Loader2 className="size-4 animate-spin" /> : <FolderOpen />}
                  Open First Project
                </Button>
              }
            />
          )
        ) : (
          <>
            {/* Pinned projects */}
            {pinned.length > 0 && (
              <section className="mb-4">
                <div className="mb-2.5 flex items-center gap-2">
                  <Pin className="size-3.5 text-primary" />
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Pinned
                  </h2>
                </div>
                <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                  {pinned.map((p) => (
                    <ProjectCard key={p.id} project={p} {...projectCardProps} />
                  ))}
                </div>
              </section>
            )}

            {/* All projects - paginated grid */}
            <section>
              <div className="mb-2.5 flex items-center justify-between">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  All Projects
                </h2>
                <span className="text-xs text-muted-foreground">
                  {filtered.length} projects
                </span>
              </div>

              <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                {pagedProjects.map((p) => (
                  <ProjectCard key={p.id} project={p} {...projectCardProps} />
                ))}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="mt-4 flex items-center justify-center gap-2">
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
        open={sshDialogOpen}
        onClose={() => setSshDialogOpen(false)}
        onCreate={addProject}
      />
    </div>
  )
}
