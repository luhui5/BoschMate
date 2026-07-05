"use client"

import { memo, useLayoutEffect, useRef, useState, useCallback, useEffect } from "react"
import {
  CheckCircle2,
  Loader2,
  XCircle,
  ChevronRight,
  Brain,
  ListTree,
  Wrench,
} from "lucide-react"
import { BoschGradientText } from "@/components/bosch-gradient-text"
import { cn } from "@/lib/utils"
import { isNearBottom, scrollContainerToBottom } from "@/lib/scroll-to-bottom"
import type { ActivityStep, ChatMessage } from "@/lib/types"
import {
  formatThoughtDuration,
  splitThoughtDetail,
} from "@/lib/thought-display"

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
    case "open":
      return `Open ${args.target ?? args.kind ?? "target"}`
    case "open_vscode":
      return `Open VS Code${args.path ? ` at ${args.path}` : ""}`
    case "find_references":
      return `Find references to ${args.symbol_name ?? "symbol"}`
    case "list_symbols":
      return `List symbols in ${args.file_path ?? "file"}`
    case "file_deps":
      return `Analyze deps for ${args.file_path ?? "file"}`
    case "blast_radius":
      return `Blast radius for ${args.file_path ?? "file"}`
    case "web_fetch":
      return `Fetch ${args.url ?? "url"}`
    case "outlook_read": {
      const folder = String(args.folder ?? "inbox")
      const count = args.count ?? 10
      return `Read Outlook ${folder} (${count})`
    }
    case "outlook_send": {
      const to = args.to
      const recipient =
        Array.isArray(to) && to.length > 0
          ? String(to[0])
          : typeof to === "string"
            ? to
            : "recipient"
      return args.draft ? `Save Outlook draft to ${recipient}` : `Send mail to ${recipient}`
    }
    default:
      return tool
  }
}

function activitySummary(steps: ActivityStep[]): string {
  const tools = steps.filter((s) => s.kind === "tool").length
  const thoughts = steps.filter((s) => s.kind === "thought").length
  const parts: string[] = [`${steps.length} 步`]
  if (thoughts > 0) parts.push(`${thoughts} 思考`)
  if (tools > 0) parts.push(`${tools} 执行`)
  return parts.join(" · ")
}

const ACTIVITY_SCROLL_MAX_H = "max-h-[min(420px,50vh)]"

function ActivityScrollContainer({
  children,
  stickToBottom,
  scrollDeps,
  className,
}: {
  children: React.ReactNode
  stickToBottom?: boolean
  scrollDeps?: unknown
  className?: string
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const stickToBottomRef = useRef(true)

  const scrollInnerToBottom = useCallback(() => {
    if (!stickToBottom) return
    const el = scrollRef.current
    if (!el || !stickToBottomRef.current) return
    scrollContainerToBottom(el, "instant")
  }, [stickToBottom])

  useLayoutEffect(() => {
    scrollInnerToBottom()
  }, [scrollDeps, scrollInnerToBottom])

  useLayoutEffect(() => {
    if (!stickToBottom) return
    const content = contentRef.current
    if (!content) return

    const ro = new ResizeObserver(() => {
      scrollInnerToBottom()
    })
    ro.observe(content)
    return () => ro.disconnect()
  }, [stickToBottom, scrollInnerToBottom])

  const onScroll = () => {
    if (!stickToBottom) return
    const el = scrollRef.current
    if (!el) return
    stickToBottomRef.current = isNearBottom(el, 16)
  }

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      className={cn(
        "scrollbar-hover-y min-w-0 overflow-y-auto pr-1",
        ACTIVITY_SCROLL_MAX_H,
        className,
      )}
    >
      <div ref={contentRef}>{children}</div>
    </div>
  )
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
          <ActivityScrollContainer className="pt-0.5">{children}</ActivityScrollContainer>
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
        <p className="mb-1 whitespace-pre-wrap pl-5 text-[10px] leading-relaxed text-muted-foreground">
          {step.detail}
        </p>
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

function CompactToolRow({ step }: { step: ActivityStep }) {
  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-2 py-0.5",
        step.status === "success" && "text-muted-foreground/70",
      )}
    >
      <Wrench className="size-3 shrink-0 text-muted-foreground/70" />
      {step.status === "running" ? (
        <BoschGradientText className="min-w-0 flex-1 truncate font-mono text-[11px]">
          {toolStepLabel(step)}
        </BoschGradientText>
      ) : (
        <span className="min-w-0 flex-1 truncate font-mono text-[11px]">
          {toolStepLabel(step)}
        </span>
      )}
      <StepStatus status={step.status} />
    </div>
  )
}

function CompactThoughtRow({ step, now }: { step: ActivityStep; now: number }) {
  const duration = formatThoughtDuration(step, now)
  const { summary } = splitThoughtDetail(step.detail)

  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-2 py-0.5",
        step.status === "success" && "text-muted-foreground/70",
      )}
    >
      <Brain className="size-3 shrink-0 text-muted-foreground/70" />
      <span className="shrink-0 text-[11px]">{duration ?? "思考"}</span>
      {summary && (
        <span className="min-w-0 flex-1 truncate text-[11px]">{summary}</span>
      )}
      <StepStatus status={step.status} />
    </div>
  )
}

function LiveThoughtBlock({ step, now }: { step: ActivityStep; now: number }) {
  const durationLabel = formatThoughtDuration(step, now)
  const { summary, plan, body } = splitThoughtDetail(step.detail)
  const hasDetail = Boolean(summary || plan || body)

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">
          {durationLabel ?? "Thinking"}
        </span>
        <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
      </div>
      {summary && (
        <p className="text-sm text-foreground/90">{summary}</p>
      )}
      {plan && (
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground/60">
          {plan}
        </p>
      )}
      {body && (
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
          {body}
        </p>
      )}
      {!hasDetail && (
        <p className="text-sm leading-relaxed text-muted-foreground/60">正在思考…</p>
      )}
    </div>
  )
}

function ActivityTimeline({
  steps,
  mode,
}: {
  steps: ActivityStep[]
  mode: "live" | "compact"
}) {
  const [now, setNow] = useState(() => Date.now())

  const thoughtRunning = steps.some(
    (s) => s.kind === "thought" && s.status === "running",
  )

  useEffect(() => {
    if (!thoughtRunning) return
    const id = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(id)
  }, [thoughtRunning])

  if (steps.length === 0) {
    return (
      <p className="text-sm leading-relaxed text-muted-foreground/60">正在分析…</p>
    )
  }

  return (
    <div className="space-y-2">
      {steps.map((step) => {
        if (step.kind === "thought") {
          if (mode === "live" && step.status === "running") {
            return <LiveThoughtBlock key={step.id} step={step} now={now} />
          }
          return <CompactThoughtRow key={step.id} step={step} now={now} />
        }
        return <CompactToolRow key={step.id} step={step} />
      })}
    </div>
  )
}

function activityScrollSignature(steps: ActivityStep[]): string {
  return `${steps.length}:${steps.map((s) => s.detail?.length ?? 0).join(",")}`
}

function StreamingActivityPanel({
  steps,
  mode,
  stickToBottom,
}: {
  steps: ActivityStep[]
  mode: "live" | "compact"
  stickToBottom: boolean
}) {
  const scrollDeps = activityScrollSignature(steps)

  return (
    <div className="w-full min-w-0">
      <ActivityScrollContainer stickToBottom={stickToBottom} scrollDeps={scrollDeps}>
        <ActivityTimeline steps={steps} mode={mode} />
      </ActivityScrollContainer>
    </div>
  )
}

function ToolActivityPanelInner({
  message,
  explorePhase,
}: {
  message: ChatMessage
  /** When true, show live Exploring stream; false after tools finish and final reply streams. */
  explorePhase?: boolean
}) {
  const steps = message.activitySteps ?? []
  const isStreaming = Boolean(message.streaming)
  const hasRunningTool = steps.some((s) => s.kind === "tool" && s.status === "running")
  const hasRunningThought = steps.some(
    (s) => s.kind === "thought" && s.status === "running",
  )
  const isLive =
    explorePhase ??
    (isStreaming && (steps.length === 0 || hasRunningTool || hasRunningThought))

  const showThinking = isLive && steps.length === 0

  if (!showThinking && steps.length === 0) return null

  if (isLive || (isStreaming && steps.length > 0)) {
    return (
      <StreamingActivityPanel
        steps={steps}
        mode={isLive ? "live" : "compact"}
        stickToBottom={isStreaming}
      />
    )
  }

  const hasRunning = hasRunningTool || hasRunningThought

  return (
    <div className="flex w-full flex-col gap-0.5">
      <CollapseBlock
        icon={ListTree}
        title="活动记录"
        subtitle={activitySummary(steps)}
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
            汇总：{activitySummary(steps)}
          </p>
        )}
      </CollapseBlock>
    </div>
  )
}

export const ToolActivityPanel = memo(
  ToolActivityPanelInner,
  (prev, next) =>
    prev.explorePhase === next.explorePhase &&
    prev.message.streaming === next.message.streaming &&
    prev.message.activitySteps === next.message.activitySteps,
)
