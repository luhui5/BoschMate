/**
 * Tauri IPC API layer - bridges frontend components to the Rust backend.
 * All functions call Tauri invoke() behind the scenes.
 * When running in browser (non-Tauri), falls back to mock data.
 */

import type {
  Project,
  Session,
  ChatMessage,
  FileEntry,
  GrepMatch,
  GitStatus,
  GitDiff,
  GitCommit,
  Memory,
  Note,
  Skill,
  UpdateInfo,
} from './types';

// ── Helpers ──

let tauriAvailable = false;
try {
  // Lazily detect Tauri environment
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

// ── Projects ──

export async function listProjects(): Promise<Project[]> {
  return invoke<Project[]>('list_projects');
}

export async function createProject(input: {
  name: string;
  local_path: string;
  language?: string;
  framework?: string;
}): Promise<Project> {
  return invoke<Project>('create_project', { input });
}

export async function removeProject(id: string): Promise<void> {
  return invoke<void>('remove_project', { id });
}

export async function openProject(id: string): Promise<Project> {
  return invoke<Project>('open_project', { id });
}

// ── Sessions ──

export async function listSessions(projectId: string): Promise<Session[]> {
  return invoke<Session[]>('list_sessions', { projectId });
}

export async function createSession(input: {
  project_id: string;
  title?: string;
  mode?: string;
}): Promise<Session> {
  return invoke<Session>('create_session', { input });
}

export async function deleteSession(id: string): Promise<void> {
  return invoke<void>('delete_session', { id });
}

export async function updateSessionTitle(id: string, title: string): Promise<void> {
  return invoke<void>('update_session_title', { id, title });
}

// ── Messages ──

export async function listMessages(sessionId: string): Promise<ChatMessage[]> {
  return invoke<ChatMessage[]>('list_messages', { sessionId });
}

export async function sendMessage(input: {
  session_id: string;
  content: string;
  mode?: string;
}): Promise<ChatMessage> {
  return invoke<ChatMessage>('send_message', { input });
}

export async function saveAssistantMessage(
  sessionId: string,
  content: string,
  mode?: string
): Promise<ChatMessage> {
  return invoke<ChatMessage>('save_assistant_message', { sessionId, content, mode });
}

// ── File System ──

export async function listDirectory(
  projectId: string,
  path?: string
): Promise<FileEntry[]> {
  return invoke<FileEntry[]>('list_directory', { projectId, path });
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

export async function globSearch(
  projectId: string,
  input: { pattern: string; path?: string }
): Promise<FileEntry[]> {
  return invoke<FileEntry[]>('glob_search', { projectId, input });
}

export async function grepSearch(
  projectId: string,
  input: { pattern: string; path?: string; glob?: string; head_limit?: number }
): Promise<GrepMatch[]> {
  return invoke<GrepMatch[]>('grep_search', { projectId, input });
}

// ── Git ──

export async function gitStatus(projectId: string): Promise<GitStatus> {
  return invoke<GitStatus>('git_status', { projectId });
}

export async function gitDiff(
  projectId: string,
  staged?: boolean,
  path?: string
): Promise<GitDiff> {
  return invoke<GitDiff>('git_diff', { projectId, staged, path });
}

export async function gitLog(
  projectId: string,
  count?: number
): Promise<GitCommit[]> {
  return invoke<GitCommit[]>('git_log', { projectId, count });
}

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

// ── Memories ──

export async function listMemories(projectId: string): Promise<Memory[]> {
  return invoke<Memory[]>('list_memories', { projectId });
}

export async function saveMemory(
  projectId: string,
  type: string,
  content: string,
  importance?: number,
  sourceSessionId?: string
): Promise<Memory> {
  return invoke<Memory>('save_memory', {
    projectId,
    type,
    content,
    importance,
    sourceSessionId,
  });
}

export async function deleteMemory(id: string): Promise<void> {
  return invoke<void>('delete_memory', { id });
}

// ── Notes ──

export async function listNotes(projectId: string): Promise<Note[]> {
  return invoke<Note[]>('list_notes', { projectId });
}

export async function saveNote(
  projectId: string,
  title: string,
  content: string
): Promise<Note> {
  return invoke<Note>('save_note', { projectId, title, content });
}

// ── Skills / Settings / Update ──

export async function listSkills(): Promise<Skill[]> {
  return invoke<Skill[]>('list_skills');
}

export async function getSetting(key: string): Promise<string | null> {
  return invoke<string | null>('get_setting', { key });
}

export async function setSetting(key: string, value: string): Promise<void> {
  return invoke<void>('set_setting', { key, value });
}

export async function getUpdateInfo(): Promise<UpdateInfo> {
  return invoke<UpdateInfo>('get_update_info');
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
  system?: string;
}

export interface ChatTokenEvent {
  session_id: string;
  message_id: string;
  delta: string;
  content: string;
}

export async function streamChat(
  request: AiChatRequest,
  sessionId: string
): Promise<ChatMessage> {
  return invoke<ChatMessage>('stream_chat', { request, sessionId });
}

export async function listModels(
  provider: string,
  baseUrl?: string
): Promise<string[]> {
  return invoke<string[]>('list_models', { provider, baseUrl });
}

/**
 * Listen for streaming chat tokens from the Rust backend.
 * Returns an unsubscribe function.
 */
export function onChatToken(
  callback: (event: ChatTokenEvent) => void
): () => void {
  if (!isTauri()) return () => {};

  const { listen } = require('@tauri-apps/api/event');
  let unlisten: (() => void) | null = null;

  listen('chat-token', (event: { payload: ChatTokenEvent }) => {
    callback(event.payload);
  }).then((fn: () => void) => {
    unlisten = fn;
  });

  return () => {
    if (unlisten) unlisten();
  };
}
