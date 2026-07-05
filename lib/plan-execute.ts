import type { AssistantMessage } from "@/lib/assistant-sessions"

export const EXECUTE_PLAN_MESSAGE = "按上述计划执行"

const EXECUTE_PLAN_PATTERNS = [/按.*计划执行/, /按计划执行/]

export function isExecutePlanUserMessage(content: string): boolean {
  const t = content.trim()
  return EXECUTE_PLAN_PATTERNS.some((p) => p.test(t))
}

/** Latest plan assistant message that has not yet been triggered for execution. */
export function findLatestExecutablePlanMessageId(
  messages: AssistantMessage[],
): string | null {
  let latestPlanIdx = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role === "assistant" && m.mode === "plan" && !m.streaming) {
      latestPlanIdx = i
      break
    }
  }
  if (latestPlanIdx < 0) return null

  for (let i = latestPlanIdx + 1; i < messages.length; i++) {
    const m = messages[i]
    if (m.role === "user" && isExecutePlanUserMessage(m.content)) return null
  }
  return messages[latestPlanIdx].id
}
