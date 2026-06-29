"use client"

import { Wrench, CheckCircle2, Loader2, XCircle, FileCode2, User } from "lucide-react"
import { Logo } from "@/components/brand"
import { Badge } from "@/components/ui/badge"
import { DiffCard } from "@/components/workspace/diff-card"
import { cn } from "@/lib/utils"
import type { ChatMessage as TMessage, DiffHunk } from "@/lib/types"

const modeLabel: Record<string, string> = {
  ask: "提问",
  plan: "计划",
  edit: "编辑确认",
  auto: "自动",
}

/** Render markdown-ish content: headings, bullets, bold, code spans. */
function renderContent(text: string) {
  return text.split("\n").map((line, i) => {
    if (line.startsWith("## ")) {
      return (
        <p key={i} className="mt-2 mb-1 text-sm font-semibold">
          {line.slice(3)}
        </p>
      )
    }
    if (/^\d+\.\s/.test(line) || line.startsWith("- ")) {
      return (
        <p key={i} className="pl-3 text-sm leading-relaxed text-foreground/90">
          {inline(line)}
        </p>
      )
    }
    if (line.trim() === "") return <div key={i} className="h-2" />
    return (
      <p key={i} className="text-sm leading-relaxed text-foreground/90">
        {inline(line)}
      </p>
    )
  })
}

function inline(text: string) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g)
  return parts.map((p, i) => {
    if (p.startsWith("`") && p.endsWith("`")) {
      return (
        <code key={i} className="rounded bg-secondary px-1 py-0.5 font-mono text-[0.8em] text-primary">
          {p.slice(1, -1)}
        </code>
      )
    }
    if (p.startsWith("**") && p.endsWith("**")) {
      return (
        <strong key={i} className="font-semibold">
          {p.slice(2, -2)}
        </strong>
      )
    }
    return p
  })
}

export function ChatMessageView({
  message,
  onDiffAction,
  onOpenFile,
}: {
  message: TMessage
  onDiffAction: (messageId: string, diffIndex: number, action: "accept" | "reject" | "revert") => void
  onOpenFile: (path: string) => void
}) {
  const isUser = message.role === "user"

  return (
    <div className={cn("flex gap-3", isUser && "flex-row-reverse")}>
      <span
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-md",
          isUser ? "bg-secondary text-secondary-foreground" : "",
        )}
        aria-hidden
      >
        {isUser ? <User className="size-4" /> : <Logo className="size-7" />}
      </span>

      <div className={cn("flex min-w-0 max-w-[85%] flex-col gap-2", isUser && "items-end")}>
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium">{isUser ? "你" : "BoschCode"}</span>
          {message.mode && !isUser && (
            <Badge variant="primary" className="text-[10px]">
              {modeLabel[message.mode]}
            </Badge>
          )}
        </div>

        <div
          className={cn(
            "rounded-lg px-3 py-2",
            isUser ? "bg-primary text-primary-foreground" : "bg-card border border-border",
          )}
        >
          {isUser ? (
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{message.content}</p>
          ) : (
            <div className="flex flex-col">
              {renderContent(message.content)}
              {message.streaming && (
                <span className="mt-1 inline-block h-3.5 w-1.5 animate-pulse bg-primary align-middle" />
              )}
            </div>
          )}
        </div>

        {/* Tool calls */}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="flex w-full flex-col gap-1 rounded-lg border border-border bg-background/50 p-2">
            {message.toolCalls.map((tc, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <Wrench className="size-3 shrink-0 text-muted-foreground" />
                <span className="font-mono font-medium">{tc.tool}</span>
                <span className="truncate font-mono text-muted-foreground">{tc.args}</span>
                <span className="ml-auto shrink-0">
                  {tc.status === "success" && <CheckCircle2 className="size-3.5 text-success" />}
                  {tc.status === "running" && <Loader2 className="size-3.5 animate-spin text-warning" />}
                  {tc.status === "error" && <XCircle className="size-3.5 text-destructive" />}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Diffs */}
        {message.diffs && message.diffs.length > 0 && (
          <div className="flex w-full flex-col gap-2">
            {message.diffs.map((d: DiffHunk, i) => (
              <DiffCard
                key={i}
                diff={d}
                onAccept={() => onDiffAction(message.id, i, "accept")}
                onReject={() => onDiffAction(message.id, i, "reject")}
                onRevert={() => onDiffAction(message.id, i, "revert")}
              />
            ))}
          </div>
        )}

        {/* File refs */}
        {message.fileRefs && message.fileRefs.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {message.fileRefs.map((f) => (
              <button
                key={f}
                onClick={() => onOpenFile(f)}
                className="flex items-center gap-1 rounded-md border border-border bg-background px-1.5 py-0.5 font-mono text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
              >
                <FileCode2 className="size-3" />
                {f}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
