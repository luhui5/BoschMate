import type { ActivityStep } from "@/lib/types"

export interface ParsedThought {
  summary: string
  plan: string
  body: string
}

const PLAN_START = "<!-- plan -->"
const PLAN_END = "<!-- /plan -->"

export function splitThoughtDetail(detail: string | undefined): ParsedThought {
  if (!detail?.trim()) {
    return { summary: "", plan: "", body: "" }
  }

  const text = detail.trim()

  const planStart = text.indexOf(PLAN_START)
  const planEnd = text.indexOf(PLAN_END)

  if (planStart >= 0 && planEnd > planStart) {
    const beforePlan = text.slice(0, planStart).trim()
    const plan = text.slice(planStart + PLAN_START.length, planEnd).trim()
    const afterPlan = text.slice(planEnd + PLAN_END.length).trim()

    const summary = beforePlan.split("\n")[0]?.trim() ?? ""
    const bodyPrefix = beforePlan.includes("\n")
      ? beforePlan.split("\n").slice(1).join("\n").trim()
      : ""
    const body = [bodyPrefix, afterPlan].filter(Boolean).join("\n\n").trim()

    return { summary, plan, body }
  }

  const lines = text.split("\n")
  const summary = lines[0]?.trim() ?? ""
  const rest = lines.slice(1).join("\n").trim()

  if (!rest) {
    return { summary, plan: "", body: "" }
  }

  const paragraphs = rest.split(/\n\n+/)
  if (paragraphs.length === 1) {
    return { summary, plan: "", body: paragraphs[0] ?? "" }
  }

  return {
    summary,
    plan: paragraphs[0]?.trim() ?? "",
    body: paragraphs.slice(1).join("\n\n").trim(),
  }
}

export function formatThoughtDuration(step: ActivityStep, now = Date.now()): string | null {
  const started = step.startedAt ? Date.parse(step.startedAt) : NaN
  if (Number.isNaN(started)) return null

  const ended =
    step.status !== "running" && step.finishedAt
      ? Date.parse(step.finishedAt)
      : now

  if (Number.isNaN(ended)) return null

  const seconds = Math.max(1, Math.round((ended - started) / 1000))
  return `Thought for ${seconds}s`
}

export function pickLiveThought(steps: ActivityStep[] | undefined): ActivityStep | undefined {
  if (!steps?.length) return undefined

  for (let i = steps.length - 1; i >= 0; i--) {
    if (steps[i].kind === "thought" && steps[i].status === "running") {
      return steps[i]
    }
  }

  for (let i = steps.length - 1; i >= 0; i--) {
    if (steps[i].kind === "thought") {
      return steps[i]
    }
  }

  return undefined
}
