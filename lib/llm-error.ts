/** Parse LLM / API errors into structured UI hints. */

export type LlmErrorKind = "rate_limit" | "server" | "timeout" | "network" | "bulk_write" | "unknown"

export interface ParsedLlmError {
  kind: LlmErrorKind
  message: string
  retryAfterSec?: number
  retryable: boolean
  canSwitchModel: boolean
}

export function parseLlmError(raw: unknown): ParsedLlmError {
  const text = typeof raw === "string" ? raw : raw instanceof Error ? raw.message : String(raw)

  if (text.includes("BULK_WRITE_LIMIT")) {
    return {
      kind: "bulk_write",
      message: "Auto 模式将修改超过 50 个文件，需要您确认后继续。",
      retryable: true,
      canSwitchModel: false,
    }
  }

  const retryMatch = text.match(/retry[- ]after[:\s]+(\d+)/i) ?? text.match(/429[^0-9]*(\d+)/)
  if (text.includes("429") || /rate limit/i.test(text)) {
    const retryAfterSec = retryMatch ? Number(retryMatch[1]) : 30
    return {
      kind: "rate_limit",
      message: `请求过于频繁，请 ${retryAfterSec} 秒后重试，或切换到其他模型。`,
      retryAfterSec,
      retryable: true,
      canSwitchModel: true,
    }
  }

  if (/timeout|timed out|deadline/i.test(text)) {
    return {
      kind: "timeout",
      message: "请求超时。请检查网络或 Ollama/API 端点是否可用后重试。",
      retryable: true,
      canSwitchModel: true,
    }
  }

  if (/5\d{2}|internal server|bad gateway|service unavailable/i.test(text)) {
    return {
      kind: "server",
      message: "模型服务暂时不可用（5xx）。请稍后重试或切换模型。",
      retryable: true,
      canSwitchModel: true,
    }
  }

  if (/fetch|network|ECONNREFUSED|connection refused|not reachable/i.test(text)) {
    return {
      kind: "network",
      message: "无法连接到模型服务。请检查端点配置与网络。",
      retryable: true,
      canSwitchModel: true,
    }
  }

  return {
    kind: "unknown",
    message: text || "未知错误",
    retryable: true,
    canSwitchModel: true,
  }
}
