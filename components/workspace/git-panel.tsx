"use client"

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import {
  GitBranch,
  GitCommitHorizontal,
  GitPullRequest,
  Loader2,
  Plus,
  Minus,
  Archive,
  ChevronDown,
  ChevronRight,
  Eye,
  RefreshCw,
  FileCode2,
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

function splitPath(path: string): { basename: string; dirname: string } {
  const normalized = path.replace(/\\/g, "/")
  const idx = normalized.lastIndexOf("/")
  if (idx === -1) return { basename: path, dirname: "" }
  return { basename: normalized.slice(idx + 1), dirname: normalized.slice(0, idx) }
}

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
  const [collapsedStaged, setCollapsedStaged] = useState(false)
  const [collapsedChanges, setCollapsedChanges] = useState(false)

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

  const grouped = useMemo(() => {
    const staged = files.filter((f) => f.staged)
    const unstaged = files.filter((f) => !f.staged)
    return { staged, unstaged }
  }, [files])

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
    if (!commitMsg.trim() || grouped.staged.length === 0) return
    setError(null)
    setCommitting(true)
    try {
      if (isTauri()) {
        await gitCommit(projectId, commitMsg.trim(), [])
        onCommitted?.()
        onBranchChange?.()
      }
      setCommitted(commitMsg.trim())
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

  const FileRow = ({ f, isStaged }: { f: GitFile; isStaged: boolean }) => {
    const { basename, dirname } = splitPath(f.path)
    const isDeleted = f.status === "deleted"

    return (
      <div className="group flex items-center gap-1 rounded px-1 py-0.5 hover:bg-accent">
        <FileCode2 className="size-3.5 shrink-0 text-muted-foreground" />
        <button
          type="button"
          onClick={() => onOpenFile(f.path)}
          className="flex min-w-0 flex-1 items-baseline gap-1.5 truncate text-left"
        >
          <span className={cn("truncate font-mono text-xs", isDeleted && "line-through")}>
            {basename}
          </span>
          {dirname && (
            <span className="truncate font-mono text-[10px] text-muted-foreground">{dirname}</span>
          )}
        </button>
        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon-xs"
            className="opacity-0 group-hover:opacity-100"
            onClick={() => void (isStaged ? unstage([f.path]) : stage([f.path]))}
            disabled={busy}
            title={isStaged ? "取消暂存" : "暂存"}
            aria-label={isStaged ? `取消暂存 ${f.path}` : `暂存 ${f.path}`}
          >
            {isStaged ? <Minus className="size-3" /> : <Plus className="size-3" />}
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            className="opacity-0 group-hover:opacity-100"
            onClick={() => void showDiff(f.path, isStaged)}
            title="查看 diff"
            aria-label={`查看 ${f.path} diff`}
          >
            <Eye className="size-3" />
          </Button>
          <span className={cn("w-4 text-center font-mono text-xs", statusColor[f.status])}>
            {statusMark[f.status]}
          </span>
        </div>
      </div>
    )
  }

  const SectionHeader = ({
    title,
    count,
    collapsed,
    onToggle,
    action,
  }: {
    title: string
    count: number
    collapsed: boolean
    onToggle: () => void
    action?: ReactNode
  }) => (
    <div className="flex items-center gap-1 px-1 py-1">
      <button
        type="button"
        onClick={onToggle}
        className="flex min-w-0 flex-1 items-center gap-1 text-left"
      >
        {collapsed ? (
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className="truncate text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </span>
      </button>
      {count > 0 && (
        <span className="rounded-full bg-primary/15 px-1.5 text-[10px] font-medium text-primary">
          {count}
        </span>
      )}
      {action}
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
        <Button
          variant="ghost"
          size="icon-xs"
          className="ml-auto"
          onClick={() => onBranchChange?.()}
          disabled={busy}
          title="刷新"
          aria-label="刷新 Git 状态"
        >
          <RefreshCw className={cn("size-3.5", busy && "animate-spin")} />
        </Button>
      </div>

      <div className="border-b border-border p-2">
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
            disabled={!commitMsg.trim() || grouped.staged.length === 0 || committing}
          >
            {committing ? <Loader2 className="size-4 animate-spin" /> : <GitCommitHorizontal />}
            提交
          </Button>
          <Button variant="outline" size="sm" title="push 需确认">
            <GitPullRequest />
          </Button>
        </div>
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
              <Button variant="ghost" size="xs" onClick={() => setPreviewPath(null)}>
                关闭
              </Button>
            </div>
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[10px] text-muted-foreground">
              {previewDiff}
            </pre>
          </div>
        )}

        {files.length === 0 ? (
          <p className="px-3 py-8 text-center text-xs text-muted-foreground">工作区干净，没有未提交的变更。</p>
        ) : (
          <>
            {grouped.staged.length > 0 && (
              <div className="p-2">
                <SectionHeader
                  title="已暂存的更改"
                  count={grouped.staged.length}
                  collapsed={collapsedStaged}
                  onToggle={() => setCollapsedStaged((v) => !v)}
                  action={
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => void unstage(grouped.staged.map((f) => f.path))}
                      disabled={busy}
                      title="全部取消暂存"
                      aria-label="全部取消暂存"
                    >
                      <Minus className="size-3.5" />
                    </Button>
                  }
                />
                {!collapsedStaged &&
                  grouped.staged.map((f) => <FileRow key={`s-${f.path}`} f={f} isStaged />)}
              </div>
            )}
            <div className="p-2">
              <SectionHeader
                title="更改"
                count={grouped.unstaged.length}
                collapsed={collapsedChanges}
                onToggle={() => setCollapsedChanges((v) => !v)}
                action={
                  grouped.unstaged.length > 0 ? (
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => void stage(grouped.unstaged.map((f) => f.path))}
                      disabled={busy}
                      title="全部暂存"
                      aria-label="全部暂存"
                    >
                      <Plus className="size-3.5" />
                    </Button>
                  ) : undefined
                }
              />
              {!collapsedChanges &&
                (grouped.unstaged.length === 0 ? (
                  <p className="px-1 py-1 text-[10px] text-muted-foreground">所有变更已暂存</p>
                ) : (
                  grouped.unstaged.map((f) => <FileRow key={f.path} f={f} isStaged={false} />)
                ))}
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
    </div>
  )
}
