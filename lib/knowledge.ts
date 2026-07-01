export type KnowledgeKind = "pdf" | "word" | "ppt" | "excel" | "text" | "other"

export type KnowledgeStatus = "indexing" | "ready" | "failed"

export interface KnowledgeFile {
  id: string
  name: string
  kind: KnowledgeKind
  sizeBytes: number
  status: KnowledgeStatus
  chunks: number
  addedAt: string
}

export const ACCEPTED_EXTENSIONS =
  ".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.csv,.txt,.md"

const EXT_TO_KIND: Record<string, KnowledgeKind> = {
  pdf: "pdf",
  doc: "word",
  docx: "word",
  ppt: "ppt",
  pptx: "ppt",
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

export const SEED_KNOWLEDGE: KnowledgeFile[] = [
  {
    id: "k1",
    name: "架构设计规范 v3.pdf",
    kind: "pdf",
    sizeBytes: 2_340_000,
    status: "ready",
    chunks: 128,
    addedAt: new Date(Date.now() - 1000 * 60 * 60 * 26).toISOString(),
  },
  {
    id: "k2",
    name: "季度产品路线图.pptx",
    kind: "ppt",
    sizeBytes: 5_120_000,
    status: "ready",
    chunks: 64,
    addedAt: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(),
  },
  {
    id: "k3",
    name: "接口成本核算.xlsx",
    kind: "excel",
    sizeBytes: 810_000,
    status: "ready",
    chunks: 22,
    addedAt: new Date(Date.now() - 1000 * 60 * 40).toISOString(),
  },
]
