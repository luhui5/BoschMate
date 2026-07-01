import type { ThinkingDepth } from "@/lib/thinking-depth"

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

export const ASSISTANT_MODELS = [
  "Qwen2.5-Coder 32B（本地）",
  "DeepSeek V2（本地）",
  "Claude Opus 4.6",
  "GPT-5",
]

/** 用于新建会话时快速生成一个空会话 */
export function createSession(overrides: Partial<AssistantSession> = {}): AssistantSession {
  const now = new Date().toISOString()
  return {
    id: `s-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    title: "新对话",
    messages: [],
    folder: null,
    model: ASSISTANT_MODELS[0],
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

function hoursAgo(h: number): string {
  return new Date(Date.now() - h * 3600_000).toISOString()
}

/** 预置的历史会话，演示会话列表与切换 */
export const SEED_SESSIONS: AssistantSession[] = [
  {
    id: "s-seed-1",
    title: "起草项目延期说明邮件",
    folder: null,
    model: ASSISTANT_MODELS[2],
    depth: "medium",
    createdAt: hoursAgo(2),
    updatedAt: hoursAgo(2),
    messages: [
      { id: "m1", role: "user", content: "帮我起草一封项目延期说明邮件，语气专业且简洁。" },
      {
        id: "m2",
        role: "assistant",
        content:
          "主题：关于「记忆压缩器」里程碑延期的说明\n\n您好，\n\n经评估，因向量索引兼容性调整，我们建议将该里程碑交付顺延 3 个工作日。团队已制定补救计划，预计不影响后续节点。如需详细排期，请随时告知。\n\n谢谢理解。",
      },
    ],
  },
  {
    id: "s-seed-2",
    title: "架构设计规范 v3 要点总结",
    folder: "~/dev/bosch-code/docs",
    model: ASSISTANT_MODELS[0],
    depth: "high",
    createdAt: hoursAgo(20),
    updatedAt: hoursAgo(19),
    messages: [
      { id: "m1", role: "user", content: "根据知识库中的《架构设计规范 v3》，总结核心要点。" },
      {
        id: "m2",
        role: "assistant",
        content:
          "核心要点：\n1. 分层清晰——UI / 领域 / 基础设施三层隔离；\n2. 记忆采用版本链追踪压缩来源，保证可回溯；\n3. 所有对外接口需带重试与超时；\n4. 数据默认本地存储，云端为可选增量。",
      },
    ],
  },
  {
    id: "s-seed-3",
    title: "fetch 封装函数（带重试）",
    folder: "~/dev/web-dashboard",
    model: ASSISTANT_MODELS[3],
    depth: "default",
    createdAt: hoursAgo(50),
    updatedAt: hoursAgo(49),
    messages: [
      { id: "m1", role: "user", content: "用 TypeScript 写一个带重试与超时的 fetch 封装函数。" },
      {
        id: "m2",
        role: "assistant",
        content: "已为你生成 `fetchWithRetry`，支持指数退避、AbortController 超时与最大重试次数配置。",
      },
    ],
  },
]
