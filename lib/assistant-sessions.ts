import type { ThinkingDepth } from "@/lib/thinking-depth"
import type { ActivityStep, AgentMode, DiffHunk, PendingQuestions } from "@/lib/types"
import { DEFAULT_MODELS, resolveActiveModelId, resolveDefaultModelForNewSession } from "@/lib/models"
import { ASSISTANT_PROJECT_ID } from "@/lib/constants"
import { resolveDefaultAssistantWorkspace } from "@/lib/assistant-workspace"
import {
  findWorkspaceByFolder,
  listAssistantWorkspaces,
  type AssistantWorkspace,
} from "@/lib/assistant-workspaces"
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
  streaming?: boolean
  activitySteps?: ActivityStep[]
  diffs?: DiffHunk[]
  pendingQuestions?: PendingQuestions
  mode?: AgentMode
  createdAt?: string
}

export interface AssistantSession {
  id: string
  title: string
  messages: AssistantMessage[]
  /** Workspace project id (DB sessions.project_id) */
  projectId: string
  /** Binding folder for AI tools / legacy compat */
  folder: string | null
  model: string
  depth: ThinkingDepth
  createdAt: string
  updatedAt: string
  /** True when loaded from legacy ASSISTANT_PROJECT_ID bucket */
  legacy?: boolean
}

/** 用于新建会话时快速生成一个空会话 */
export function createSession(overrides: Partial<AssistantSession> = {}): AssistantSession {
  const now = new Date().toISOString()
  return {
    id: `s-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    title: "新对话",
    messages: [],
    projectId: overrides.projectId ?? "mock-home",
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
  projectId: string,
  model?: string,
  folder?: string | null,
  legacy?: boolean,
): AssistantSession {
  const now = db.updatedAt
  return {
    id: db.id,
    title: db.title,
    messages: db.messages ?? [],
    projectId,
    folder: folder ?? null,
    model: model ?? DEFAULT_MODELS[0]?.id ?? "",
    depth: "default",
    createdAt: now,
    updatedAt: now,
    legacy,
  }
}

async function loadSessionMessages(sessionId: string): Promise<AssistantMessage[]> {
  const msgs = await tauriListMessages(sessionId)
  return msgs.map((m) => ({
    id: m.id,
    role: m.role as "user" | "assistant",
    content: m.content,
    createdAt: m.createdAt,
  }))
}

/** 在 Tauri 下创建并持久化到 SQLite；浏览器模式仅本地内存。 */
export async function createPersistedSession(
  overrides: Partial<AssistantSession> & { projectId?: string } = {},
): Promise<AssistantSession> {
  const { loadModels } = await import("@/lib/models")
  const models = await loadModels()
  const model =
    overrides.model ??
    (await resolveDefaultModelForNewSession(models)) ??
    DEFAULT_MODELS[0]?.id ??
    ""

  let projectId = overrides.projectId
  let folder = overrides.folder ?? null

  if (!projectId && isTauri()) {
    const workspaces = await listAssistantWorkspaces()
    const home = workspaces.find((w) => w.isHome) ?? workspaces[0]
    projectId = home?.projectId
    folder = folder ?? home?.localPath ?? (await resolveDefaultAssistantWorkspace())
  }

  if (!projectId) {
    projectId = "mock-home"
    folder = folder ?? "~/.boschassistant/workspace"
  }

  if (isTauri()) {
    const db = await tauriCreateSession({
      project_id: projectId,
      title: overrides.title ?? "新对话",
      mode: "ask",
    })
    if (folder) {
      await saveSessionFolder(db.id, folder)
    }
    return toAssistantSession(
      { id: db.id, title: db.title, updatedAt: db.updatedAt },
      projectId,
      model,
      folder,
    )
  }
  return createSession({ ...overrides, projectId, folder, model })
}

/** Group sessions by workspace for sidebar tree. */
export function groupSessionsByWorkspace(
  workspaces: AssistantWorkspace[],
  sessions: AssistantSession[],
): Map<string, AssistantSession[]> {
  const map = new Map<string, AssistantSession[]>()
  for (const ws of workspaces) {
    map.set(ws.projectId, [])
  }
  for (const s of sessions) {
    const ws =
      workspaces.find((w) => w.projectId === s.projectId) ??
      findWorkspaceByFolder(workspaces, s.folder)
    const key = ws?.projectId ?? s.projectId
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(s)
  }
  for (const [, list] of map) {
    list.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
  }
  return map
}

/** 从 SQLite 加载所有 workspace 会话 + 遗留 ASSISTANT 会话（Tauri）或返回空（浏览器）。 */
export async function loadPersistedSessions(): Promise<AssistantSession[]> {
  if (!isTauri()) return []

  const { loadModels } = await import("@/lib/models")
  const models = await loadModels()
  const preferredModel = await resolveActiveModelId(models)
  const workspaces = await listAssistantWorkspaces()
  const seen = new Set<string>()
  const out: AssistantSession[] = []

  for (const ws of workspaces) {
    const rows = await tauriListSessions(ws.projectId)
    for (const s of rows) {
      if (seen.has(s.id)) continue
      seen.add(s.id)
      const msgs = await loadSessionMessages(s.id)
      let folder = await loadSessionFolder(s.id)
      if (!folder) {
        folder = ws.localPath
        if (folder) await saveSessionFolder(s.id, folder)
      }
      out.push(
        toAssistantSession(
          {
            id: s.id,
            title: s.title,
            updatedAt: s.updatedAt,
            messages: msgs,
          },
          ws.projectId,
          preferredModel,
          folder,
        ),
      )
    }
  }

  // Legacy sessions under ASSISTANT_PROJECT_ID
  const legacyRows = await tauriListSessions(ASSISTANT_PROJECT_ID)
  for (const s of legacyRows) {
    if (seen.has(s.id)) continue
    seen.add(s.id)
    const msgs = await loadSessionMessages(s.id)
    let folder = await loadSessionFolder(s.id)
    if (!folder) {
      folder = await resolveDefaultAssistantWorkspace()
      if (folder) await saveSessionFolder(s.id, folder)
    }
    const ws = findWorkspaceByFolder(workspaces, folder)
    out.push(
      toAssistantSession(
        {
          id: s.id,
          title: s.title,
          updatedAt: s.updatedAt,
          messages: msgs,
        },
        ws?.projectId ?? ASSISTANT_PROJECT_ID,
        preferredModel,
        folder,
        true,
      ),
    )
  }

  out.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
  return out
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
