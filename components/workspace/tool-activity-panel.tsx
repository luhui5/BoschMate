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
  pickLiveThought,
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

function ExploringLivePanel({
  steps,
  liveThought,
  thinkingOnly = false,
}: {
  steps: ActivityStep[]
  liveThought?: ActivityStep
  thinkingOnly?: boolean
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const stickToBottomRef = useRef(true)
  const [now, setNow] = useState(() => Date.now())

  const toolSteps = steps.filter((s) => s.kind === "tool")
  const hasRunningTool = toolSteps.some((s) => s.status === "running")
  const thoughtRunning = liveThought?.status === "running"

  const phaseTitle = thinkingOnly || !hasRunningTool ? "Exploring" : "Executing"
  const durationLabel = liveThought ? formatThoughtDuration(liveThought, now) : null
  const { summary, plan, body } = splitThoughtDetail(liveThought?.detail)

  useEffect(() => {
    if (!thoughtRunning) return
    const id = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(id)
  }, [thoughtRunning])

  const scrollInnerToBottom = useCallback(() => {
    const el = scrollRef.current
    if (!el || !stickToBottomRef.current) return
    scrollContainerToBottom(el, "instant")
  }, [])

  useLayoutEffect(() => {
    scrollInnerToBottom()
  }, [toolSteps.length, liveThought?.detail, scrollInnerToBottom])

  useLayoutEffect(() => {
    const content = contentRef.current
    if (!content) return

    const ro = new ResizeObserver(() => {
      scrollInnerToBottom()
    })
    ro.observe(content)
    return () => ro.disconnect()
  }, [scrollInnerToBottom])

  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    stickToBottomRef.current = isNearBottom(el, 16)
  }

  const hasThoughtText = Boolean(summary || plan || body)

  return (
    <div className="w-full min-w-0">
      {durationLabel && (
        <p className="mb-1 text-xs text-muted-foreground">{durationLabel}</p>
      )}

      {summary && (
        <p className="mb-2 text-sm text-foreground/90">{summary}</p>
      )}

      <div className="mb-2 flex items-center gap-2">
        <span className="text-sm font-medium text-foreground/90">{phaseTitle}</span>
        {(thinkingOnly || thoughtRunning || hasRunningTool) && (
          <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
        )}
      </div>

      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="scrollbar-hover-y max-h-[min(420px,50vh)] min-w-0 space-y-3 overflow-y-auto pr-1"
      >
        <div ref={contentRef} className="space-y-3">
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

          {!hasThoughtText && toolSteps.length === 0 && (
            <p className="text-sm leading-relaxed text-muted-foreground/60">正在分析…</p>
          )}

          {toolSteps.length > 0 && (
            <div className="space-y-0.5">
              {toolSteps.map((step) => (
                <CompactToolRow key={step.id} step={step} />
              ))}
            </div>
          )}
        </div>
      </div>
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
  const liveThought = pickLiveThought(steps)
  const hasRunningTool = steps.some((s) => s.kind === "tool" && s.status === "running")
  const isLive =
    explorePhase ??
    (Boolean(message.streaming) && (steps.length === 0 || hasRunningTool))

  const showThinking = isLive && steps.length === 0

  if (!showThinking && steps.length === 0) return null

  if (isLive) {
    return (
      <ExploringLivePanel
        steps={steps}
        liveThought={liveThought}
        thinkingOnly={showThinking}
      />
    )
  }

  const hasRunning =
    steps.some((s) => s.kind === "tool" && s.status === "running") ||
    steps.some((s) => s.kind === "thought" && s.status === "running" && explorePhase)

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
