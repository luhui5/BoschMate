/**
 * Shared model configuration type and persistence helpers.
 * Single source of truth for model configs used by both
 * the settings page and the assistant chat dropdown.
 */

import { getSetting, setSetting } from "@/lib/tauri-api"

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
    id: "local-qwen",
    name: "Qwen2.5-Coder 32B",
    protocol: "openai",
    provider: "ollama",
    detail: "Ollama · 4-bit 量化",
    endpoint: "http://localhost:11434",
    contextWindow: 32768,
    temperature: 0.2,
  },
  {
    id: "local-deepseek",
    name: "DeepSeek-Coder V2 16B",
    protocol: "openai",
    provider: "ollama",
    detail: "llama.cpp",
    endpoint: "http://localhost:8080",
    contextWindow: 32768,
    temperature: 0.3,
  },
  {
    id: "cloud-claude",
    name: "Claude Opus 4.6",
    protocol: "anthropic",
    provider: "anthropic",
    detail: "需 API Key",
    endpoint: "https://api.anthropic.com",
    contextWindow: 131072,
    temperature: 0.5,
  },
  {
    id: "cloud-gpt",
    name: "GPT-5",
    protocol: "openai",
    provider: "openai",
    detail: "需 API Key",
    endpoint: "https://api.openai.com",
    contextWindow: 131072,
    temperature: 0.7,
  },
]

// ── Persistence ──
// Priority: Tauri IPC (SQLite) → localStorage fallback

const MODELS_KEY = "bc-global-models"

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

// ── API Key storage (separate from models JSON) ──

function apiKeyStorageKey(modelId: string): string {
  return `bc-api-key:${modelId}`
}

export async function loadApiKey(modelId: string): Promise<string | null> {
  // 1. Try Tauri
  try {
    const val = await getSetting(`api_key:${modelId}`)
    if (val) return val
  } catch { /* fall through */ }
  // 2. Try localStorage
  return lsGet(apiKeyStorageKey(modelId))
}

export async function saveApiKey(modelId: string, key: string): Promise<void> {
  lsSet(apiKeyStorageKey(modelId), key)
  try { await setSetting(`api_key:${modelId}`, key) } catch { /* Tauri not available */ }
}

export async function deleteApiKey(modelId: string): Promise<void> {
  lsRemove(apiKeyStorageKey(modelId))
  try { await setSetting(`api_key:${modelId}`, "") } catch { /* Tauri not available */ }
}

// ── Helpers ──

export function findModel(
  models: ModelConfig[],
  id: string,
): ModelConfig | undefined {
  return models.find((m) => m.id === id)
}
