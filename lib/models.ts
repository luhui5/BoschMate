/**
 * Shared model configuration type and persistence helpers.
 * Single source of truth for model configs used by both
 * the settings page and the assistant chat dropdown.
 */

import { getSetting, setSetting, saveCredential, getCredential, deleteCredential } from "@/lib/tauri-api"

// ── Types ──

export type ModelProtocol = "openai" | "anthropic"
/**
 * Maps directly to the Rust backend's ChatRequest.provider field:
 * - "ollama"    → stream_ollama (OpenAI-compatible local)
 * - "openai"    → stream_openai (OpenAI API or compatible)
 * - "anthropic" → stream_anthropic (Anthropic API)
 */
export type ModelProvider = "ollama" | "openai" | "anthropic"

export interface ModelConfig {
  id: string
  name: string
  protocol: ModelProtocol
  provider: ModelProvider
  detail: string
  endpoint: string | null
  apiKey?: string
  contextWindow: number
  temperature: number
}

// ── Defaults ──

export const DEFAULT_MODELS: ModelConfig[] = [
  {
    id: 'ollama-local',
    name: 'qwen2.5-coder',
    protocol: 'openai',
    provider: 'ollama',
    detail: '本地 Ollama 默认模型',
    endpoint: 'http://localhost:11434',
    contextWindow: 32768,
    temperature: 0.2,
  },
]

// ── Persistence ──
// Priority: Tauri IPC (SQLite) → localStorage fallback

const MODELS_KEY = "bc-global-models"
const LAST_MODEL_KEY = "bc-last-model-id"
const MODEL_USAGE_KEY = "bc-model-usage"

function lsGet(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}
function lsSet(key: string, value: string): void {
  try { localStorage.setItem(key, value) } catch { /* quota exceeded, private mode, etc. */ }
}
function lsRemove(key: string): void {
  try { localStorage.removeItem(key) } catch { /* ignore */ }
}

export async function loadModels(): Promise<ModelConfig[]> {
  // 1. Try Tauri backend
  try {
    const raw = await getSetting(MODELS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as ModelConfig[]
      if (Array.isArray(parsed) && parsed.length > 0) return parsed
    }
  } catch { /* Tauri not available, fall through */ }

  // 2. Try localStorage fallback
  try {
    const cached = lsGet(MODELS_KEY)
    if (cached) {
      const parsed = JSON.parse(cached) as ModelConfig[]
      if (Array.isArray(parsed) && parsed.length > 0) return parsed
    }
  } catch { /* corrupted */ }

  // 3. First run — seed with defaults and persist to both stores
  await saveModels(DEFAULT_MODELS)
  return [...DEFAULT_MODELS]
}

export async function saveModels(models: ModelConfig[]): Promise<void> {
  const json = JSON.stringify(models)
  // Always write to localStorage as immediate fallback
  lsSet(MODELS_KEY, json)
  // Also try Tauri backend
  try { await setSetting(MODELS_KEY, json) } catch { /* Tauri not available */ }
}

// ── Last-used & usage stats (for default model selection) ──

async function readSetting(key: string): Promise<string | null> {
  try {
    const val = await getSetting(key)
    if (val) return val
  } catch { /* Tauri not available */ }
  return lsGet(key)
}

async function writeSetting(key: string, value: string): Promise<void> {
  lsSet(key, value)
  try { await setSetting(key, value) } catch { /* Tauri not available */ }
}

export async function loadLastUsedModelId(): Promise<string | null> {
  return readSetting(LAST_MODEL_KEY)
}

export async function saveLastUsedModelId(id: string): Promise<void> {
  await writeSetting(LAST_MODEL_KEY, id)
}

export async function loadModelUsage(): Promise<Record<string, number>> {
  const raw = await readSetting(MODEL_USAGE_KEY)
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as Record<string, number>
    return typeof parsed === "object" && parsed !== null ? parsed : {}
  } catch {
    return {}
  }
}

async function saveModelUsage(usage: Record<string, number>): Promise<void> {
  await writeSetting(MODEL_USAGE_KEY, JSON.stringify(usage))
}

/** Call when a model is successfully used for chat. */
export async function recordModelUsage(id: string): Promise<void> {
  const usage = await loadModelUsage()
  usage[id] = (usage[id] ?? 0) + 1
  await saveModelUsage(usage)
  await saveLastUsedModelId(id)
}

function pickMostUsedModelId(models: ModelConfig[], usage: Record<string, number>): string | null {
  let best: string | null = null
  let max = 0
  for (const m of models) {
    const count = usage[m.id] ?? 0
    if (count > max) {
      max = count
      best = m.id
    }
  }
  return best
}

/** Restore UI after navigation: prefer last manually selected model. */
export async function resolveActiveModelId(models: ModelConfig[]): Promise<string> {
  if (models.length === 0) return ""
  const last = await loadLastUsedModelId()
  if (last && models.some((m) => m.id === last)) return last
  const usage = await loadModelUsage()
  const mostUsed = pickMostUsedModelId(models, usage)
  if (mostUsed) return mostUsed
  return models[0].id
}

/** Default for a brand-new session: prefer most frequently used model. */
export async function resolveDefaultModelForNewSession(models: ModelConfig[]): Promise<string> {
  if (models.length === 0) return ""
  const usage = await loadModelUsage()
  const mostUsed = pickMostUsedModelId(models, usage)
  if (mostUsed) return mostUsed
  const last = await loadLastUsedModelId()
  if (last && models.some((m) => m.id === last)) return last
  return models[0].id
}

// ── API Key storage (separate from models JSON) ──

function apiKeyStorageKey(modelId: string): string {
  return `bc-api-key:${modelId}`
}

export async function loadApiKey(modelId: string): Promise<string | null> {
  const key = `api_key:${modelId}`
  try {
    const val = await getCredential(key)
    if (val) return val
  } catch { /* fall through */ }
  try {
    const val = await getSetting(key)
    if (val) return val
  } catch { /* fall through */ }
  return lsGet(apiKeyStorageKey(modelId))
}

export async function saveApiKey(modelId: string, key: string): Promise<void> {
  const storageKey = `api_key:${modelId}`
  try {
    await saveCredential(storageKey, key)
  } catch {
    lsSet(apiKeyStorageKey(modelId), key)
    try { await setSetting(storageKey, key) } catch { /* Tauri not available */ }
  }
}

export async function deleteApiKey(modelId: string): Promise<void> {
  const storageKey = `api_key:${modelId}`
  lsRemove(apiKeyStorageKey(modelId))
  try { await deleteCredential(storageKey) } catch { /* ignore */ }
  try { await setSetting(storageKey, "") } catch { /* Tauri not available */ }
}

// ── Helpers ──

export function findModel(
  models: ModelConfig[],
  id: string,
): ModelConfig | undefined {
  return models.find((m) => m.id === id)
}
