export type KnowledgeKind = "pdf" | "word" | "excel" | "text" | "other"

export type KnowledgeStatus = "pending" | "indexing" | "ready" | "failed"

export interface KnowledgeBase {
  id: string
  name: string
  description?: string
  documentCount: number
  chunkCount: number
  createdAt: string
  updatedAt: string
}

export interface KnowledgeDocument {
  id: string
  kbaseId: string
  name: string
  kind: KnowledgeKind
  sizeBytes: number
  status: KnowledgeStatus
  chunkCount: number
  error?: string
  addedAt: string
  updatedAt: string
}

export interface KnowledgeIndexProgressEvent {
  documentId: string
  kbaseId: string
  status: KnowledgeStatus
  chunkCount: number
  error?: string
}

export const ACCEPTED_EXTENSIONS =
  ".pdf,.docx,.xls,.xlsx,.csv,.txt,.md"

const EXT_TO_KIND: Record<string, KnowledgeKind> = {
  pdf: "pdf",
  docx: "word",
  xls: "excel",
  xlsx: "excel",
  csv: "excel",
  txt: "text",
  md: "text",
}

export function kindFromName(name: string): KnowledgeKind {
  const ext = name.split(".").pop()?.toLowerCase() ?? ""
  return EXT_TO_KIND[ext] ?? "other"
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export const ENABLED_KBASES_KEY = "bc-enabled-kbases"

export function getEnabledKbaseIds(): string[] {
  if (typeof window === "undefined") return []
  try {
    const raw = localStorage.getItem(ENABLED_KBASES_KEY)
    if (!raw) return []
    return JSON.parse(raw) as string[]
  } catch {
    return []
  }
}

export function loadEnabledKbases(allIds: string[]): string[] {
  const saved = getEnabledKbaseIds()
  if (saved.length === 0) return allIds
  return saved.filter((id) => allIds.includes(id))
}

export function saveEnabledKbases(ids: string[]): void {
  try {
    localStorage.setItem(ENABLED_KBASES_KEY, JSON.stringify(ids))
  } catch {
    /* ignore */
  }
}
