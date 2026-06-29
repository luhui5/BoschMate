"use client"

import { useState } from "react"
import { ChevronDown, Check, X, Undo2, FileCode2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { DiffHunk } from "@/lib/types"

export function DiffCard({
  diff,
  onAccept,
  onReject,
  onRevert,
}: {
  diff: DiffHunk
  onAccept?: () => void
  onReject?: () => void
  onRevert?: () => void
}) {
  const [open, setOpen] = useState(true)

  const statusLabel: Record<DiffHunk["status"], string> = {
    pending: "待审阅",
    applied: "已采纳",
    rejected: "已拒绝",
    reverted: "已回滚",
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-background">
      <div className="flex items-center gap-2 border-b border-border bg-card px-2.5 py-1.5">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          aria-expanded={open}
        >
          <ChevronDown className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", !open && "-rotate-90")} />
          <FileCode2 className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate font-mono text-xs">{diff.filePath}</span>
        </button>
        <span className="shrink-0 font-mono text-xs text-success">+{diff.additions}</span>
        <span className="shrink-0 font-mono text-xs text-destructive">-{diff.deletions}</span>
        <span
          className={cn(
            "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium",
            diff.status === "pending" && "bg-warning/15 text-warning",
            diff.status === "applied" && "bg-success/15 text-success",
            diff.status === "rejected" && "bg-destructive/15 text-destructive",
            diff.status === "reverted" && "bg-secondary text-muted-foreground",
          )}
        >
          {statusLabel[diff.status]}
        </span>
      </div>

      {open && (
        <div className="max-h-72 overflow-auto scrollbar-thin">
          <table className="w-full border-collapse font-mono text-xs">
            <tbody>
              {diff.lines.map((line, i) => (
                <tr
                  key={i}
                  className={cn(
                    line.type === "add" && "bg-diff-add/40",
                    line.type === "del" && "bg-diff-del/40",
                    line.type === "meta" && "bg-secondary/50",
                  )}
                >
                  <td className="w-10 select-none border-r border-border px-2 text-right text-muted-foreground/60">
                    {line.oldNo ?? ""}
                  </td>
                  <td className="w-10 select-none border-r border-border px-2 text-right text-muted-foreground/60">
                    {line.newNo ?? ""}
                  </td>
                  <td
                    className={cn(
                      "w-4 select-none px-1 text-center",
                      line.type === "add" && "text-diff-add-foreground",
                      line.type === "del" && "text-diff-del-foreground",
                    )}
                  >
                    {line.type === "add" ? "+" : line.type === "del" ? "-" : ""}
                  </td>
                  <td
                    className={cn(
                      "whitespace-pre px-2 py-0.5",
                      line.type === "add" && "text-diff-add-foreground",
                      line.type === "del" && "text-diff-del-foreground",
                      line.type === "meta" && "text-muted-foreground",
                    )}
                  >
                    {line.text || " "}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <div className="flex items-center justify-end gap-1.5 border-t border-border bg-card px-2.5 py-1.5">
          {diff.status === "pending" ? (
            <>
              <Button variant="ghost" size="xs" onClick={onReject}>
                <X />
                拒绝
              </Button>
              <Button size="xs" onClick={onAccept}>
                <Check />
                采纳
              </Button>
            </>
          ) : diff.status === "applied" ? (
            <Button variant="ghost" size="xs" onClick={onRevert}>
              <Undo2 />
              回滚
            </Button>
          ) : (
            <Button variant="ghost" size="xs" onClick={onAccept} disabled={diff.status === "reverted"}>
              <Check />
              重新采纳
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
