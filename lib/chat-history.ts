import type { AssistantMessage } from "@/lib/assistant-sessions"
import type { ActivityStep } from "@/lib/types"

export interface LlmMessage {
  role: string
  content: string
}

export interface BuildLlmMessagesOptions {
  maxTurnsWithTools?: number
  maxDigestChars?: number
  maxResultChars?: number
}

const DEFAULT_MAX_TURNS = 3
const DEFAULT_MAX_DIGEST_CHARS = 2000
const DEFAULT_MAX_RESULT_CHARS = 300

const PRIORITY_TOOLS = new Set(["read_file", "grep", "glob", "list_directory"])

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}…`
}

function parseArgs(args: string | undefined): Record<string, unknown> {
  if (!args) return {}
  try {
    const parsed = JSON.parse(args) as unknown
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

function formatToolStep(step: ActivityStep, maxResultChars: number): string {
  const tool = step.tool ?? step.label
  const args = parseArgs(step.args)
  const parts: string[] = [`Tool: ${tool}`]

  if (typeof args.path === "string") parts.push(`path: ${args.path}`)
  else if (typeof args.file_path === "string") parts.push(`path: ${args.file_path}`)
  if (typeof args.pattern === "string") parts.push(`pattern: ${args.pattern}`)
  if (typeof args.query === "string") parts.push(`query: ${args.query}`)

  if (step.result) {
    parts.push(`Result: ${truncate(step.result, maxResultChars)}`)
  }

  return parts.join(" | ")
}

function successfulToolSteps(steps: ActivityStep[] | undefined): ActivityStep[] {
  if (!steps?.length) return []
  return steps.filter((s) => s.kind === "tool" && s.status === "success")
}

function buildTurnDigest(
  steps: ActivityStep[],
  maxDigestChars: number,
  maxResultChars: number,
): string | null {
  if (steps.length === 0) return null

  const priority = steps.filter((s) => PRIORITY_TOOLS.has(s.tool ?? s.label))
  const rest = steps.filter((s) => !PRIORITY_TOOLS.has(s.tool ?? s.label))
  const ordered = [...priority, ...rest]

  const lines = ["Previous tool results (turn summary):"]
  for (const step of ordered) {
    const line = formatToolStep(step, maxResultChars)
    const next = lines.length === 1 ? line : `\n${line}`
    if (lines.join("").length + next.length > maxDigestChars) {
      if (lines.length === 1) {
        lines.push(truncate(line, maxDigestChars - lines[0]!.length))
      }
      break
    }
    lines.push(line)
  }

  return lines.length > 1 ? lines.join("\n") : null
}

/**
 * Build LLM message array from session history, injecting compact tool-result
 * digests after assistant turns (mirrors in-loop tool result messages).
 */
export function buildLlmMessages(
  messages: Pick<AssistantMessage, "role" | "content" | "activitySteps" | "streaming">[],
  newUserContent: string,
  options?: BuildLlmMessagesOptions,
): LlmMessage[] {
  const maxTurns = options?.maxTurnsWithTools ?? DEFAULT_MAX_TURNS
  const maxDigestChars = options?.maxDigestChars ?? DEFAULT_MAX_DIGEST_CHARS
  const maxResultChars = options?.maxResultChars ?? DEFAULT_MAX_RESULT_CHARS

  type Block = { message: LlmMessage; digest: LlmMessage | null }
  const blocks: Block[] = []

  for (const msg of messages) {
    if (msg.streaming) continue
    if (msg.role === "assistant" && !msg.content.trim()) continue

    let digest: LlmMessage | null = null
    if (msg.role === "assistant") {
      const toolSteps = successfulToolSteps(msg.activitySteps)
      const digestText = buildTurnDigest(toolSteps, maxDigestChars, maxResultChars)
      if (digestText) {
        digest = { role: "user", content: digestText }
      }
    }

    blocks.push({
      message: { role: msg.role, content: msg.content },
      digest,
    })
  }

  const digestIndices = blocks
    .map((b, i) => (b.digest ? i : -1))
    .filter((i) => i >= 0)
  const keepDigests = new Set(digestIndices.slice(-maxTurns))

  const out: LlmMessage[] = []
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!
    out.push(block.message)
    if (block.digest && keepDigests.has(i)) {
      out.push(block.digest)
    }
  }

  out.push({ role: "user", content: newUserContent })
  return out
}
