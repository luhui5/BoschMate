"use client"

import { FileCode2 } from "lucide-react"
import { buildTaskSummary, fileChangeLabel } from "@/lib/task-summary"
import type { ActivityStep, DiffHunk } from "@/lib/types"

export function TaskFileChangesPanel({
  activitySteps,
  diffs,
  onOpenFile,
}: {
  activitySteps?: ActivityStep[]
  diffs?: DiffHunk[]
  onOpenFile?: (path: string) => void
}) {
  const { files } = buildTaskSummary(activitySteps, diffs)
  if (files.length === 0) return null

  return (
    <div className="flex w-full flex-col gap-1 rounded-md border border-border bg-muted/20 px-3 py-2 text-xs">
      <ul className="flex flex-col gap-1">
        {files.map((f) => (
          <li key={f.path} className="flex min-w-0 items-center gap-2">
            <FileCode2 className="size-3 shrink-0 text-muted-foreground" />
            {onOpenFile ? (
              <button
                type="button"
                onClick={() => onOpenFile(f.path)}
                className="min-w-0 truncate font-mono text-left text-muted-foreground transition-colors hover:text-foreground"
              >
                {f.path}
              </button>
            ) : (
              <span className="min-w-0 truncate font-mono text-muted-foreground">{f.path}</span>
            )}
            <span className="shrink-0 tabular-nums text-muted-foreground/80">
              {fileChangeLabel(f)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
