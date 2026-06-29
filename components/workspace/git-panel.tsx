"use client"

import { useState } from "react"
import { GitBranch, GitCommitHorizontal, GitPullRequest, Plus, Minus, FileQuestion } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea, Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import type { GitFile, Project } from "@/lib/types"

const statusColor: Record<GitFile["status"], string> = {
  modified: "text-warning",
  added: "text-success",
  deleted: "text-destructive",
  renamed: "text-primary",
  untracked: "text-muted-foreground",
}

const statusMark: Record<GitFile["status"], string> = {
  modified: "M",
  added: "A",
  deleted: "D",
  renamed: "R",
  untracked: "U",
}

export function GitPanel({
  project,
  files: initial,
  onOpenFile,
}: {
  project: Project
  files: GitFile[]
  onOpenFile: (path: string) => void
}) {
  const [files, setFiles] = useState<GitFile[]>(initial)
  const [commitMsg, setCommitMsg] = useState("")
  const [committed, setCommitted] = useState<string | null>(null)

  const staged = files.filter((f) => f.staged)
  const unstaged = files.filter((f) => !f.staged)

  const toggleStage = (path: string) =>
    setFiles((prev) => prev.map((f) => (f.path === path ? { ...f, staged: !f.staged } : f)))

  const stageAll = () => setFiles((prev) => prev.map((f) => ({ ...f, staged: true })))

  const commit = () => {
    if (!commitMsg.trim() || staged.length === 0) return
    setCommitted(commitMsg.trim())
    setFiles((prev) => prev.filter((f) => !f.staged))
    setCommitMsg("")
  }

  const Row = ({ f }: { f: GitFile }) => (
    <div className="group flex items-center gap-2 rounded px-1.5 py-1 hover:bg-accent">
      <input
        type="checkbox"
        checked={f.staged}
        onChange={() => toggleStage(f.path)}
        className="size-3.5 accent-[var(--primary)]"
        aria-label={`暂存 ${f.path}`}
      />
      <span className={cn("w-4 text-center font-mono text-xs", statusColor[f.status])}>
        {statusMark[f.status]}
      </span>
      <button onClick={() => onOpenFile(f.path)} className="truncate font-mono text-xs hover:underline">
        {f.path}
      </button>
      <span className="ml-auto flex shrink-0 items-center gap-1.5 text-[10px]">
        {f.status === "untracked" ? (
          <FileQuestion className="size-3 text-muted-foreground" />
        ) : (
          <>
            <span className="text-success">+{f.additions}</span>
            <span className="text-destructive">-{f.deletions}</span>
          </>
        )}
      </span>
    </div>
  )

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-xs">
        <GitBranch className="size-3.5 text-muted-foreground" />
        <span className="font-medium">{project.gitBranch}</span>
        <span className="ml-auto text-muted-foreground">{project.gitRemote}</span>
      </div>

      <div className="flex-1 overflow-auto scrollbar-thin">
        {committed && (
          <div className="m-2 rounded-md border border-success/30 bg-success/10 p-2 text-xs">
            <p className="font-medium text-success">已提交</p>
            <p className="mt-0.5 text-muted-foreground">{committed}</p>
          </div>
        )}

        {/* Staged */}
        <div className="p-2">
          <div className="mb-1 flex items-center justify-between px-1.5">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              已暂存 ({staged.length})
            </span>
          </div>
          {staged.length === 0 ? (
            <p className="px-1.5 py-2 text-xs text-muted-foreground">没有已暂存的变更。</p>
          ) : (
            staged.map((f) => <Row key={f.path} f={f} />)
          )}
        </div>

        {/* Unstaged */}
        <div className="p-2">
          <div className="mb-1 flex items-center justify-between px-1.5">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              变更 ({unstaged.length})
            </span>
            {unstaged.length > 0 && (
              <Button variant="ghost" size="xs" onClick={stageAll}>
                <Plus />
                全部暂存
              </Button>
            )}
          </div>
          {unstaged.length === 0 ? (
            <p className="px-1.5 py-2 text-xs text-muted-foreground">工作区干净。</p>
          ) : (
            unstaged.map((f) => <Row key={f.path} f={f} />)
          )}
        </div>
      </div>

      {/* Commit box */}
      <div className="border-t border-border p-2">
        <Textarea
          value={commitMsg}
          onChange={(e) => setCommitMsg(e.target.value)}
          rows={2}
          placeholder="提交信息…"
          className="mb-2 text-xs"
        />
        <div className="flex gap-1.5">
          <Button
            size="sm"
            className="flex-1"
            onClick={commit}
            disabled={!commitMsg.trim() || staged.length === 0}
          >
            <GitCommitHorizontal />
            提交 ({staged.length})
          </Button>
          <Button variant="outline" size="sm" title="push 需确认">
            <GitPullRequest />
            PR 草稿
          </Button>
        </div>
        <p className="mt-1.5 text-center text-[10px] text-muted-foreground">
          commit 自动执行 · push 需确认
        </p>
      </div>
    </div>
  )
}
