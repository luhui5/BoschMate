export type SelectionLookupTriggerMode = "shortcut" | "auto" | "both"
export type SelectionLookupAutoMode = "mouse_up" | "clipboard"

export interface SelectionLookupSettings {
  enabled: boolean
  triggerMode: SelectionLookupTriggerMode
  shortcut: string
  autoMode: SelectionLookupAutoMode
  autoDelayMs: number
  minSelectionChars: number
  topK: number
  closeToTray: boolean
}

export const SELECTION_LOOKUP_KEY = "selection_lookup"
export const ASSISTANT_SELECTED_KBASE_KEY = "assistant_selected_kbase"

export const DEFAULT_SELECTION_LOOKUP_SETTINGS: SelectionLookupSettings = {
  enabled: false,
  triggerMode: "shortcut",
  shortcut: "CommandOrControl+Shift+K",
  autoMode: "mouse_up",
  autoDelayMs: 400,
  minSelectionChars: 2,
  topK: 8,
  closeToTray: true,
}

export interface SelectionLookupStartEvent {
  text: string
  kbaseId: string
  kbaseName: string
  source: string
}

export const SELECTION_CHIP_SIZE = { width: 120, height: 48 } as const
export const SELECTION_CHAT_SIZE = { width: 440, height: 360 } as const

export interface SelectionLookupErrorEvent {
  code: string
  message: string
}

export interface KnowledgeChunkHit {
  id: string
  documentId: string
  kbaseId: string
  chunkIndex: number
  content: string
  kbaseName: string
  documentName: string
  score: number
}
