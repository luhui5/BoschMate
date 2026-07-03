export type AgentMode = "ask" | "plan" | "edit" | "auto"

export type RunMode = "full" | "degraded" | "offline"

export type CIStatus = "passing" | "failing" | "running" | "none"

export interface Project {
  id: string
  name: string
  localPath: string
  language: string
  framework: string
  gitRemote?: string
  gitBranch: string
  ciStatus: CIStatus
  openedAt: string // ISO
  createdAt: string
  lastChatSummary: string
  pinned?: boolean
  kind: "local" | "ssh"
  sshHost?: string
}

export type MessageRole = "user" | "assistant" | "system" | "tool"

export interface ToolCall {
  tool: string
  args: string
  status: "running" | "success" | "error"
  result?: string
}

export interface DiffHunk {
  filePath: string
  additions: number
  deletions: number
  language: string
  lines: DiffLine[]
  status: "pending" | "applied" | "rejected" | "reverted"
  changeId?: string
  editMeta?: {
    path?: string
    old_string?: string
    new_string?: string
    replace_all?: boolean
  }
}

export interface DiffLine {
  type: "add" | "del" | "context" | "meta"
  text: string
  oldNo?: number
  newNo?: number
}

export interface ChatMessage {
  id: string
  role: MessageRole
  content: string
  createdAt: string
  mode?: AgentMode
  toolCalls?: ToolCall[]
  diffs?: DiffHunk[]
  fileRefs?: string[]
  streaming?: boolean
}

export interface Session {
  id: string
  projectId: string
  title: string
  mode: AgentMode
  status: "active" | "archived" | "merged"
  pinned?: boolean
  updatedAt: string
  tokenCount: number
  messages: ChatMessage[]
}

export interface FileNode {
  name: string
  path: string
  type: "file" | "dir"
  changed?: "modified" | "added" | "deleted"
  children?: FileNode[]
}

export interface GitFile {
  path: string
  status: "modified" | "added" | "deleted" | "renamed" | "untracked"
  staged: boolean
  additions: number
  deletions: number
}

export interface GitStatus {
  branch: string
  files: GitFile[]
  ahead: number
  behind: number
}

export type MemoryType = "fact" | "interaction" | "behavior" | "plan"

export interface Memory {
  id: string
  projectId: string
  type: MemoryType
  content: string
  summary?: string
  importance: number // 0-1
  accessCount: number
  version: number
  encrypted: boolean
  createdAt: string
  lastAccessedAt?: string
}

export interface Note {
  id: string
  title: string
  body: string
  updatedAt: string
}

export interface Skill {
  id: string
  name: string
  description: string
  version: string
  source: "builtin" | "registry" | "local"
  permissions: string[]
  enabled: boolean
}

export interface GrepMatch {
  file: string
  line: number
  content: string
}

export interface GitCommit {
  sha: string
  message: string
  author: string
  date: string
}

export interface GitDiff {
  diff: string
  files: string[]
  stats: { added: number; removed: number; changed: number }
}

export interface UpdateInfo {
  currentVersion: string
  latestVersion?: string
  downloadUrl?: string
  sizeBytes?: number
  changelog?: string
}

export interface ChangeRecord {
  id: string
  sessionId: string
  messageId?: string
  filePath: string
  diffText: string
  status: string
  snapshotId?: string
  editMeta?: string
  createdAt: string
  appliedAt?: string
}

export interface TestRunResult {
  command: string
  exitCode: number
  stdout: string
  stderr: string
  passed: boolean
}

export interface LintResult {
  command: string
  exitCode: number
  issues: LintIssue[]
  rawOutput: string
}

export interface LintIssue {
  file: string
  line: number
  column: number
  severity: string
  message: string
  rule?: string
}
