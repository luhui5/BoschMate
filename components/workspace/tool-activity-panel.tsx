"use client"

import { useEffect, useRef, useState } from "react"
import {
  CheckCircle2,
  Loader2,
  XCircle,
  ChevronRight,
  Brain,
  ListTree,
  Wrench,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { ActivityStep, ChatMessage } from "@/lib/types"

/** Max visible step rows in the live feed; scroll up for older steps. */
const LIVE_VISIBLE_STEPS = 6
const LIVE_STEP_ROW_PX = 26

function parseArgs(args?: string): Record<string, unknown> {
  if (!args) return {}
  try {
    return JSON.parse(args) as Record<string, unknown>
  } catch {
    return {}
  }
}

function toolStepLabel(step: ActivityStep): string {
  const tool = step.tool ?? step.label
  const args = parseArgs(step.args)
  switch (tool) {
    case "read_file":
      return `Read ${args.path ?? "file"}`
    case "grep":
      return `Grepped ${args.pattern ?? "pattern"}${args.path ? ` in ${args.path}` : ""}`
    case "glob":
      return `Searched ${args.pattern ?? "pattern"}`
    case "bash":
      return `Ran ${String(args.command ?? "command").slice(0, 72)}`
    case "list_directory":
      return `Listed ${args.path ?? "."}`
    case "write_file":
      return `Write ${args.path ?? "file"}`
    case "edit_file":
      return `Edit ${args.path ?? "file"}`
    case "git_status":
      return "Git status"
    case "git_diff":
      return "Git diff"
    case "git_log":
      return "Git log"
    case "git_commit":
      return `Commit ${String(args.message ?? "").slice(0, 40)}`
    default:
      return tool
  }
}

function activitySummary(steps: ActivityStep[], streaming?: boolean): string {
  const tools = steps.filter((s) => s.kind === "tool").length
  const thoughts = steps.filter((s) => s.kind === "thought").length
  if (streaming) {
    const running = steps.filter((s) => s.status === "running").length
    if (running > 0) return `进行中 · ${steps.length} 步`
    return `${steps.length} 步`
  }
  const parts: string[] = [`${steps.length} 步`]
  if (thoughts > 0) parts.push(`${thoughts} 思考`)
  if (tools > 0) parts.push(`${tools} 执行`)
  return parts.join(" · ")
}

function CollapseBlock({
  icon: Icon,
  title,
  subtitle,
  loading,
  defaultOpen = false,
  children,
}: {
  icon: typeof Brain
  title: string
  subtitle?: string
  loading?: boolean
  defaultOpen?: boolean
  children?: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="w-full text-xs text-muted-foreground">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 py-1 text-left hover:text-foreground"
      >
        <ChevronRight
          className={cn("size-3 shrink-0 transition-transform", open && "rotate-90")}
        />
        <Icon className="size-3 shrink-0" />
        <span className="font-medium text-foreground/80">{title}</span>
        {subtitle && <span className="truncate">{subtitle}</span>}
        {loading && <Loader2 className="ml-1 size-3 animate-spin text-primary" />}
      </button>
      {open && children && (
        <div className="group/activity-scroll ml-5 min-w-0 border-l border-border/60 pb-1 pl-3">
          <div className="scrollbar-hover-y max-h-48 min-w-0 pt-0.5">{children}</div>
        </div>
      )}
    </div>
  )
}

function StepStatus({ status }: { status: ActivityStep["status"] }) {
  if (status === "success") return <CheckCircle2 className="size-3 text-success/80" />
  if (status === "running") return <Loader2 className="size-3 animate-spin text-warning" />
  return <XCircle className="size-3 text-destructive" />
}

function LiveStepRow({ step }: { step: ActivityStep }) {
  const isThought = step.kind === "thought"
  const label = isThought ? "思考" : toolStepLabel(step)
  const dimmed = step.status === "success"

  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-2 overflow-hidden py-0.5",
        dimmed && !isThought && step.status !== "running" && "text-muted-foreground/70",
      )}
    >
      {isThought ? (
        <Brain className="size-3 shrink-0 text-muted-foreground" />
      ) : (
        <Wrench className="size-3 shrink-0 text-muted-foreground/80" />
      )}
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-[11px]",
          !isThought && "font-mono",
          step.status === "running" && "text-foreground",
        )}
      >
        {label}
      </span>
      <StepStatus status={step.status} />
    </div>
  )
}

function LiveActivityFeed({ steps }: { steps: ActivityStep[] }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickToBottomRef = useRef(true)

  useEffect(() => {
    const el = scrollRef.current
    if (!el || !stickToBottomRef.current) return
    el.scrollTop = el.scrollHeight
  }, [steps])

  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 12
  }

  const hiddenCount = Math.max(0, steps.length - LIVE_VISIBLE_STEPS)

  return (
    <div className="group/activity-scroll w-full min-w-0">
      <div className="mb-1 flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
        <Loader2 className="size-3 shrink-0 animate-spin text-primary" />
        <span className="shrink-0">思考与执行</span>
        <span className="shrink-0 text-muted-foreground/60">· {steps.length} 步</span>
        {hiddenCount > 0 && (
          <span className="truncate text-muted-foreground/50">悬停可滚动查看更早步骤</span>
        )}
      </div>
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="scrollbar-hover-y min-w-0 border-l border-border/50 pl-3"
        style={{ maxHeight: LIVE_VISIBLE_STEPS * LIVE_STEP_ROW_PX }}
      >
        {steps.map((step) => (
          <LiveStepRow key={step.id} step={step} />
        ))}
      </div>
    </div>
  )
}

function ThoughtStep({ step }: { step: ActivityStep }) {
  const [open, setOpen] = useState(false)

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 py-0.5 text-left hover:text-foreground"
      >
        <Brain className="size-3 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-[11px]">思考</span>
        <span className="shrink-0">
          <StepStatus status={step.status} />
        </span>
      </button>
      {open && step.detail && (
        <p className="mb-1 pl-5 text-[10px] leading-relaxed text-muted-foreground">{step.detail}</p>
      )}
    </div>
  )
}

function ToolStep({ step }: { step: ActivityStep }) {
  const [open, setOpen] = useState(false)
  const detailParts = [`参数:\n${JSON.stringify(parseArgs(step.args), null, 2)}`]
  if (step.result) detailParts.push(`\n结果:\n${step.result}`)

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 py-0.5 text-left hover:text-foreground"
      >
        <Wrench className="size-3 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{toolStepLabel(step)}</span>
        <span className="shrink-0">
          <StepStatus status={step.status} />
        </span>
      </button>
      {open && (
        <pre className="mb-1 max-h-40 overflow-x-hidden overflow-y-auto whitespace-pre-wrap rounded bg-muted/30 p-2 font-mono text-[10px] leading-relaxed scrollbar-hover-y">
          {detailParts.join("\n")}
        </pre>
      )}
    </div>
  )
}

export function ToolActivityPanel({ message }: { message: ChatMessage }) {
  const steps = message.activitySteps ?? []
  const hasRunning = steps.some((s) => s.status === "running")
  const isLive = Boolean(message.streaming)

  const showThinking = isLive && steps.length === 0

  if (!showThinking && steps.length === 0) return null

  if (showThinking) {
    return (
      <div className="flex w-full items-center gap-2 py-1 text-[11px] text-muted-foreground">
        <Brain className="size-3 shrink-0" />
        <span>思考中…</span>
        <Loader2 className="size-3 animate-spin text-primary" />
      </div>
    )
  }

  if (isLive) {
    return <LiveActivityFeed steps={steps} />
  }

  return (
    <div className="flex w-full flex-col gap-0.5">
      <CollapseBlock
        icon={ListTree}
        title="活动记录"
        subtitle={activitySummary(steps, false)}
        loading={hasRunning}
        defaultOpen={false}
      >
        <div className="flex flex-col gap-0.5 pt-0.5">
          {steps.map((step) =>
            step.kind === "thought" ? (
              <ThoughtStep key={step.id} step={step} />
            ) : (
              <ToolStep key={step.id} step={step} />
            ),
          )}
        </div>
        {steps.length > 0 && (
          <p className="mt-2 border-t border-border/40 pt-2 text-[10px] text-muted-foreground">
            汇总：{activitySummary(steps, false)}
          </p>
        )}
      </CollapseBlock>
    </div>
  )
}
