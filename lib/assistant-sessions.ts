import type { ThinkingDepth } from "@/lib/thinking-depth"
import { DEFAULT_MODELS, resolveActiveModelId, resolveDefaultModelForNewSession } from "@/lib/models"
import { ASSISTANT_PROJECT_ID } from "@/lib/constants"
import {
  isTauri,
  createSession as tauriCreateSession,
  listSessions as tauriListSessions,
  listMessages as tauriListMessages,
  getSetting,
  setSetting,
} from "@/lib/tauri-api"

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

function toAssistantSession(
  db: {
    id: string
    title: string
    updatedAt: string
    messages?: AssistantMessage[]
  },
  model?: string,
  folder?: string | null,
): AssistantSession {
  const now = db.updatedAt
  return {
    id: db.id,
    title: db.title,
    messages: db.messages ?? [],
    folder: folder ?? null,
    model: model ?? DEFAULT_MODELS[0]?.id ?? "",
    depth: "default",
    createdAt: now,
    updatedAt: now,
  }
}

/** 在 Tauri 下创建并持久化到 SQLite；浏览器模式仅本地内存。 */
export async function createPersistedSession(
  overrides: Partial<AssistantSession> = {},
): Promise<AssistantSession> {
  const { loadModels } = await import("@/lib/models")
  const models = await loadModels()
  const model =
    overrides.model ??
    (await resolveDefaultModelForNewSession(models)) ??
    DEFAULT_MODELS[0]?.id ??
    ""
  if (isTauri()) {
    const db = await tauriCreateSession({
      project_id: ASSISTANT_PROJECT_ID,
      title: overrides.title ?? "新对话",
      mode: "ask",
    })
    return toAssistantSession(
      { id: db.id, title: db.title, updatedAt: db.updatedAt },
      model,
      overrides.folder ?? null,
    )
  }
  return createSession({ ...overrides, model })
}

/** 从 SQLite 加载 Assistant 历史会话（Tauri）或返回空（浏览器）。 */
export async function loadPersistedSessions(): Promise<AssistantSession[]> {
  if (!isTauri()) return []
  const { loadModels } = await import("@/lib/models")
  const models = await loadModels()
  const preferredModel = await resolveActiveModelId(models)
  const rows = await tauriListSessions(ASSISTANT_PROJECT_ID)
  const sessions = await Promise.all(
    rows.map(async (s) => {
      const msgs = await tauriListMessages(s.id)
      const folder = await loadSessionFolder(s.id)
      return toAssistantSession(
        {
          id: s.id,
          title: s.title,
          updatedAt: s.updatedAt,
          messages: msgs.map((m) => ({
            id: m.id,
            role: m.role as "user" | "assistant",
            content: m.content,
          })),
        },
        preferredModel,
        folder,
      )
    }),
  )
  return sessions
}

/** 预置的历史会话（当前为空） */
export const SEED_SESSIONS: AssistantSession[] = []

const folderSettingKey = (sessionId: string) => `assistant_folder:${sessionId}`

export async function loadSessionFolder(sessionId: string): Promise<string | null> {
  try {
    const val = await getSetting(folderSettingKey(sessionId))
    return val && val.trim() ? val : null
  } catch {
    return null
  }
}

export async function saveSessionFolder(
  sessionId: string,
  folder: string | null,
): Promise<void> {
  try {
    await setSetting(folderSettingKey(sessionId), folder ?? "")
  } catch {
    /* ignore */
  }
}
