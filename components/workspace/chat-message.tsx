"use client"

import { FileCode2, User } from "lucide-react"
import { Logo } from "@/components/brand"
import { Badge } from "@/components/ui/badge"
import { DiffCard } from "@/components/workspace/diff-card"
import { ToolActivityPanel } from "@/components/workspace/tool-activity-panel"
import { MarkdownContent, MarkdownInline } from "@/components/markdown-content"
import { cn } from "@/lib/utils"
import type { ChatMessage as TMessage, DiffHunk } from "@/lib/types"
import { extractFileRefs } from "@/lib/workspace-utils"

const modeLabel: Record<string, string> = {
  ask: "提问",
  plan: "计划",
  edit: "编辑确认",
  auto: "自动",
}

export function findLastUserIndex(msgs: Pick<TMessage, "role">[]): number {
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === "user") return i
  }
  return -1
}

export function ChatMessageView({
  message,
  onDiffAction,
  onOpenFile,
  variant = "default",
}: {
  message: TMessage
  onDiffAction: (messageId: string, diffIndex: number, action: "accept" | "reject" | "revert") => void
  onOpenFile: (path: string) => void
  variant?: "default" | "pinned" | "user-query"
}) {
  const isUser = message.role === "user"
  const isQueryBar = isUser && (variant === "pinned" || variant === "user-query")
  const detectedRefs = extractFileRefs(message.content)
  const allFileRefs = [...new Set([...(message.fileRefs ?? []), ...detectedRefs])]

  const hasActivity =
    !isUser &&
    (message.streaming ||
      (message.activitySteps && message.activitySteps.length > 0) ||
      (message.toolCalls && message.toolCalls.length > 0))
  const hasOutput = !isUser && message.content.trim().length > 0
  const stepsStillRunning =
    message.activitySteps?.some((s) => s.status === "running") ?? false
  // 工具/思考进行中时不展示中间轮次流式正文，避免步骤与回复混在一起
  const showOutput =
    hasOutput && (!message.streaming || !stepsStillRunning)

  return (
    <div className={cn("flex gap-3", isUser && !isQueryBar && "flex-row-reverse")}>
      {!isQueryBar && (
        <span
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-md",
            isUser ? "bg-secondary text-secondary-foreground" : "",
          )}
          aria-hidden
        >
          {isUser ? <User className="size-4" /> : <Logo className="size-7" />}
        </span>
      )}

      <div
        className={cn(
          "flex min-w-0 flex-col gap-2",
          isQueryBar ? "w-full" : "max-w-[85%]",
          isUser && !isQueryBar && "items-end",
        )}
      >
        {!isQueryBar && (
          <div className={cn("flex items-center gap-2", isUser && "flex-row-reverse")}>
            <span className="text-xs font-medium">{isUser ? "你" : "BoschCode"}</span>
            {message.mode && !isUser && (
              <Badge variant="primary" className="text-[10px]">
                {modeLabel[message.mode]}
              </Badge>
            )}
          </div>
        )}

        {/* User bubble / pinned question */}
        {isUser && (
          <div
            className={cn(
              "rounded-lg px-3 py-2 w-full",
              isQueryBar
                ? "border border-border bg-card"
                : "bg-primary text-primary-foreground",
            )}
          >
            <p
              className={cn(
                "whitespace-pre-wrap text-sm leading-relaxed",
                isQueryBar ? "text-foreground" : "",
              )}
            >
              <MarkdownInline content={message.content} onOpenFile={onOpenFile} />
            </p>
          </div>
        )}

        {/* Assistant: Thought → Explore → Output */}
        {!isUser && (
          <>
            {hasActivity && <ToolActivityPanel message={message} />}

            {showOutput && (
              <div className="rounded-lg border border-border bg-card px-3 py-2">
                <div className="flex flex-col">
                  <MarkdownContent content={message.content} onOpenFile={onOpenFile} />
                  {message.streaming && (
                    <span className="mt-1 inline-block h-3.5 w-1.5 animate-pulse bg-primary align-middle" />
                  )}
                </div>
              </div>
            )}
          </>
        )}

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

        {allFileRefs.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {allFileRefs.map((f) => (
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
