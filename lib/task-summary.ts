import type { ActivityStep, ChatMessage, DiffHunk } from "@/lib/types"

function parseArgs(args?: string): Record<string, unknown> {
  if (!args) return {}
  try {
    return JSON.parse(args) as Record<string, unknown>
  } catch {
    return {}
  }
}

export interface TaskSummaryFileChange {
  path: string
  additions: number
  deletions: number
  diffStatus?: DiffHunk["status"]
}

export interface TaskSummaryCommand {
  command: string
  status: ActivityStep["status"]
}

export interface TaskSummary {
  toolStepCount: number
  errorCount: number
  files: TaskSummaryFileChange[]
  commands: TaskSummaryCommand[]
  hasErrors: boolean
}

export function shouldShowFileChanges(message: ChatMessage): boolean {
  if (message.role !== "assistant" || message.streaming) return false
  if (message.mode !== "auto") return false
  return buildTaskSummary(message.activitySteps, message.diffs).files.length > 0
}

/** Split assistant content into body (before) and trailing 执行汇总 section. */
export function splitExecutionSummary(content: string): { before: string; summary: string } {
  const lines = content.replace(/\r\n/g, "\n").split("\n")
  let summaryStartLine = -1

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim()
    if (/^#{1,3}\s*执行汇总\s*$/.test(line)) {
      summaryStartLine = i
      break
    }
    if (/^\*\*执行汇总\*\*\s*$/.test(line)) {
      summaryStartLine = i
      break
    }
    if (/^-\s*\*\*执行汇总\*\*\s*$/.test(line)) {
      summaryStartLine = i
      break
    }
  }

  if (summaryStartLine < 0) {
    return { before: content, summary: "" }
  }

  return {
    before: lines.slice(0, summaryStartLine).join("\n").replace(/\n+$/, ""),
    summary: lines.slice(summaryStartLine).join("\n"),
  }
}

export function buildTaskSummary(
  steps: ActivityStep[] | undefined,
  diffs: DiffHunk[] | undefined,
): TaskSummary {
  const toolSteps = steps?.filter((s) => s.kind === "tool") ?? []
  const errorCount = toolSteps.filter((s) => s.status === "error").length

  const fileMap = new Map<string, TaskSummaryFileChange>()

  for (const d of diffs ?? []) {
    fileMap.set(d.filePath, {
      path: d.filePath,
      additions: d.additions,
      deletions: d.deletions,
      diffStatus: d.status,
    })
  }

  for (const step of toolSteps) {
    const tool = step.tool ?? ""
    if (tool !== "write_file" && tool !== "edit_file") continue
    const path = String(parseArgs(step.args).path ?? "")
    if (!path || fileMap.has(path)) continue
    fileMap.set(path, {
      path,
      additions: tool === "write_file" ? 1 : 0,
      deletions: tool === "edit_file" ? 1 : 0,
    })
  }

  const commands: TaskSummaryCommand[] = []
  for (const step of toolSteps) {
    if ((step.tool ?? "") !== "bash") continue
    const command = String(parseArgs(step.args).command ?? step.label).trim()
    if (!command) continue
    commands.push({ command, status: step.status })
  }

  return {
    toolStepCount: toolSteps.length,
    errorCount,
    files: [...fileMap.values()].sort((a, b) => a.path.localeCompare(b.path)),
    commands,
    hasErrors: errorCount > 0,
  }
}

export function fileChangeLabel(f: TaskSummaryFileChange): string {
  if (f.additions > 0 || f.deletions > 0) {
    const bits: string[] = []
    if (f.additions > 0) bits.push(`+${f.additions}`)
    if (f.deletions > 0) bits.push(`-${f.deletions}`)
    return bits.join(" / ")
  }
  return "已变更"
}
