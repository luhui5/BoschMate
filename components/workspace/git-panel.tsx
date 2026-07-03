"use client"

import { useMemo, useState } from "react"
import { GitBranch, GitCommitHorizontal, GitPullRequest, FileQuestion, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import type { GitFile } from "@/lib/types"
import { gitCommit, isTauri } from "@/lib/tauri-api"

export function GitPanel({
  projectId,
  branch,
  gitRemote,
  files,
  onOpenFile,
  onCommitted,
}: {
  projectId: string
  branch: string
  gitRemote?: string
  files: GitFile[]
  onOpenFile: (path: string) => void
  onCommitted?: () => void
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [commitMsg, setCommitMsg] = useState("")
  const [committed, setCommitted] = useState<string | null>(null)
  const [committing, setCommitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const toggle = (path: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const selectAll = () => setSelected(new Set(files.map((f) => f.path)))

  const commit = async () => {
    if (!commitMsg.trim() || selected.size === 0) return
    setError(null)
    setCommitting(true)
    try {
      if (isTauri()) {
        await gitCommit(projectId, commitMsg.trim(), Array.from(selected))
        onCommitted?.()
      }
      setCommitted(commitMsg.trim())
      setSelected(new Set())
      setCommitMsg("")
    } catch (e) {
      setError(typeof e === "string" ? e : e instanceof Error ? e.message : "提交失败")
    } finally {
      setCommitting(false)
    }
  }

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

  const grouped = useMemo(() => {
    const staged = files.filter((f) => f.staged)
    const unstaged = files.filter((f) => !f.staged)
    return { staged, unstaged }
  }, [files])

  const Row = ({ f }: { f: GitFile }) => (
    <div className="group flex items-center gap-2 rounded px-1.5 py-1 hover:bg-accent">
      <input
        type="checkbox"
        checked={selected.has(f.path)}
        onChange={() => toggle(f.path)}
        className="size-3.5 accent-[var(--primary)]"
        aria-label={`选择 ${f.path}`}
      />
      <span className={cn("w-4 text-center font-mono text-xs", statusColor[f.status])}>
        {statusMark[f.status]}
      </span>
      <button type="button" onClick={() => onOpenFile(f.path)} className="truncate font-mono text-xs hover:underline">
        {f.path}
      </button>
      <span className="ml-auto flex shrink-0 items-center gap-1.5 text-[10px]">
        {f.status === "untracked" ? (
          <FileQuestion className="size-3 text-muted-foreground" />
        ) : (
          <>
            {f.additions > 0 && <span className="text-success">+{f.additions}</span>}
            {f.deletions > 0 && <span className="text-destructive">-{f.deletions}</span>}
          </>
        )}
      </span>
    </div>
  )

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-xs">
        <GitBranch className="size-3.5 text-muted-foreground" />
        <span className="font-medium">{branch}</span>
        {gitRemote && <span className="ml-auto truncate text-muted-foreground">{gitRemote}</span>}
      </div>

      <div className="flex-1 overflow-auto scrollbar-thin">
        {committed && (
          <div className="m-2 rounded-md border border-success/30 bg-success/10 p-2 text-xs">
            <p className="font-medium text-success">已提交</p>
            <p className="mt-0.5 text-muted-foreground">{committed}</p>
          </div>
        )}

        {files.length === 0 ? (
          <p className="px-3 py-8 text-center text-xs text-muted-foreground">工作区干净，没有未提交的变更。</p>
        ) : (
          <>
            {grouped.staged.length > 0 && (
              <div className="p-2">
                <p className="mb-1 px-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  已暂存 ({grouped.staged.length})
                </p>
                {grouped.staged.map((f) => (
                  <Row key={`s-${f.path}`} f={f} />
                ))}
              </div>
            )}
            <div className="p-2">
              <div className="mb-1 flex items-center justify-between px-1.5">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  变更 ({grouped.unstaged.length || files.length})
                </span>
                <Button variant="ghost" size="xs" onClick={selectAll}>
                  全选
                </Button>
              </div>
              {(grouped.unstaged.length ? grouped.unstaged : files).map((f) => (
                <Row key={f.path} f={f} />
              ))}
            </div>
          </>
        )}
      </div>

      <div className="border-t border-border p-2">
        <Textarea
          value={commitMsg}
          onChange={(e) => setCommitMsg(e.target.value)}
          rows={2}
          placeholder="提交信息…"
          className="mb-2 text-xs"
        />
        {error && <p className="mb-2 text-xs text-destructive">{error}</p>}
        <div className="flex gap-1.5">
          <Button
            size="sm"
            className="flex-1"
            onClick={commit}
            disabled={!commitMsg.trim() || selected.size === 0 || committing}
          >
            {committing ? <Loader2 className="size-4 animate-spin" /> : <GitCommitHorizontal />}
            提交 ({selected.size})
          </Button>
          <Button variant="outline" size="sm" title="push 需确认">
            <GitPullRequest />
            PR 草稿
          </Button>
        </div>
        <p className="mt-1.5 text-center text-[10px] text-muted-foreground">
          勾选文件后提交 · push 需确认
        </p>
      </div>
    </div>
  )
}
