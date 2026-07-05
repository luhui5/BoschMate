"use client"

import {
  UploadCloud,
  FileText,
  FileSpreadsheet,
  File,
  Trash2,
  Loader2,
  CheckCircle2,
  AlertCircle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  formatBytes,
  type KnowledgeDocument,
  type KnowledgeKind,
} from "@/lib/knowledge"

const KIND_META: Record<
  KnowledgeKind,
  { icon: React.ComponentType<{ className?: string }>; className: string }
> = {
  pdf: { icon: FileText, className: "bg-red-500/15 text-red-400" },
  word: { icon: FileText, className: "bg-sky-500/15 text-sky-400" },
  excel: { icon: FileSpreadsheet, className: "bg-emerald-500/15 text-emerald-400" },
  text: { icon: FileText, className: "bg-zinc-500/15 text-zinc-300" },
  other: { icon: File, className: "bg-zinc-500/15 text-zinc-300" },
}

interface KnowledgeDocumentListProps {
  documents: KnowledgeDocument[]
  onRemove: (id: string) => void
}

export function KnowledgeDocumentList({ documents, onRemove }: KnowledgeDocumentListProps) {
  if (documents.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        暂无文档，请上传文件开始索引
      </p>
    )
  }

  const totalBytes = documents.reduce((sum, d) => sum + d.sizeBytes, 0)

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          文档
        </span>
        <span className="text-xs text-muted-foreground">
          {documents.length} 个 · {formatBytes(totalBytes)}
        </span>
      </div>
      <ul className="max-h-72 space-y-1.5 overflow-y-auto">
        {documents.map((doc) => {
          const meta = KIND_META[doc.kind] ?? KIND_META.other
          const Icon = meta.icon
          return (
            <li
              key={doc.id}
              className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2"
            >
              <span
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-md",
                  meta.className,
                )}
              >
                <Icon className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{doc.name}</p>
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  {formatBytes(doc.sizeBytes)}
                  {doc.status === "pending" || doc.status === "indexing" ? (
                    <span className="flex items-center gap-1 text-amber-400">
                      <Loader2 className="size-3 animate-spin" /> 索引中
                    </span>
                  ) : doc.status === "ready" ? (
                    <span className="flex items-center gap-1 text-emerald-400">
                      <CheckCircle2 className="size-3" /> {doc.chunkCount} 块
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-red-400" title={doc.error}>
                      <AlertCircle className="size-3" /> 失败
                    </span>
                  )}
                </p>
                {doc.error && (
                  <p className="mt-0.5 truncate text-xs text-red-400/80">{doc.error}</p>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => onRemove(doc.id)}
                aria-label={`删除 ${doc.name}`}
              >
                <Trash2 className="size-4" />
              </Button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
