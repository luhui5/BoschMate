/**
 * Shared model configuration type and persistence helpers.
 * Single source of truth for model configs used by both
 * the settings page and the assistant chat dropdown.
 */

import { getSetting, setSetting, saveCredential, getCredential, deleteCredential } from "@/lib/tauri-api"

// ── Types ──

export type ModelProtocol = "openai" | "anthropic"

/** Backend streaming route — maps to Rust ChatRequest.provider */
export type ModelBackend = "ollama" | "openai" | "anthropic"

/** @deprecated Use ModelBackend — kept for migration only */
export type ModelProvider = ModelBackend

/** User-defined provider for grouping and display */
export interface ModelProviderConfig {
  id: string
  name: string
  description?: string
}

export interface ModelConfig {
  id: string
  name: string
  protocol: ModelProtocol
  backend: ModelBackend
  providerId: string
  detail: string
  endpoint: string | null
  apiKey?: string
  skipTlsVerify?: boolean
  contextWindow: number
  temperature: number
}

/** Built-in provider ids — cannot be deleted from settings */
export const BUILTIN_PROVIDER_IDS = new Set([
  "provider-ollama",
  "provider-openai",
  "provider-anthropic",
  "provider-bcsc",
])

export const BACKEND_LABEL: Record<ModelBackend, string> = {
  ollama: "Ollama",
  openai: "OpenAI",
  anthropic: "Anthropic",
}

const UNGROUPED_PROVIDER_ID = "provider-ungrouped"

// ── Defaults ──

export const DEFAULT_PROVIDERS: ModelProviderConfig[] = [
  { id: "provider-ollama", name: "Ollama" },
  { id: "provider-openai", name: "OpenAI" },
  { id: "provider-anthropic", name: "Anthropic" },
  { id: "provider-bcsc", name: "BCSC" },
]

export const DEFAULT_MODELS: ModelConfig[] = [
  {
    id: "bcsc-qwen",
    name: "Qwen3.5-27B-FP16",
    protocol: "openai",
    backend: "openai",
    providerId: "provider-bcsc",
    detail: "BCSC 默认模型",
    endpoint: "http://10.190.179.61:11600/v1",
    contextWindow: 32768,
    temperature: 0.2,
  },
]

const DEFAULT_API_KEYS: Record<string, string> = {
  "bcsc-qwen": "test",
}

const LEGACY_BACKEND_TO_PROVIDER_ID: Record<ModelBackend, string> = {
  ollama: "provider-ollama",
  openai: "provider-openai",
  anthropic: "provider-anthropic",
}

const REMOVED_DEFAULT_MODEL_IDS = new Set(["ollama-local"])
const OLD_BCSC_ENDPOINT = "http://10.190.179.61:11600"

function applyDefaultModelMaintenance(models: ModelConfig[]): { models: ModelConfig[]; changed: boolean } {
  let changed = false
  const filtered = models.filter((m) => {
    if (REMOVED_DEFAULT_MODEL_IDS.has(m.id)) {
      changed = true
      return false
    }
    return true
  })
  const patched = filtered.map((m) => {
    if (m.id === "bcsc-qwen" && m.endpoint === OLD_BCSC_ENDPOINT) {
      changed = true
      return { ...m, endpoint: DEFAULT_MODELS[0].endpoint }
    }
    return m
  })
  return { models: patched, changed }
}

// ── Persistence ──
// Priority: Tauri IPC (SQLite) → localStorage fallback

const MODELS_KEY = "bc-global-models"
const PROVIDERS_KEY = "bc-global-providers"
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

async function readRawSetting(key: string): Promise<string | null> {
  try {
    const val = await getSetting(key)
    if (val) return val
  } catch { /* Tauri not available */ }
  return lsGet(key)
}

type LegacyModelConfig = ModelConfig & { provider?: ModelBackend }

function migrateModelEntry(raw: LegacyModelConfig): ModelConfig {
  const backend = raw.backend ?? raw.provider ?? "openai"
  const providerId =
    raw.providerId ??
    LEGACY_BACKEND_TO_PROVIDER_ID[backend] ??
    DEFAULT_PROVIDERS[0].id
  return {
    id: raw.id,
    name: raw.name,
    protocol: raw.protocol,
    backend,
    providerId,
    detail: raw.detail,
    endpoint: raw.endpoint,
    skipTlsVerify: raw.skipTlsVerify ?? false,
    contextWindow: raw.contextWindow,
    temperature: raw.temperature,
  }
}

function needsModelMigration(raw: LegacyModelConfig[]): boolean {
  return raw.some((m) => !m.backend || !m.providerId || "provider" in m)
}

function mergeProviders(existing: ModelProviderConfig[]): ModelProviderConfig[] {
  const byId = new Map(existing.map((p) => [p.id, p]))
  for (const def of DEFAULT_PROVIDERS) {
    if (!byId.has(def.id)) byId.set(def.id, def)
  }
  const ordered: ModelProviderConfig[] = []
  for (const def of DEFAULT_PROVIDERS) {
    if (byId.has(def.id)) ordered.push(byId.get(def.id)!)
  }
  for (const p of byId.values()) {
    if (!DEFAULT_PROVIDERS.some((d) => d.id === p.id)) ordered.push(p)
  }
  return ordered
}

function mergeModels(existing: ModelConfig[]): ModelConfig[] {
  const byId = new Map(existing.map((m) => [m.id, m]))
  for (const def of DEFAULT_MODELS) {
    if (!byId.has(def.id)) byId.set(def.id, def)
  }
  const ordered: ModelConfig[] = []
  for (const def of DEFAULT_MODELS) {
    if (byId.has(def.id)) ordered.push(byId.get(def.id)!)
  }
  for (const m of byId.values()) {
    if (!DEFAULT_MODELS.some((d) => d.id === m.id)) ordered.push(m)
  }
  return ordered
}

async function seedDefaultApiKeys(): Promise<void> {
  for (const [modelId, key] of Object.entries(DEFAULT_API_KEYS)) {
    const existing = await loadApiKey(modelId)
    if (!existing) await saveApiKey(modelId, key)
  }
}

export async function loadProviders(): Promise<ModelProviderConfig[]> {
  let parsed: ModelProviderConfig[] | null = null

  const raw = await readRawSetting(PROVIDERS_KEY)
  if (raw) {
    try {
      const arr = JSON.parse(raw) as ModelProviderConfig[]
      if (Array.isArray(arr) && arr.length > 0) parsed = arr
    } catch { /* corrupted */ }
  }

  if (!parsed) {
    await saveProviders(DEFAULT_PROVIDERS)
    return [...DEFAULT_PROVIDERS]
  }

  const merged = mergeProviders(parsed)
  if (merged.length !== parsed.length || merged.some((p, i) => p.id !== parsed![i]?.id)) {
    await saveProviders(merged)
  }
  return merged
}

export async function saveProviders(providers: ModelProviderConfig[]): Promise<void> {
  const json = JSON.stringify(providers)
  lsSet(PROVIDERS_KEY, json)
  try { await setSetting(PROVIDERS_KEY, json) } catch { /* Tauri not available */ }
}

export async function loadModels(): Promise<ModelConfig[]> {
  let parsed: LegacyModelConfig[] | null = null

  const raw = await readRawSetting(MODELS_KEY)
  if (raw) {
    try {
      const arr = JSON.parse(raw) as LegacyModelConfig[]
      if (Array.isArray(arr) && arr.length > 0) parsed = arr
    } catch { /* corrupted */ }
  }

  if (!parsed) {
    await saveModels(DEFAULT_MODELS)
    await seedDefaultApiKeys()
    return [...DEFAULT_MODELS]
  }

  let models = parsed.map(migrateModelEntry)
  const maintained = applyDefaultModelMaintenance(models)
  models = maintained.models
  const migrated = needsModelMigration(parsed)
  const merged = mergeModels(models)
  const changed =
    migrated ||
    maintained.changed ||
    merged.length !== models.length ||
    merged.some((m, i) => m.id !== models[i]?.id)

  if (changed) {
    models = merged
    await saveModels(models)
  }

  await seedDefaultApiKeys()
  return models
}

export async function saveModels(models: ModelConfig[]): Promise<void> {
  const json = JSON.stringify(models)
  lsSet(MODELS_KEY, json)
  try { await setSetting(MODELS_KEY, json) } catch { /* Tauri not available */ }
}

// ── Last-used & usage stats (for default model selection) ──

async function readSetting(key: string): Promise<string | null> {
  return readRawSetting(key)
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

export function findProvider(
  providers: ModelProviderConfig[],
  id: string,
): ModelProviderConfig | undefined {
  return providers.find((p) => p.id === id)
}

export function groupModelsByProvider(
  models: ModelConfig[],
  providers: ModelProviderConfig[],
): { provider: ModelProviderConfig; models: ModelConfig[] }[] {
  const providerMap = new Map(providers.map((p) => [p.id, p]))
  const buckets = new Map<string, ModelConfig[]>()

  for (const p of providers) buckets.set(p.id, [])
  buckets.set(UNGROUPED_PROVIDER_ID, [])

  for (const m of models) {
    const key = providerMap.has(m.providerId) ? m.providerId : UNGROUPED_PROVIDER_ID
    buckets.get(key)!.push(m)
  }

  const groups: { provider: ModelProviderConfig; models: ModelConfig[] }[] = []
  for (const p of providers) {
    const items = buckets.get(p.id) ?? []
    if (items.length > 0) groups.push({ provider: p, models: items })
  }
  const ungrouped = buckets.get(UNGROUPED_PROVIDER_ID) ?? []
  if (ungrouped.length > 0) {
    groups.push({
      provider: { id: UNGROUPED_PROVIDER_ID, name: "未分类" },
      models: ungrouped,
    })
  }
  return groups
}

export function isHttpsEndpoint(endpoint: string | null | undefined): boolean {
  return (endpoint ?? "").trim().toLowerCase().startsWith("https://")
}

export function inferBackend(protocol: ModelProtocol, endpoint: string | null): ModelBackend {
  if (protocol === "anthropic") return "anthropic"
  if (
    endpoint &&
    (endpoint.includes("127.0.0.1") ||
      endpoint.includes("localhost") ||
      endpoint.includes(":11434"))
  ) {
    return "ollama"
  }
  return "openai"
}
