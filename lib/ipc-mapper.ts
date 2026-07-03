/**
 * Maps Tauri/Rust IPC payloads (snake_case) to frontend domain types (camelCase).
 */

import type {
  Project,
  Session,
  ChatMessage,
  AgentMode,
  FileNode,
  GitFile,
  Memory,
  Note,
  ToolCall,
  ActivityStep,
  CIStatus,
} from './types'
import { parseDiffsFromRaw } from './diff-parser'

// ── Raw shapes from Rust (serde default field names) ──

export interface RawProject {
  id: string
  name: string
  local_path: string
  language?: string | null
  framework?: string | null
  git_remote?: string | null
  git_branch?: string | null
  ci_status: string
  created_at: string
  opened_at?: string | null
  last_summary?: string | null
}

export interface RawSession {
  id: string
  project_id: string
  title?: string | null
  mode: string
  status: string
  parent_id?: string | null
  token_count: number
  created_at: string
  updated_at: string
}

export interface RawChatMessage {
  id: string
  session_id: string
  role: string
  content: string
  mode?: string | null
  tool_calls?: unknown
  diffs?: unknown
  file_refs?: unknown
  token_usage?: unknown
  created_at: string
}

export interface RawFileEntry {
  name: string
  path: string
  type: string
  size?: number
  modified?: string | null
  children?: RawFileEntry[] | null
}

export interface RawGitFile {
  path: string
  status: string
  staged: boolean
  additions: number
  deletions: number
}

export interface RawGitStatus {
  branch: string
  files: RawGitFile[]
  ahead: number
  behind: number
}

export interface RawMemory {
  id: string
  project_id: string
  type: string
  content: string
  summary?: string | null
  importance: number
  source_session_id?: string | null
  access_count: number
  last_accessed_at?: string | null
  encrypted: boolean
  created_at: string
}

export interface RawNote {
  id: string
  project_id: string
  title: string
  content: string
  created_at: string
  updated_at: string
}

function asAgentMode(m: string): AgentMode {
  if (m === 'ask' || m === 'plan' || m === 'edit' || m === 'auto') return m
  return 'ask'
}

function asCiStatus(s: string): CIStatus {
  if (s === 'passing' || s === 'failing' || s === 'running') return s
  return 'none'
}

function parseActivitySteps(raw: unknown): ActivityStep[] | undefined {
  if (!raw || !Array.isArray(raw) || raw.length === 0) return undefined
  const first = raw[0] as Record<string, unknown>
  if (first.kind != null) {
    return raw.map((item, i) => {
      const o = item as Record<string, unknown>
      return {
        id: String(o.id ?? `step-${i}`),
        kind: o.kind === 'thought' ? 'thought' : 'tool',
        round: Number(o.round ?? 1),
        label: String(o.label ?? o.tool ?? 'step'),
        detail: o.detail != null ? String(o.detail) : undefined,
        tool: o.tool != null ? String(o.tool) : undefined,
        args:
          typeof o.args === 'string'
            ? o.args
            : o.arguments != null
              ? JSON.stringify(o.arguments)
              : undefined,
        status: (o.status as ActivityStep['status']) ?? 'success',
        result: o.result != null ? String(o.result) : undefined,
      }
    })
  }
  // Legacy: plain tool call array without kind
  return raw.map((item, i) => {
    const o = item as Record<string, unknown>
    const tool = String(o.name ?? o.tool ?? 'tool')
    return {
      id: String(o.id ?? `legacy-tool-${i}`),
      kind: 'tool' as const,
      round: 1,
      label: tool,
      tool,
      args:
        typeof o.arguments === 'string'
          ? o.arguments
          : JSON.stringify(o.arguments ?? o.args ?? ''),
      status: (o.status as ActivityStep['status']) ?? 'success',
      result: o.result != null ? String(o.result) : undefined,
    }
  })
}

function activityStepsToToolCalls(steps: ActivityStep[]): ToolCall[] {
  return steps
    .filter((s) => s.kind === 'tool')
    .map((s) => ({
      tool: s.tool ?? s.label,
      args: s.args ?? '{}',
      status: s.status,
      result: s.result,
    }))
}

function parseToolCalls(raw: unknown): ToolCall[] | undefined {
  const steps = parseActivitySteps(raw)
  if (steps?.length) return activityStepsToToolCalls(steps)
  if (!raw || !Array.isArray(raw)) return undefined
  return raw.map((tc) => {
    const o = tc as Record<string, unknown>
    return {
      tool: String(o.name ?? o.tool ?? 'tool'),
      args: typeof o.arguments === 'string' ? o.arguments : JSON.stringify(o.arguments ?? o.args ?? ''),
      status: (o.status as ToolCall['status']) ?? 'success',
      result: o.result != null ? String(o.result) : undefined,
    }
  })
}

export function mapProject(raw: RawProject): Project {
  return {
    id: raw.id,
    name: raw.name,
    localPath: raw.local_path,
    language: raw.language ?? '—',
    framework: raw.framework ?? '—',
    gitRemote: raw.git_remote ?? undefined,
    gitBranch: raw.git_branch ?? 'main',
    ciStatus: asCiStatus(raw.ci_status),
    openedAt: raw.opened_at ?? raw.created_at,
    createdAt: raw.created_at,
    lastChatSummary: raw.last_summary ?? '尚无聊天记录。',
    kind: 'local',
  }
}

export function mapSession(raw: RawSession, messages: ChatMessage[] = []): Session {
  return {
    id: raw.id,
    projectId: raw.project_id,
    title: raw.title ?? '新会话',
    mode: asAgentMode(raw.mode),
    status: raw.status as Session['status'],
    updatedAt: raw.updated_at,
    tokenCount: Number(raw.token_count),
    messages,
  }
}

export function mapChatMessage(raw: RawChatMessage): ChatMessage {
  return {
    id: raw.id,
    role: raw.role as ChatMessage['role'],
    content: raw.content,
    createdAt: raw.created_at,
    mode: raw.mode ? asAgentMode(raw.mode) : undefined,
    activitySteps: parseActivitySteps(raw.tool_calls),
    toolCalls: parseToolCalls(raw.tool_calls),
    diffs: parseDiffsFromRaw(raw.diffs),
    fileRefs: Array.isArray(raw.file_refs)
      ? (raw.file_refs as string[])
      : undefined,
  }
}

export function fileEntryToNode(entry: RawFileEntry, projectRoot: string): FileNode {
  const rel = toRelativePath(entry.path, projectRoot)
  const nodeType = entry.type === 'dir' ? 'dir' : 'file'
  const children = entry.children?.map((c) => fileEntryToNode(c, projectRoot))
  return {
    name: entry.name,
    path: rel,
    type: nodeType,
    children: nodeType === 'dir' ? (children?.length ? children : undefined) : undefined,
  }
}

function toRelativePath(absOrRel: string, projectRoot: string): string {
  const norm = absOrRel.replace(/\\/g, '/')
  const root = projectRoot.replace(/\\/g, '/').replace(/\/$/, '')
  if (norm.startsWith(root + '/')) return norm.slice(root.length + 1)
  if (norm.startsWith(root)) return norm.slice(root.length).replace(/^\//, '') || norm
  return norm
}

export function mapGitFile(raw: RawGitFile): GitFile {
  const status = raw.status as GitFile['status']
  return {
    path: raw.path,
    status: status ?? 'modified',
    staged: raw.staged,
    additions: raw.additions,
    deletions: raw.deletions,
  }
}

export function mapMemory(raw: RawMemory): Memory {
  return {
    id: raw.id,
    projectId: raw.project_id,
    type: raw.type as Memory['type'],
    content: raw.content,
    summary: raw.summary ?? undefined,
    importance: raw.importance,
    accessCount: raw.access_count,
    version: 1,
    encrypted: raw.encrypted,
    createdAt: raw.created_at,
    lastAccessedAt: raw.last_accessed_at ?? undefined,
  }
}

export function mapNote(raw: RawNote): Note {
  return {
    id: raw.id,
    title: raw.title,
    body: raw.content,
    updatedAt: raw.updated_at,
  }
}
