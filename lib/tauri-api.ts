/**
 * Tauri IPC API layer - bridges frontend components to the Rust backend.
 * All functions call Tauri invoke() behind the scenes.
 * When running in browser (non-Tauri), falls back to mock data.
 */

import type {
  Project,
  Session,
  ChatMessage,
  GrepMatch,
  GitStatus,
  GitDiff,
  GitCommit,
  Memory,
  Note,
  UpdateInfo,
  FileNode,
  ChangeRecord,
  TestRunResult,
  LintResult,
} from './types';
import type {
  KnowledgeBase,
  KnowledgeDocument,
  KnowledgeIndexProgressEvent,
  KnowledgeKind,
} from './knowledge';
import type {
  SelectionLookupSettings,
  SelectionLookupStartEvent,
  SelectionLookupErrorEvent,
  KnowledgeChunkHit,
} from './selection-lookup';

export type { KnowledgeChunkHit };
import {
  mapProject,
  mapSession,
  mapChatMessage,
  mapGitFile,
  mapMemory,
  mapNote,
  mapKnowledgeBase,
  mapKnowledgeDocument,
  fileEntryToNode,
  type RawProject,
  type RawSession,
  type RawChatMessage,
  type RawFileEntry,
  type RawGitStatus,
  type RawMemory,
  type RawNote,
  type RawKnowledgeBase,
  type RawKnowledgeDocument,
} from './ipc-mapper';

// ── Helpers ──

let tauriAvailable = false;
try {
  tauriAvailable = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
} catch {
  tauriAvailable = false;
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!tauriAvailable) {
    console.warn(`[tauri-api] Tauri not available, invoke('${cmd}') would fail. Use mock data.`);
    throw new Error('TAURI_NOT_AVAILABLE');
  }
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
  return tauriInvoke<T>(cmd, args);
}

export function isTauri(): boolean {
  return tauriAvailable;
}

// ── Native Dialogs ──

export async function pickFolder(): Promise<string | null> {
  if (!tauriAvailable) return null;
  const { open } = await import('@tauri-apps/plugin-dialog');
  const selected = await open({
    directory: true,
    multiple: false,
    title: '选择工作文件夹',
  });
  return selected ?? null;
}

export async function ensureAssistantWorkspace(): Promise<string | null> {
  if (!tauriAvailable) return null;
  try {
    return await invoke<string>('ensure_assistant_workspace');
  } catch {
    return null;
  }
}

// ── Projects ──

export async function listProjects(): Promise<Project[]> {
  const raw = await invoke<RawProject[]>('list_projects');
  return raw.map(mapProject);
}

export async function createProject(input: {
  name: string;
  local_path: string;
  language?: string;
  framework?: string;
}): Promise<Project> {
  const raw = await invoke<RawProject>('create_project', { input });
  return mapProject(raw);
}

export async function removeProject(id: string): Promise<void> {
  return invoke<void>('remove_project', { id });
}

export async function openProject(id: string): Promise<Project> {
  const raw = await invoke<RawProject>('open_project', { id });
  return mapProject(raw);
}

// ── Sessions ──

export async function listSessions(projectId: string): Promise<Session[]> {
  const raw = await invoke<RawSession[]>('list_sessions', { projectId });
  return raw.map((s) => mapSession(s));
}

export async function createSession(input: {
  project_id: string;
  title?: string;
  mode?: string;
}): Promise<Session> {
  const raw = await invoke<RawSession>('create_session', { input });
  return mapSession(raw);
}

export async function deleteSession(id: string): Promise<void> {
  return invoke<void>('delete_session', { id });
}

export async function cancelChat(sessionId: string): Promise<void> {
  return invoke<void>('cancel_chat', { sessionId });
}

export async function updateSessionTitle(id: string, title: string): Promise<void> {
  return invoke<void>('update_session_title', { id, title });
}

// ── Messages ──

export async function listMessages(sessionId: string): Promise<ChatMessage[]> {
  const raw = await invoke<RawChatMessage[]>('list_messages', { sessionId });
  return raw.map(mapChatMessage);
}

export async function sendMessage(input: {
  session_id: string;
  content: string;
  mode?: string;
}): Promise<ChatMessage> {
  const raw = await invoke<RawChatMessage>('send_message', { input });
  return mapChatMessage(raw);
}

export async function saveAssistantMessage(
  sessionId: string,
  content: string,
  mode?: string
): Promise<ChatMessage> {
  const raw = await invoke<RawChatMessage>('save_assistant_message', { sessionId, content, mode });
  return mapChatMessage(raw);
}

/** Periodic snapshot during streaming — upserts so partial content survives crashes. */
export async function saveStreamingSnapshot(
  messageId: string,
  sessionId: string,
  content: string,
  mode?: string,
): Promise<void> {
  await invoke('save_streaming_snapshot', { id: messageId, sessionId, content, mode });
}

// ── File System ──

export async function listDirectoryTree(
  projectId: string,
  projectRoot: string,
  path?: string
): Promise<FileNode[]> {
  const raw = await invoke<RawFileEntry[]>('list_directory', { projectId, path });
  return raw.map((e) => fileEntryToNode(e, projectRoot));
}

export async function readFile(
  projectId: string,
  input: { path: string; offset?: number; limit?: number }
): Promise<string> {
  return invoke<string>('read_file', { projectId, input });
}

export async function writeFile(
  projectId: string,
  path: string,
  content: string
): Promise<string> {
  return invoke<string>('write_file', { projectId, path, content });
}

export async function grepSearch(
  projectId: string,
  input: { pattern: string; path?: string; glob?: string; head_limit?: number }
): Promise<GrepMatch[]> {
  return invoke<GrepMatch[]>('grep_search', { projectId, input });
}

// ── Git ──

export async function gitStatus(projectId: string): Promise<GitStatus> {
  const raw = await invoke<RawGitStatus>('git_status', { projectId });
  return {
    branch: raw.branch,
    ahead: raw.ahead,
    behind: raw.behind,
    files: raw.files.map(mapGitFile),
  };
}

export async function gitDiff(
  projectId: string,
  staged?: boolean,
  path?: string
): Promise<GitDiff> {
  return invoke<GitDiff>('git_diff', { projectId, staged, path });
}

export async function gitLog(projectId: string, count?: number): Promise<GitCommit[]> {
  return invoke<GitCommit[]>('git_log', { projectId, count });
}

/** Commit. Omit `files` to stage all then commit (AI). Pass `[]` to commit staged index only (UI). */
export async function gitCommit(
  projectId: string,
  message: string,
  files?: string[]
): Promise<string> {
  return invoke<string>('git_commit', { projectId, message, files });
}

export async function gitBranches(projectId: string): Promise<string[]> {
  return invoke<string[]>('git_branches', { projectId });
}

export async function gitCheckoutBranch(projectId: string, branch: string): Promise<void> {
  return invoke('git_checkout_branch', { projectId, branch });
}

export async function gitCreateBranch(projectId: string, branch: string): Promise<void> {
  return invoke('git_create_branch', { projectId, branch });
}

export async function gitStageFiles(projectId: string, paths: string[]): Promise<void> {
  return invoke('git_stage_files', { projectId, paths });
}

export async function gitUnstageFiles(projectId: string, paths: string[]): Promise<void> {
  return invoke('git_unstage_files', { projectId, paths });
}

export async function gitStashPush(
  projectId: string,
  options?: { includeUntracked?: boolean; message?: string },
): Promise<string> {
  return invoke<string>('git_stash_push', {
    projectId,
    includeUntracked: options?.includeUntracked,
    message: options?.message,
  });
}

export async function gitStashPop(projectId: string): Promise<void> {
  return invoke('git_stash_pop', { projectId });
}

export async function gitStashList(
  projectId: string,
): Promise<Array<{ index: number; message: string }>> {
  return invoke('git_stash_list', { projectId });
}

export async function revealInExplorer(projectId: string, path: string): Promise<void> {
  return invoke('reveal_in_explorer', { projectId, path });
}

// ── Memories ──

export async function listMemories(projectId: string): Promise<Memory[]> {
  const raw = await invoke<RawMemory[]>('list_memories', { projectId });
  return raw.map(mapMemory);
}

export async function saveMemory(
  projectId: string,
  type: string,
  content: string,
  importance?: number,
  sourceSessionId?: string
): Promise<Memory> {
  const raw = await invoke<RawMemory>('save_memory', {
    projectId,
    type,
    content,
    importance,
    sourceSessionId,
  });
  return mapMemory(raw);
}

export async function deleteMemory(id: string): Promise<void> {
  return invoke<void>('delete_memory', { id });
}

// ── Memory Links ──

export interface MemoryLink {
  id: string;
  source_id: string;
  target_id: string;
  link_type: string;
  created_at: string;
}

export async function listMemoryLinks(memoryId: string): Promise<MemoryLink[]> {
  return invoke<MemoryLink[]>('list_memory_links', { memoryId });
}

export async function createMemoryLink(
  sourceId: string,
  targetId: string,
  linkType: string
): Promise<void> {
  return invoke<void>('create_memory_link', { sourceId, targetId, linkType });
}

export async function deleteMemoryLink(linkId: string): Promise<void> {
  return invoke<void>('delete_memory_link', { linkId });
}

// ── Notes ──

export async function listNotes(projectId: string): Promise<Note[]> {
  const raw = await invoke<RawNote[]>('list_notes', { projectId });
  return raw.map(mapNote);
}

export async function saveNote(
  projectId: string,
  title: string,
  content: string
): Promise<Note> {
  const raw = await invoke<RawNote>('save_note', { projectId, title, content });
  return mapNote(raw);
}

// ── Skills / Settings / Update ──

export interface BackendSkill {
  name: string;
  description: string;
  command?: string | null;
  version?: string | null;
  enabled?: boolean | null;
}

export async function listSkills(): Promise<BackendSkill[]> {
  return invoke<BackendSkill[]>('list_skills');
}

export async function uninstallSkill(skillName: string): Promise<void> {
  return invoke<void>('uninstall_skill', { skillName });
}

export async function enableSkill(skillName: string): Promise<void> {
  return invoke<void>('enable_skill', { skillName });
}

export async function disableSkill(skillName: string): Promise<void> {
  return invoke<void>('disable_skill', { skillName });
}

export async function generatePrDraft(projectId: string, baseBranch?: string): Promise<PrDraftOutput> {
  return invoke<PrDraftOutput>('generate_pr_draft', { projectId, baseBranch });
}

export interface PrDraftOutput {
  title: string;
  description: string;
  branch?: string | null;
  baseBranch?: string | null;
  fileCount: number;
  commitCount: number;
}

export async function confirmGitPush(callbackId: string): Promise<string> {
  return invoke<string>('confirm_git_push', { callbackId });
}

export async function cancelGitPush(callbackId: string): Promise<string> {
  return invoke<string>('cancel_git_push', { callbackId });
}

export async function getSetting(key: string): Promise<string | null> {
  return invoke<string | null>('get_setting', { key });
}

export async function setSetting(key: string, value: string): Promise<void> {
  return invoke<void>('set_setting', { key, value });
}

export async function getUpdateInfo(): Promise<UpdateInfo> {
  const raw = await invoke<{
    current_version: string;
    latest_version?: string | null;
    download_url?: string | null;
    size_bytes?: number | null;
    changelog?: string | null;
  }>('get_update_info');
  return {
    currentVersion: raw.current_version,
    latestVersion: raw.latest_version ?? undefined,
    downloadUrl: raw.download_url ?? undefined,
    sizeBytes: raw.size_bytes ?? undefined,
    changelog: raw.changelog ?? undefined,
  };
}

// ── System / Database ──

export interface VectorIndexMeta {
  id: string;
  projectId?: string | null;
  dimension: number;
  entryCount: number;
  backend: string;
  lastRebuildAt?: string | null;
  status: string;
}

export async function getVectorIndexMeta(): Promise<VectorIndexMeta[]> {
  return invoke<VectorIndexMeta[]>('get_vector_index_meta');
}

// ── AI Chat ──

export interface AiChatRequest {
  provider: string;
  model: string;
  messages: { role: string; content: string }[];
  tools?: { name: string; description: string; parameters: unknown }[];
  temperature?: number;
  max_tokens?: number;
  api_key?: string;
  base_url?: string;
  skip_tls_verify?: boolean;
  system?: string;
}

export interface AiLoopRequest {
  provider: string;
  model: string;
  messages: { role: string; content: string }[];
  system_prompt?: string;
  api_key?: string;
  base_url?: string;
  skip_tls_verify?: boolean;
  max_iterations?: number;
  assistant_mode?: boolean;
  edit_dry_run?: boolean;
  bulk_write_confirmed?: boolean;
  agent_mode?: string;
  enabled_kbase_ids?: string[];
}

export interface ChatTokenEvent {
  session_id: string;
  message_id: string;
  delta: string;
}

export async function streamChat(
  request: AiChatRequest,
  sessionId: string,
  messageId: string,
): Promise<ChatMessage> {
  const raw = await invoke<RawChatMessage>('stream_chat', { request, sessionId, messageId });
  return mapChatMessage(raw);
}

/** Full AI Loop with tool execution (edit / auto modes). */
export async function aiLoopChat(
  input: AiLoopRequest,
  sessionId: string,
  projectId: string,
  messageId: string,
): Promise<ChatMessage> {
  const raw = await invoke<RawChatMessage>('ai_loop_chat', {
    input,
    sessionId,
    projectId,
    messageId,
  });
  return mapChatMessage(raw);
}

export async function continueAiLoop(
  sessionId: string,
  messageId: string,
  answers: Array<{
    question_id: string;
    selected_option_ids: string[];
    other_text?: string;
  }>,
): Promise<ChatMessage> {
  const raw = await invoke<RawChatMessage>('continue_ai_loop', {
    sessionId,
    messageId,
    answers,
  });
  return mapChatMessage(raw);
}

export async function listModels(
  provider: string,
  baseUrl?: string
): Promise<string[]> {
  return invoke<string[]>('list_models', { provider, baseUrl });
}

/**
 * Subscribe to a Tauri event. `listen` resolves asynchronously, so if the
 * caller unsubscribes before it resolves, the listener must still be removed
 * once registered — otherwise it leaks and duplicates callbacks.
 */
function subscribeTauriEvent<T>(eventName: string, callback: (payload: T) => void): () => void {
  if (!isTauri()) return () => {};

  const { listen } = require('@tauri-apps/api/event');
  let unlisten: (() => void) | null = null;
  let disposed = false;

  listen(eventName, (event: { payload: T }) => {
    if (disposed) return;
    callback(event.payload);
  }).then((fn: () => void) => {
    if (disposed) fn();
    else unlisten = fn;
  });

  return () => {
    disposed = true;
    if (unlisten) unlisten();
  };
}

export function onChatToken(callback: (event: ChatTokenEvent) => void): () => void {
  return subscribeTauriEvent('chat-token', callback);
}

export interface ChatToolDeltaEvent {
  session_id: string;
  message_id: string;
  index: number;
  name: string;
  arguments_delta: string;
}

export function onChatToolDelta(callback: (event: ChatToolDeltaEvent) => void): () => void {
  return subscribeTauriEvent('chat-tool-delta', callback);
}

export interface ChatStreamResetEvent {
  session_id: string;
  message_id: string;
}

/** Emitted before a stream retry: partial content from the failed attempt must be discarded. */
export function onChatStreamReset(callback: (event: ChatStreamResetEvent) => void): () => void {
  return subscribeTauriEvent('chat-stream-reset', callback);
}

// ── Code editor / changes ──

export async function editFile(
  projectId: string,
  path: string,
  oldString: string,
  newString: string,
  replaceAll?: boolean,
  dryRun?: boolean,
): Promise<{ path: string; replaced: number; diff: string; dry_run: boolean }> {
  return invoke('edit_file', {
    projectId,
    path,
    oldString,
    newString,
    replaceAll,
    dryRun,
  });
}

export async function rollbackEdit(
  projectId: string,
  backupHash: string,
  path: string,
): Promise<string> {
  return invoke<string>('rollback_edit', { projectId, backupHash, path });
}

export async function revertChange(
  projectId: string,
  changeId: string,
): Promise<{ verified_hash: string }> {
  return invoke('revert_change', { projectId, changeId });
}

export async function gitCloneRepo(
  parentDir: string,
  url: string,
  name?: string,
): Promise<string> {
  return invoke<string>('git_clone_repo', { parentDir, url, name });
}

export interface SystemHealth {
  mode: 'full' | 'degraded' | 'offline';
  subsystems: Array<{ name: string; healthy: boolean; message?: string }>;
}

export async function healthCheck(): Promise<SystemHealth> {
  return invoke<SystemHealth>('health_check', {});
}

export async function listChanges(sessionId: string): Promise<ChangeRecord[]> {
  const raw = await invoke<Array<{
    id: string;
    session_id: string;
    message_id?: string;
    file_path: string;
    diff_text: string;
    status: string;
    snapshot_id?: string;
    edit_meta?: string;
    created_at: string;
    applied_at?: string;
  }>>('list_changes', { sessionId });
  return raw.map((r) => ({
    id: r.id,
    sessionId: r.session_id,
    messageId: r.message_id,
    filePath: r.file_path,
    diffText: r.diff_text,
    status: r.status,
    snapshotId: r.snapshot_id,
    editMeta: r.edit_meta,
    createdAt: r.created_at,
    appliedAt: r.applied_at,
  }));
}

export async function applyChange(
  projectId: string,
  input: {
    change_id: string;
    path: string;
    old_string: string;
    new_string: string;
    replace_all?: boolean;
    kind?: "edit" | "write";
  },
): Promise<{ path: string; diff: string }> {
  return invoke('apply_change', { projectId, input });
}

export async function rejectChange(changeId: string): Promise<void> {
  return invoke('reject_change', { changeId });
}

// ── Credentials (OS Keychain) ──

export async function saveCredential(key: string, value: string): Promise<void> {
  return invoke('save_credential', { key, value });
}

export async function getCredential(key: string): Promise<string | null> {
  const val = await invoke<string | null>('get_credential', { key });
  return val ?? null;
}

export async function deleteCredential(key: string): Promise<void> {
  return invoke('delete_credential', { key });
}

// ── Test & Lint ──

export async function runTests(projectId: string, filter?: string): Promise<TestRunResult> {
  const raw = await invoke<{
    command: string;
    exit_code: number;
    stdout: string;
    stderr: string;
    passed: boolean;
  }>('run_tests', { projectId, filter });
  return {
    command: raw.command,
    exitCode: raw.exit_code,
    stdout: raw.stdout,
    stderr: raw.stderr,
    passed: raw.passed,
  };
}

export async function runLinter(projectId: string, target?: string): Promise<LintResult> {
  const raw = await invoke<{
    command: string;
    exit_code: number;
    issues: LintResult['issues'];
    raw_output: string;
  }>('run_linter', { projectId, target });
  return {
    command: raw.command,
    exitCode: raw.exit_code,
    issues: raw.issues,
    rawOutput: raw.raw_output,
  };
}

// ── Recovery ──

export async function saveRecoverySnapshot(snapshot: {
  session_id: string;
  project_id?: string;
  draft_content: string;
  messages_json: string;
  saved_at: string;
}): Promise<void> {
  return invoke('save_recovery_snapshot', { snapshot });
}

export async function loadRecoverySnapshots(): Promise<Array<{
  sessionId: string;
  projectId?: string;
  draftContent: string;
  messagesJson: string;
  savedAt: string;
}>> {
  const raw = await invoke<Array<{
    session_id: string;
    project_id?: string;
    draft_content: string;
    messages_json: string;
    saved_at: string;
  }>>('load_recovery_snapshots');
  return raw.map((s) => ({
    sessionId: s.session_id,
    projectId: s.project_id,
    draftContent: s.draft_content,
    messagesJson: s.messages_json,
    savedAt: s.saved_at,
  }));
}

export async function clearRecoverySnapshot(sessionId: string): Promise<void> {
  return invoke('clear_recovery_snapshot', { sessionId });
}

export async function clearAllRecoverySnapshots(): Promise<void> {
  return invoke('clear_all_recovery_snapshots');
}

export async function watchProjectDir(projectId: string): Promise<void> {
  return invoke('watch_project_dir', { projectId });
}

export async function sandboxExec(
  projectId: string,
  command: string,
  options?: { cwd?: string; allowNetwork?: boolean; dryRun?: boolean },
): Promise<{ exitCode: number; stdout: string; stderr: string; blocked: boolean }> {
  const raw = await invoke<{
    exit_code: number;
    stdout: string;
    stderr: string;
    blocked: boolean;
  }>('sandbox_exec', {
    projectId,
    command,
    cwd: options?.cwd,
    allowNetwork: options?.allowNetwork,
    dryRun: options?.dryRun,
  });
  return {
    exitCode: raw.exit_code,
    stdout: raw.stdout,
    stderr: raw.stderr,
    blocked: raw.blocked,
  };
}

export async function compressMemories(projectId?: string): Promise<number> {
  return invoke<number>('compress_memories', { projectId });
}

export async function searchMemories(projectId: string, query: string, limit?: number): Promise<Memory[]> {
  const raw = await invoke<RawMemory[]>('search_memories', { projectId, query, limit });
  return raw.map(mapMemory);
}

export async function retrieveMemories(
  projectId: string,
  query: string,
  topK?: number,
): Promise<{ memories: Memory[]; context: string }> {
  const raw = await invoke<{ memories: RawMemory[]; context: string }>('retrieve_memories', {
    projectId,
    query,
    topK,
  });
  return { memories: raw.memories.map(mapMemory), context: raw.context };
}

export async function updateMemory(
  id: string,
  patch: { content?: string; summary?: string; importance?: number; memoryType?: string },
): Promise<Memory> {
  const raw = await invoke<RawMemory>('update_memory', {
    id,
    content: patch.content,
    summary: patch.summary,
    importance: patch.importance,
    memoryType: patch.memoryType,
  });
  return mapMemory(raw);
}

export async function exportMemories(projectId: string): Promise<string> {
  return invoke<string>('export_memories', { projectId });
}

export async function rebuildVectorIndex(projectId?: string): Promise<{ entry_count: number; status: string }> {
  return invoke('rebuild_vector_index', { projectId });
}

export async function checkDatabase(): Promise<{ integrity_ok: boolean; vector_corrupted: boolean; vector_entries: number }> {
  return invoke('check_database');
}

export async function repairDatabase(): Promise<{ integrity_ok: boolean; vector_entries: number; repaired: boolean }> {
  return invoke('repair_database');
}

export async function checkDiskSpace(): Promise<{ available_mb: number; warning: boolean; message: string }> {
  return invoke('check_disk_space');
}

export interface AuditEntry {
  id: string;
  sessionId: string;
  messageId?: string;
  command: string;
  cwd: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  sandboxed: boolean;
  createdAt: string;
}

export async function getAuditLog(sessionId: string, limit?: number): Promise<AuditEntry[]> {
  const raw = await invoke<Array<{
    id: string;
    session_id: string;
    message_id?: string;
    command: string;
    cwd: string;
    exit_code: number;
    stdout: string;
    stderr: string;
    duration_ms: number;
    sandboxed: boolean;
    created_at: string;
  }>>('get_audit_log', { sessionId, limit });
  return raw.map((r) => ({
    id: r.id,
    sessionId: r.session_id,
    messageId: r.message_id,
    command: r.command,
    cwd: r.cwd,
    exitCode: r.exit_code,
    stdout: r.stdout,
    stderr: r.stderr,
    durationMs: r.duration_ms,
    sandboxed: r.sandboxed,
    createdAt: r.created_at,
  }));
}

export interface ToolCallEvent {
  session_id: string;
  message_id: string;
  call_id?: string;
  tool: string;
  args?: unknown;
  success?: boolean;
  result?: string;
}

export interface RawActivityStep {
  id: string;
  kind: string;
  round: number;
  label: string;
  detail?: string;
  tool?: string;
  args?: string;
  status: string;
  result?: string;
  started_at?: string;
  finished_at?: string;
}

export interface LoopActivityEvent {
  session_id: string;
  message_id: string;
  step: RawActivityStep;
}

export interface LoopCompletedEvent {
  session_id: string;
  message_id: string;
}

export function mapActivityStep(raw: RawActivityStep): import('./types').ActivityStep {
  return {
    id: raw.id,
    kind: raw.kind === 'thought' ? 'thought' : 'tool',
    round: raw.round,
    label: raw.label,
    detail: raw.detail,
    tool: raw.tool,
    args: raw.args,
    status: raw.status === 'running' || raw.status === 'error' ? raw.status : 'success',
    result: raw.result,
    startedAt: raw.started_at,
    finishedAt: raw.finished_at,
  };
}

export function onLoopActivity(callback: (event: LoopActivityEvent) => void): () => void {
  if (!isTauri()) return () => {};
  const { listen } = require('@tauri-apps/api/event');
  let unlisten: (() => void) | null = null;
  let disposed = false;
  listen('loop-activity', (event: { payload: LoopActivityEvent }) => {
    if (disposed) return;
    callback(event.payload);
  }).then((fn: () => void) => {
    if (disposed) fn();
    else unlisten = fn;
  });
  return () => {
    disposed = true;
    if (unlisten) unlisten();
  };
}

export function onLoopCompleted(callback: (event: LoopCompletedEvent) => void): () => void {
  if (!isTauri()) return () => {};
  const { listen } = require('@tauri-apps/api/event');
  let unlisten: (() => void) | null = null;
  let disposed = false;
  listen('loop-completed', (event: { payload: LoopCompletedEvent }) => {
    if (disposed) return;
    callback(event.payload);
  }).then((fn: () => void) => {
    if (disposed) fn();
    else unlisten = fn;
  });
  return () => {
    disposed = true;
    if (unlisten) unlisten();
  };
}

export function onToolCallStart(callback: (event: ToolCallEvent) => void): () => void {
  if (!isTauri()) return () => {};
  const { listen } = require('@tauri-apps/api/event');
  let unlisten: (() => void) | null = null;
  let disposed = false;
  listen('tool-call-start', (event: { payload: ToolCallEvent }) => {
    if (disposed) return;
    callback(event.payload);
  }).then((fn: () => void) => {
    if (disposed) fn();
    else unlisten = fn;
  });
  return () => {
    disposed = true;
    if (unlisten) unlisten();
  };
}

export function onToolCallEnd(callback: (event: ToolCallEvent) => void): () => void {
  if (!isTauri()) return () => {};
  const { listen } = require('@tauri-apps/api/event');
  let unlisten: (() => void) | null = null;
  let disposed = false;
  listen('tool-call-end', (event: { payload: ToolCallEvent }) => {
    if (disposed) return;
    callback(event.payload);
  }).then((fn: () => void) => {
    if (disposed) fn();
    else unlisten = fn;
  });
  return () => {
    disposed = true;
    if (unlisten) unlisten();
  };
}

export async function listSshConnections(): Promise<Array<{ host: string; user: string; port: number; last_connected_at?: string }>> {
  return invoke('list_ssh_connections');
}

export async function saveSshConnection(host: string, user: string, port?: number): Promise<void> {
  return invoke('save_ssh_connection', { host, user, port });
}

export async function exportBackup(outputPath: string): Promise<void> {
  return invoke('export_backup', { outputPath });
}

export async function importBackup(inputPath: string): Promise<Record<string, number>> {
  return invoke('import_backup', { inputPath });
}

// ── Knowledge Base ──

export async function listKnowledgeBases(): Promise<KnowledgeBase[]> {
  const raw = await invoke<RawKnowledgeBase[]>('list_knowledge_bases');
  return raw.map(mapKnowledgeBase);
}

export async function createKnowledgeBase(input: {
  name: string;
  description?: string;
}): Promise<KnowledgeBase> {
  const raw = await invoke<RawKnowledgeBase>('create_knowledge_base', { input });
  return mapKnowledgeBase(raw);
}

export async function updateKnowledgeBase(input: {
  id: string;
  name?: string;
  description?: string;
}): Promise<KnowledgeBase> {
  const raw = await invoke<RawKnowledgeBase>('update_knowledge_base', { input });
  return mapKnowledgeBase(raw);
}

export async function deleteKnowledgeBase(id: string): Promise<void> {
  return invoke('delete_knowledge_base', { id });
}

export async function listKnowledgeDocuments(kbaseId: string): Promise<KnowledgeDocument[]> {
  const raw = await invoke<RawKnowledgeDocument[]>('list_knowledge_documents', { kbaseId });
  return raw.map(mapKnowledgeDocument);
}

export async function ingestKnowledgeDocument(input: {
  kbaseId: string;
  name: string;
  kind: KnowledgeKind;
  dataBase64: string;
}): Promise<KnowledgeDocument> {
  const raw = await invoke<RawKnowledgeDocument>('ingest_knowledge_document', {
    input: {
      kbase_id: input.kbaseId,
      name: input.name,
      kind: input.kind,
      data_base64: input.dataBase64,
    },
  });
  return mapKnowledgeDocument(raw);
}

export async function ingestKnowledgeDocumentFromPaths(input: {
  kbaseId: string;
  paths: string[];
}): Promise<KnowledgeDocument[]> {
  const raw = await invoke<RawKnowledgeDocument[]>('ingest_knowledge_document_from_paths', {
    input: {
      kbase_id: input.kbaseId,
      paths: input.paths,
    },
  });
  return raw.map(mapKnowledgeDocument);
}

export async function deleteKnowledgeDocument(documentId: string): Promise<void> {
  return invoke('delete_knowledge_document', { documentId });
}

export async function retrieveKnowledgeContext(
  kbaseIds: string[],
  query: string,
  topK?: number,
): Promise<{ context: string; chunks: KnowledgeChunkHit[] }> {
  const raw = await invoke<{
    context: string
    chunks: Array<{
      id: string
      document_id: string
      kbase_id: string
      chunk_index: number
      content: string
      kbase_name: string
      document_name: string
      score: number
    }>
  }>('retrieve_knowledge_context', {
    input: {
      kbase_ids: kbaseIds,
      query,
      top_k: topK,
    },
  });
  return {
    context: raw.context,
    chunks: (raw.chunks ?? []).map((c) => ({
      id: c.id,
      documentId: c.document_id,
      kbaseId: c.kbase_id,
      chunkIndex: c.chunk_index,
      content: c.content,
      kbaseName: c.kbase_name,
      documentName: c.document_name,
      score: c.score,
    })),
  };
}

export async function selectionLookupApplySettings(
  settings: SelectionLookupSettings,
): Promise<void> {
  return invoke('selection_lookup_apply_settings', { settings });
}

export async function hideSelectionPopup(): Promise<void> {
  return invoke('hide_selection_popup');
}

export async function continueSelectionInAssistant(
  text: string,
  kbaseId?: string | null,
): Promise<void> {
  return invoke('continue_selection_in_assistant', { text, kbaseId: kbaseId ?? null });
}

export async function getSelectionLookupSettings(): Promise<SelectionLookupSettings> {
  return invoke('get_selection_lookup_settings');
}

export function onSelectionLookupStart(
  callback: (event: SelectionLookupStartEvent) => void,
): () => void {
  if (!isTauri()) return () => {};
  const { listen } = require('@tauri-apps/api/event');
  let unlisten: (() => void) | null = null;
  listen('selection-lookup:start', (event: { payload: Record<string, unknown> }) => {
    const p = event.payload;
    callback({
      text: String(p.text ?? ''),
      kbaseId: String(p.kbaseId ?? p.kbase_id ?? ''),
      kbaseName: String(p.kbaseName ?? p.kbase_name ?? '知识库'),
      source: String(p.source ?? ''),
    });
  }).then((fn: () => void) => {
    unlisten = fn;
  });
  return () => { if (unlisten) unlisten(); };
}

export function onSelectionLookupError(
  callback: (event: SelectionLookupErrorEvent) => void,
): () => void {
  if (!isTauri()) return () => {};
  const { listen } = require('@tauri-apps/api/event');
  let unlisten: (() => void) | null = null;
  listen('selection-lookup:error', (event: { payload: SelectionLookupErrorEvent }) => {
    callback(event.payload);
  }).then((fn: () => void) => {
    unlisten = fn;
  });
  return () => { if (unlisten) unlisten(); };
}

export function onAssistantPrefillQuery(
  callback: (payload: { text: string; kbaseId?: string | null }) => void,
): () => void {
  if (!isTauri()) return () => {};
  const { listen } = require('@tauri-apps/api/event');
  let unlisten: (() => void) | null = null;
  listen('assistant-prefill-query', (event: { payload: { text: string; kbaseId?: string | null } }) => {
    callback(event.payload);
  }).then((fn: () => void) => {
    unlisten = fn;
  });
  return () => { if (unlisten) unlisten(); };
}

export function onKnowledgeIndexProgress(
  callback: (event: KnowledgeIndexProgressEvent) => void,
): () => void {
  if (!isTauri()) return () => {};
  const { listen } = require('@tauri-apps/api/event');
  let unlisten: (() => void) | null = null;
  listen('knowledge-index-progress', (event: {
    payload: {
      document_id: string;
      kbase_id: string;
      status: string;
      chunk_count: number;
      error?: string;
    };
  }) => {
    const p = event.payload;
    callback({
      documentId: p.document_id,
      kbaseId: p.kbase_id,
      status: p.status as KnowledgeIndexProgressEvent['status'],
      chunkCount: p.chunk_count,
      error: p.error,
    });
  }).then((fn: () => void) => {
    unlisten = fn;
  });
  return () => { if (unlisten) unlisten(); };
}
