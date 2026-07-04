"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  GitBranch,
  GitCommitHorizontal,
  GitPullRequest,
  FileQuestion,
  Loader2,
  Plus,
  Archive,
  ChevronDown,
  Eye,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import type { GitFile } from "@/lib/types"
import {
  gitCommit,
  gitBranches,
  gitCheckoutBranch,
  gitCreateBranch,
  gitStageFiles,
  gitUnstageFiles,
  gitStashPush,
  gitStashPop,
  gitStashList,
  gitDiff,
  gitLog,
  isTauri,
} from "@/lib/tauri-api"

export function GitPanel({
  projectId,
  branch,
  gitRemote,
  files,
  onOpenFile,
  onCommitted,
  onBranchChange,
}: {
  projectId: string
  branch: string
  gitRemote?: string
  files: GitFile[]
  onOpenFile: (path: string) => void
  onCommitted?: () => void
  onBranchChange?: () => void
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [commitMsg, setCommitMsg] = useState("")
  const [committed, setCommitted] = useState<string | null>(null)
  const [committing, setCommitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [branches, setBranches] = useState<string[]>([])
  const [showBranches, setShowBranches] = useState(false)
  const [newBranch, setNewBranch] = useState("")
  const [busy, setBusy] = useState(false)
  const [previewPath, setPreviewPath] = useState<string | null>(null)
  const [previewDiff, setPreviewDiff] = useState<string>("")
  const [stashCount, setStashCount] = useState(0)
  const [recentCommits, setRecentCommits] = useState<Array<{ sha: string; message: string; author: string }>>([])

  const refreshMeta = useCallback(async () => {
    if (!isTauri()) return
    try {
      const [b, stashes, log] = await Promise.all([
        gitBranches(projectId),
        gitStashList(projectId),
        gitLog(projectId, 5),
      ])
      setBranches(b)
      setStashCount(stashes.length)
      setRecentCommits(log)
    } catch {
      /* ignore */
    }
  }, [projectId])

  useEffect(() => {
    void refreshMeta()
  }, [refreshMeta, projectId, branch])

  const toggle = (path: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const grouped = useMemo(() => {
    const staged = files.filter((f) => f.staged)
    const unstaged = files.filter((f) => !f.staged)
    return { staged, unstaged }
  }, [files])

  const allPaths = useMemo(() => files.map((f) => f.path), [files])
  const allSelected = allPaths.length > 0 && allPaths.every((p) => selected.has(p))

  const selectAll = () => setSelected(new Set(allPaths))
  const clearSelection = () => setSelected(new Set())

  useEffect(() => {
    const valid = new Set(allPaths)
    setSelected((prev) => {
      const next = new Set([...prev].filter((p) => valid.has(p)))
      return next.size === prev.size ? prev : next
    })
  }, [allPaths])

  const stage = async (paths: string[]) => {
    if (!isTauri() || paths.length === 0) return
    setBusy(true)
    setError(null)
    try {
      await gitStageFiles(projectId, paths)
      onBranchChange?.()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  const unstage = async (paths: string[]) => {
    if (!isTauri() || paths.length === 0) return
    setBusy(true)
    setError(null)
    try {
      await gitUnstageFiles(projectId, paths)
      onBranchChange?.()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  const commit = async () => {
    if (!commitMsg.trim() || selected.size === 0) return
    setError(null)
    setCommitting(true)
    try {
      if (isTauri()) {
        await gitCommit(projectId, commitMsg.trim(), Array.from(selected))
        onCommitted?.()
        onBranchChange?.()
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

  const switchBranch = async (name: string) => {
    if (!isTauri() || name === branch) return
    setBusy(true)
    setError(null)
    try {
      if (files.length > 0) {
        await gitStashPush(projectId, { includeUntracked: true, message: `Before checkout ${name}` })
      }
      await gitCheckoutBranch(projectId, name)
      setShowBranches(false)
      onBranchChange?.()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  const createBranch = async () => {
    const name = newBranch.trim()
    if (!name || !isTauri()) return
    setBusy(true)
    setError(null)
    try {
      await gitCreateBranch(projectId, name)
      setNewBranch("")
      setShowBranches(false)
      onBranchChange?.()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  const stash = async () => {
    if (!isTauri()) return
    setBusy(true)
    try {
      await gitStashPush(projectId, { includeUntracked: true })
      onBranchChange?.()
      await refreshMeta()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  const popStash = async () => {
    if (!isTauri()) return
    setBusy(true)
    try {
      await gitStashPop(projectId)
      onBranchChange?.()
      await refreshMeta()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  const showDiff = async (path: string, staged: boolean) => {
    if (!isTauri()) return
    setPreviewPath(path)
    try {
      const d = await gitDiff(projectId, staged, path)
      setPreviewDiff(d.diff || "(无 diff)")
    } catch {
      setPreviewDiff("(无法加载 diff)")
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

  const FileRow = ({ f, isStaged }: { f: GitFile; isStaged: boolean }) => (
    <div className="group flex items-center gap-1 rounded px-1.5 py-1 hover:bg-accent">
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
      <button type="button" onClick={() => onOpenFile(f.path)} className="min-w-0 flex-1 truncate text-left font-mono text-xs hover:underline">
        {f.path}
      </button>
      <Button variant="ghost" size="icon-xs" onClick={() => void showDiff(f.path, isStaged)} title="查看 diff">
        <Eye className="size-3" />
      </Button>
      {isStaged ? (
        <Button variant="ghost" size="xs" onClick={() => void unstage([f.path])} disabled={busy}>
          取消暂存
        </Button>
      ) : (
        <Button variant="ghost" size="xs" onClick={() => void stage([f.path])} disabled={busy}>
          暂存
        </Button>
      )}
    </div>
  )

  return (
    <div className="flex h-full flex-col">
      <div className="relative border-b border-border px-3 py-2">
        <button
          type="button"
          onClick={() => setShowBranches((s) => !s)}
          className="flex w-full items-center gap-2 text-xs"
        >
          <GitBranch className="size-3.5 text-muted-foreground" />
          <span className="font-medium">{branch}</span>
          <ChevronDown className={cn("ml-auto size-3.5 transition-transform", showBranches && "rotate-180")} />
        </button>
        {gitRemote && <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{gitRemote}</p>}

        {showBranches && (
          <div className="absolute left-2 right-2 top-full z-20 mt-1 rounded-lg border border-border bg-popover p-2 shadow-xl">
            <p className="mb-1 text-[10px] font-semibold uppercase text-muted-foreground">分支</p>
            <div className="max-h-32 space-y-0.5 overflow-auto">
              {branches.map((b) => (
                <button
                  key={b}
                  type="button"
                  onClick={() => void switchBranch(b)}
                  className={cn(
                    "block w-full rounded px-2 py-1 text-left text-xs hover:bg-accent",
                    b === branch && "bg-accent font-medium",
                  )}
                >
                  {b}
                </button>
              ))}
            </div>
            <div className="mt-2 flex gap-1">
              <Input
                value={newBranch}
                onChange={(e) => setNewBranch(e.target.value)}
                placeholder="新分支名"
                className="h-7 text-xs"
              />
              <Button size="xs" onClick={() => void createBranch()} disabled={!newBranch.trim() || busy}>
                <Plus className="size-3" />
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center gap-1 border-b border-border px-2 py-1">
        <Button variant="ghost" size="xs" onClick={() => void stash()} disabled={busy || files.length === 0}>
          <Archive className="size-3" />
          Stash
        </Button>
        {stashCount > 0 && (
          <Button variant="ghost" size="xs" onClick={() => void popStash()} disabled={busy}>
            Pop ({stashCount})
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-auto scrollbar-thin">
        {committed && (
          <div className="m-2 rounded-md border border-success/30 bg-success/10 p-2 text-xs">
            <p className="font-medium text-success">已提交</p>
            <p className="mt-0.5 text-muted-foreground">{committed}</p>
          </div>
        )}

        {previewPath && (
          <div className="m-2 rounded-md border border-border bg-card p-2">
            <div className="mb-1 flex items-center justify-between">
              <span className="truncate font-mono text-[10px]">{previewPath}</span>
              <Button variant="ghost" size="xs" onClick={() => setPreviewPath(null)}>关闭</Button>
            </div>
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[10px] text-muted-foreground">{previewDiff}</pre>
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
                  <FileRow key={`s-${f.path}`} f={f} isStaged />
                ))}
              </div>
            )}
            <div className="p-2">
              <p className="mb-1 px-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                未暂存 ({grouped.unstaged.length})
              </p>
              {grouped.unstaged.length === 0 ? (
                <p className="px-1.5 text-[10px] text-muted-foreground">所有变更已暂存</p>
              ) : (
                grouped.unstaged.map((f) => <FileRow key={f.path} f={f} isStaged={false} />)
              )}
            </div>
          </>
        )}

        {recentCommits.length > 0 && (
          <div className="border-t border-border p-2">
            <p className="mb-1 text-xs font-semibold text-muted-foreground">最近提交</p>
            {recentCommits.map((c) => (
              <div key={c.sha} className="rounded px-1.5 py-1 text-[10px]">
                <span className="font-mono text-primary">{c.sha}</span>{" "}
                <span className="text-muted-foreground">{c.message.slice(0, 60)}</span>
              </div>
            ))}
          </div>
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
        <div className="mb-2 flex flex-wrap gap-1.5">
          <Button
            variant="outline"
            size="xs"
            onClick={() => (allSelected ? clearSelection() : selectAll())}
            disabled={files.length === 0}
          >
            {allSelected ? "取消全选" : "全选"}
          </Button>
          {grouped.unstaged.length > 0 && (
            <Button
              variant="outline"
              size="xs"
              onClick={() => void stage(grouped.unstaged.map((f) => f.path))}
              disabled={busy}
            >
              全部暂存
            </Button>
          )}
        </div>
        <div className="flex gap-1.5">
          <Button size="sm" className="flex-1" onClick={commit} disabled={!commitMsg.trim() || selected.size === 0 || committing}>
            {committing ? <Loader2 className="size-4 animate-spin" /> : <GitCommitHorizontal />}
            提交 ({selected.size})
          </Button>
          <Button variant="outline" size="sm" title="push 需确认">
            <GitPullRequest />
          </Button>
        </div>
      </div>
    </div>
  )
}
