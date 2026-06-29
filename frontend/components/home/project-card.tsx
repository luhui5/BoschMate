"use client"

import Link from "next/link"
import { Pin, GitBranch, FolderGit2, Server, MoreVertical } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { CiBadge } from "@/components/ci-badge"
import { timeAgo, langColor } from "@/lib/format"
import type { Project } from "@/lib/types"

export function ProjectCard({
  project,
  onTogglePin,
}: {
  project: Project
  onTogglePin?: (id: string) => void
}) {
  return (
    <Link
      href={`/project/${project.id}`}
      className="group relative flex flex-col gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-accent/40"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="flex size-8 shrink-0 items-center justify-center rounded-md bg-secondary text-secondary-foreground"
            aria-hidden
          >
            {project.kind === "ssh" ? <Server className="size-4" /> : <FolderGit2 className="size-4" />}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{project.name}</p>
            <p className="truncate text-xs text-muted-foreground">{project.localPath}</p>
          </div>
        </div>
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={project.pinned ? "取消置顶" : "置顶"}
            onClick={(e) => {
              e.preventDefault()
              onTogglePin?.(project.id)
            }}
            className={project.pinned ? "text-primary" : "opacity-0 group-hover:opacity-100"}
          >
            <Pin className={project.pinned ? "fill-current" : ""} />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="更多操作"
            onClick={(e) => e.preventDefault()}
            className="opacity-0 group-hover:opacity-100"
          >
            <MoreVertical />
          </Button>
        </div>
      </div>

      <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
        {project.lastChatSummary}
      </p>

      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="outline">
          <span
            className="size-2 rounded-full"
            style={{ backgroundColor: langColor[project.language] ?? "var(--muted-foreground)" }}
          />
          {project.language}
        </Badge>
        <Badge variant="outline">{project.framework}</Badge>
        <CiBadge status={project.ciStatus} />
      </div>

      <div className="mt-1 flex items-center justify-between border-t border-border pt-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <GitBranch className="size-3" />
          {project.gitBranch}
        </span>
        <span>{timeAgo(project.openedAt)}</span>
      </div>
    </Link>
  )
}
