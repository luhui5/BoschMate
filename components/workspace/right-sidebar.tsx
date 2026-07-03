"use client"

import { useState } from "react"
import { FolderTree, FileDiff, GitMerge, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { FileTree } from "@/components/workspace/file-tree"
import { GitPanel } from "@/components/workspace/git-panel"
import { DiffCard } from "@/components/workspace/diff-card"
import type { DiffHunk, FileNode, GitFile } from "@/lib/types"

type View = "files" | "changes" | "git"

export function RightSidebar({
  projectId,
  gitBranch,
  gitRemote,
  fileTree,
  gitFiles,
  fileTreeLoading,
  changes,
  activeFile,
  onOpenFile,
  onDiffAction,
  onGitRefresh,
}: {
  projectId: string
  gitBranch: string
  gitRemote?: string
  fileTree: FileNode[]
  gitFiles: GitFile[]
  fileTreeLoading?: boolean
  changes: { messageId: string; index: number; diff: DiffHunk }[]
  activeFile: string | null
  onOpenFile: (path: string) => void
  onDiffAction: (messageId: string, diffIndex: number, action: "accept" | "reject" | "revert") => void
  onGitRefresh?: () => void
}) {
  const [view, setView] = useState<View>("files")

  const views: { id: View; label: string; icon: typeof FolderTree; count?: number }[] = [
    { id: "files", label: "文件树", icon: FolderTree },
    { id: "changes", label: "本次变更", icon: FileDiff, count: changes.length },
    { id: "git", label: "Git", icon: GitMerge, count: gitFiles.length },
  ]

  return (
    <aside className="flex h-full w-80 shrink-0 flex-col border-l border-border bg-sidebar">
      <div className="flex border-b border-border p-1">
        {views.map((v) => {
          const Icon = v.icon
          return (
            <button
              key={v.id}
              type="button"
              onClick={() => setView(v.id)}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-xs transition-colors",
                view === v.id ? "bg-sidebar-accent text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-3.5" />
              <span>{v.label}</span>
              {v.count != null && v.count > 0 && (
                <span className="rounded bg-primary/15 px-1 text-[10px] text-primary">{v.count}</span>
              )}
            </button>
          )
        })}
      </div>

      <div className="min-h-0 flex-1">
        {view === "files" && (
          fileTreeLoading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-xs text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              加载文件树…
            </div>
          ) : fileTree.length === 0 ? (
            <p className="px-3 py-16 text-center text-xs text-muted-foreground">无法加载文件树或目录为空。</p>
          ) : (
            <FileTree nodes={fileTree} activePath={activeFile} onOpen={onOpenFile} />
          )
        )}

        {view === "changes" && (
          <div className="h-full overflow-auto p-2 scrollbar-thin">
            {changes.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
                <FileDiff className="size-8 text-muted-foreground/50" />
                <p className="text-xs text-muted-foreground">本次会话尚无文件变更。</p>
                <p className="text-[10px] text-muted-foreground">Agent 生成补丁后将在此展示，可逐个采纳或回滚。</p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {changes.map((c) => (
                  <DiffCard
                    key={`${c.messageId}-${c.index}`}
                    diff={c.diff}
                    onAccept={() => onDiffAction(c.messageId, c.index, "accept")}
                    onReject={() => onDiffAction(c.messageId, c.index, "reject")}
                    onRevert={() => onDiffAction(c.messageId, c.index, "revert")}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {view === "git" && (
          <GitPanel
            projectId={projectId}
            branch={gitBranch}
            gitRemote={gitRemote}
            files={gitFiles}
            onOpenFile={onOpenFile}
            onCommitted={onGitRefresh}
          />
        )}
      </div>
    </aside>
  )
}
