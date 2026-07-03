import type { ThinkingDepth } from "@/lib/thinking-depth"
import { DEFAULT_MODELS } from "@/lib/models"

export interface AssistantMessage {
  id: string
  role: "user" | "assistant"
  content: string
}

export interface AssistantSession {
  id: string
  title: string
  messages: AssistantMessage[]
  /** 绑定的工作文件夹（可选），助手会在该目录范围内读写与检索 */
  folder: string | null
  model: string
  depth: ThinkingDepth
  createdAt: string
  updatedAt: string
}

/** 用于新建会话时快速生成一个空会话 */
export function createSession(overrides: Partial<AssistantSession> = {}): AssistantSession {
  const now = new Date().toISOString()
  return {
    id: `s-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    title: "新对话",
    messages: [],
    folder: null,
    model: DEFAULT_MODELS[0]?.id ?? "",
    depth: "default",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

/** 从首条用户消息派生一个简洁标题 */
export function deriveTitle(text: string): string {
  const t = text.trim().replace(/\s+/g, " ")
  return t.length > 24 ? `${t.slice(0, 24)}…` : t || "新对话"
}

/** 预置的历史会话（当前为空） */
export const SEED_SESSIONS: AssistantSession[] = []
