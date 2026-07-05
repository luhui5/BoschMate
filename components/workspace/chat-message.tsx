"use client"

import { memo } from "react"
import { FileCode2 } from "lucide-react"
import { DiffCard } from "@/components/workspace/diff-card"
import { QuestionCard } from "@/components/workspace/question-card"
import { PlanExecuteBar } from "@/components/workspace/plan-execute-bar"
import { TaskFileChangesPanel } from "@/components/workspace/task-summary-bar"
import { ToolActivityPanel } from "@/components/workspace/tool-activity-panel"
import {
  shouldShowFileChanges,
  splitExecutionSummary,
} from "@/lib/task-summary"
import { MarkdownContent, MarkdownInline } from "@/components/markdown-content"
import { cn } from "@/lib/utils"
import type { ChatMessage as TMessage, DiffHunk, QuestionAnswer } from "@/lib/types"
import { extractFileRefs } from "@/lib/workspace-utils"

export function findLastUserIndex(msgs: Pick<TMessage, "role">[]): number {
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === "user") return i
  }
  return -1
}

export function getReplyLayoutState(
  msgs: Pick<TMessage, "role" | "streaming" | "activitySteps">[],
  thinking: boolean,
  generating: boolean,
) {
  const lastUserIdx = findLastUserIndex(msgs)
  const afterUser = lastUserIdx >= 0 ? msgs.slice(lastUserIdx + 1) : []
  const assistantPending = afterUser.some(
    (m) =>
      m.role === "assistant" &&
      (m.streaming ||
        (m.activitySteps?.some((s) => s.status === "running") ?? false)),
  )
  const awaitingReply =
    lastUserIdx >= 0 &&
    (afterUser.length === 0 || assistantPending || thinking || generating)
  return { lastUserIdx, awaitingReply, afterUser }
}

function ChatMessageViewInner({
  message,
  onDiffAction,
  onQuestionSubmit,
  onOpenFile,
  showPlanExecute,
  onExecutePlan,
  planExecuteDisabled,
  planExecuteDisabledReason,
  variant = "default",
}: {
  message: TMessage
  onDiffAction: (messageId: string, diffIndex: number, action: "accept" | "reject" | "revert") => void
  onQuestionSubmit?: (messageId: string, answers: QuestionAnswer[]) => void
  onOpenFile: (path: string) => void
  showPlanExecute?: boolean
  onExecutePlan?: () => void
  planExecuteDisabled?: boolean
  planExecuteDisabledReason?: string
  variant?: "default" | "pinned" | "user-query" | "float"
}) {
  const isUser = message.role === "user"
  const isFloat = variant === "float"
  const detectedRefs =
    isUser || !message.streaming ? extractFileRefs(message.content) : []
  const allFileRefs = [...new Set([...(message.fileRefs ?? []), ...detectedRefs])]

  const hasActivity =
    !isUser &&
    (message.streaming ||
      (message.activitySteps && message.activitySteps.length > 0) ||
      (message.toolCalls && message.toolCalls.length > 0))
  const hasOutput = !isUser && message.content.trim().length > 0
  const stepCount = message.activitySteps?.length ?? 0
  const toolSteps =
    message.activitySteps?.filter((s) => s.kind === "tool") ?? []
  const toolStepCount = toolSteps.length
  const toolStepsStillRunning = toolSteps.some((s) => s.status === "running")
  const thoughtRunning =
    message.activitySteps?.some(
      (s) => s.kind === "thought" && s.status === "running",
    ) ?? false
  // Hide preamble streamed before first tool call (cheap plain phase, not markdown)
  const hideStreamingOutput =
    Boolean(message.streaming) &&
    toolStepCount === 0 &&
    thoughtRunning &&
    hasOutput
  const showOutput =
    hasOutput &&
    (!message.streaming || !toolStepsStillRunning || thoughtRunning)
  const explorePhase =
    Boolean(message.streaming) &&
    (stepCount === 0 || toolStepsStillRunning || !hasOutput || hideStreamingOutput)

  const showQuestionCard = Boolean(
    message.pendingQuestions?.status === "pending" && !message.streaming,
  )
  const isStreaming = Boolean(message.streaming)
  const { before, summary } = isStreaming
    ? { before: message.content, summary: "" }
    : splitExecutionSummary(message.content)
  const showFileChanges = shouldShowFileChanges(message)
  const hasSummarySection = !isStreaming && summary.trim().length > 0

  return (
    <div className="flex w-full flex-col gap-2 items-start text-left">
      {isUser && (
        <div
          className={cn(
            "w-full rounded-lg border border-border bg-muted/50 px-3 py-2 text-left shadow-md",
            "dark:border-zinc-700 dark:bg-zinc-800/60 dark:shadow-black/30",
            isFloat && "shadow-lg",
          )}
        >
          <p
            className={cn(
              "whitespace-pre-wrap text-left text-sm leading-relaxed text-foreground",
              isFloat && "line-clamp-3",
            )}
          >
            <MarkdownInline content={message.content} onOpenFile={onOpenFile} />
          </p>
        </div>
      )}

      {!isUser && (
        <>
          {hasActivity && (
            <ToolActivityPanel
              message={message}
              explorePhase={explorePhase}
            />
          )}

          {showOutput && isStreaming && (
            <div className="w-full text-left">
              <MarkdownContent
                content={message.content}
                streaming
                onOpenFile={onOpenFile}
              />
            </div>
          )}

          {showOutput && !isStreaming && hasSummarySection && (
            <div className="flex w-full flex-col gap-2 text-left">
              {before.trim().length > 0 && (
                <MarkdownContent content={before} onOpenFile={onOpenFile} />
              )}
              {showFileChanges && (
                <TaskFileChangesPanel
                  activitySteps={message.activitySteps}
                  diffs={message.diffs}
                  onOpenFile={onOpenFile}
                />
              )}
              <MarkdownContent content={summary} onOpenFile={onOpenFile} />
            </div>
          )}

          {showOutput && !isStreaming && !hasSummarySection && (
            <div className="flex w-full flex-col gap-2 text-left">
              {showFileChanges && (
                <TaskFileChangesPanel
                  activitySteps={message.activitySteps}
                  diffs={message.diffs}
                  onOpenFile={onOpenFile}
                />
              )}
              <MarkdownContent content={message.content} onOpenFile={onOpenFile} />
            </div>
          )}
        </>
      )}

      {showPlanExecute && onExecutePlan && (
        <PlanExecuteBar
          onExecute={onExecutePlan}
          disabled={planExecuteDisabled}
          disabledReason={planExecuteDisabledReason}
        />
      )}

      {showQuestionCard && (
        <QuestionCard
          pending={message.pendingQuestions!}
          disabled={message.streaming}
          onSubmit={(answers) => onQuestionSubmit?.(message.id, answers)}
        />
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
  )
}

function chatMessagePropsEqual(a: TMessage, b: TMessage): boolean {
  return (
    a.id === b.id &&
    a.content === b.content &&
    a.streaming === b.streaming &&
    a.mode === b.mode &&
    a.role === b.role &&
    a.activitySteps === b.activitySteps &&
    a.diffs === b.diffs &&
    a.pendingQuestions === b.pendingQuestions
  )
}

export const ChatMessageView = memo(ChatMessageViewInner, (prev, next) =>
  chatMessagePropsEqual(prev.message, next.message) &&
  prev.showPlanExecute === next.showPlanExecute &&
  prev.planExecuteDisabled === next.planExecuteDisabled &&
  prev.planExecuteDisabledReason === next.planExecuteDisabledReason &&
  prev.variant === next.variant,
)
