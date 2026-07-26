"use client"

import { useState } from "react"
import Link from "next/link"
import { projectPath } from "@/lib/project-route"
import {
  Pin,
  GitBranch,
  FolderGit2,
  Server,
  MoreVertical,
  FolderOpen,
  Copy,
  Trash2,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Modal } from "@/components/ui/modal"
import { CiBadge } from "@/components/ci-badge"
import { timeAgo, langColor } from "@/lib/format"
import { isTauri, revealInExplorer } from "@/lib/tauri-api"
import type { Project } from "@/lib/types"
import { cn } from "@/lib/utils"

export function ProjectCard({
  project,
  onTogglePin,
  onDelete,
}: {
  project: Project
  onTogglePin?: (id: string) => void
  onDelete?: (id: string) => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const closeMenu = () => setMenuOpen(false)

  const handleReveal = async () => {
    closeMenu()
    if (isTauri()) {
      try {
        await revealInExplorer(project.id, ".")
      } catch {
        /* ignore */
      }
      return
    }
    if (typeof window !== "undefined" && project.localPath) {
      void navigator.clipboard.writeText(project.localPath)
    }
  }

  const handleCopyPath = async () => {
    closeMenu()
    if (project.localPath) {
      await navigator.clipboard.writeText(project.localPath)
    }
  }

  return (
    <>
      <div className="group relative flex cursor-pointer flex-col gap-2 rounded-lg border border-border bg-card p-3 transition-colors hover:border-primary/40 hover:bg-accent/40">
        <Link
          href={projectPath(project.id)}
          className="absolute inset-0 z-0 rounded-lg"
          aria-label={`打开项目 ${project.name}`}
          tabIndex={-1}
        />

        <div className="pointer-events-none relative z-10 flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span
              className="flex size-7 shrink-0 items-center justify-center rounded-md bg-secondary text-secondary-foreground"
              aria-hidden
            >
              {project.kind === "ssh" ? <Server className="size-3.5" /> : <FolderGit2 className="size-3.5" />}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{project.name}</p>
              <p className="truncate text-xs text-muted-foreground">{project.localPath}</p>
            </div>
          </div>
          <div className="pointer-events-auto relative flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={project.pinned ? "取消置顶" : "置顶"}
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
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
              aria-expanded={menuOpen}
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setMenuOpen((open) => !open)
              }}
              className={cn("opacity-0 group-hover:opacity-100", menuOpen && "opacity-100")}
            >
              <MoreVertical />
            </Button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-20" onClick={closeMenu} aria-hidden />
                <div className="absolute right-0 top-7 z-30 min-w-[160px] rounded-md border border-border bg-popover py-1 shadow-lg">
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-accent"
                    onClick={(e) => {
                      e.stopPropagation()
                      onTogglePin?.(project.id)
                      closeMenu()
                    }}
                  >
                    <Pin className="size-3" />
                    {project.pinned ? "取消置顶" : "置顶项目"}
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-accent"
                    onClick={(e) => {
                      e.stopPropagation()
                      void handleReveal()
                    }}
                  >
                    <FolderOpen className="size-3" />
                    {isTauri() ? "在资源管理器中打开" : "复制路径"}
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-accent"
                    onClick={(e) => {
                      e.stopPropagation()
                      void handleCopyPath()
                    }}
                  >
                    <Copy className="size-3" />
                    复制路径
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-destructive hover:bg-destructive/10"
                    onClick={(e) => {
                      e.stopPropagation()
                      closeMenu()
                      setConfirmDelete(true)
                    }}
                  >
                    <Trash2 className="size-3" />
                    从列表移除
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        <p className="pointer-events-none relative z-10 line-clamp-1 text-xs leading-normal text-muted-foreground">
          {project.lastChatSummary}
        </p>

        <div className="pointer-events-none relative z-10 flex flex-wrap items-center gap-1.5">
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

        <div className="pointer-events-none relative z-10 flex items-center justify-between border-t border-border pt-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <GitBranch className="size-3" />
            {project.gitBranch}
          </span>
          <span>{timeAgo(project.openedAt)}</span>
        </div>
      </div>

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="从列表移除项目？"
        description={`「${project.name}」将从 YourMate 中移除，本地文件夹不会被删除。`}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
              取消
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                setConfirmDelete(false)
                onDelete?.(project.id)
              }}
            >
              移除
            </Button>
          </>
        }
      >
        <p className="text-xs text-muted-foreground">{project.localPath}</p>
      </Modal>
    </>
  )
}
