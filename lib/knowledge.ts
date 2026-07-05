import { getSetting, setSetting, isTauri } from "@/lib/tauri-api"
import { ASSISTANT_SELECTED_KBASE_KEY } from "@/lib/selection-lookup"

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

/** @deprecated use ASSISTANT_SELECTED_KBASE_KEY — kept for localStorage migration */
export const SELECTED_KBASE_KEY = "bc-chat-selected-kbase"

export async function loadSelectedKbaseId(): Promise<string | null> {
  if (typeof window === "undefined") return null

  if (isTauri()) {
    try {
      const raw = await getSetting(ASSISTANT_SELECTED_KBASE_KEY)
      if (raw != null) {
        const id = JSON.parse(raw) as string | null
        if (id && typeof id === "string") return id
        if (raw === "null") return null
      }
    } catch {
      /* fall through */
    }
  }

  try {
    const legacy = localStorage.getItem(SELECTED_KBASE_KEY)
    if (legacy) {
      const id = JSON.parse(legacy) as string | null
      if (id && typeof id === "string") {
        await saveSelectedKbaseId(id)
        return id
      }
    }
    const raw = localStorage.getItem(`bc-${ASSISTANT_SELECTED_KBASE_KEY}`)
    if (raw != null) {
      return JSON.parse(raw) as string | null
    }
  } catch {
    /* ignore */
  }
  return null
}

export function getSelectedKbaseId(): string | null {
  if (typeof window === "undefined") return null
  try {
    const raw =
      localStorage.getItem(`bc-${ASSISTANT_SELECTED_KBASE_KEY}`) ??
      localStorage.getItem(SELECTED_KBASE_KEY)
    if (!raw) return null
    const id = JSON.parse(raw) as string | null
    return id && typeof id === "string" ? id : null
  } catch {
    return null
  }
}

export async function saveSelectedKbaseId(id: string | null): Promise<void> {
  const json = JSON.stringify(id)
  try {
    if (id) {
      localStorage.setItem(SELECTED_KBASE_KEY, json)
      localStorage.setItem(`bc-${ASSISTANT_SELECTED_KBASE_KEY}`, json)
    } else {
      localStorage.removeItem(SELECTED_KBASE_KEY)
      localStorage.removeItem(`bc-${ASSISTANT_SELECTED_KBASE_KEY}`)
    }
  } catch {
    /* ignore */
  }
  if (isTauri()) {
    try {
      await setSetting(ASSISTANT_SELECTED_KBASE_KEY, json)
    } catch {
      /* ignore */
    }
  }
}
