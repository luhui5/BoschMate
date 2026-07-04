import type { AssistantSession } from "@/lib/assistant-sessions"

export function isAssistantSessionProcessing(session: AssistantSession): boolean {
  return session.messages.some(
    (m) =>
      m.role === "assistant" &&
      (Boolean(m.streaming) ||
        (m.activitySteps?.some((s) => s.status === "running") ?? false)),
  )
}
