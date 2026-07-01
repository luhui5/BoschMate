"use client"

import { useRef, useState } from "react"
import {
  UploadCloud,
  FileText,
  FileSpreadsheet,
  Presentation,
  File,
  Trash2,
  Loader2,
  CheckCircle2,
} from "lucide-react"
import { Modal } from "@/components/ui/modal"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  ACCEPTED_EXTENSIONS,
  formatBytes,
  kindFromName,
  type KnowledgeFile,
  type KnowledgeKind,
} from "@/lib/knowledge"

const KIND_META: Record<
  KnowledgeKind,
  { icon: React.ComponentType<{ className?: string }>; className: string; label: string }
> = {
  pdf: { icon: FileText, className: "bg-red-500/15 text-red-400", label: "PDF" },
  word: { icon: FileText, className: "bg-sky-500/15 text-sky-400", label: "Word" },
  ppt: { icon: Presentation, className: "bg-orange-500/15 text-orange-400", label: "PPT" },
  excel: { icon: FileSpreadsheet, className: "bg-emerald-500/15 text-emerald-400", label: "Excel" },
  text: { icon: FileText, className: "bg-zinc-500/15 text-zinc-300", label: "文本" },
  other: { icon: File, className: "bg-zinc-500/15 text-zinc-300", label: "文件" },
}

interface KnowledgeDialogProps {
  open: boolean
  onClose: () => void
  files: KnowledgeFile[]
  onAdd: (files: KnowledgeFile[]) => void
  onRemove: (id: string) => void
}

export function KnowledgeDialog({ open, onClose, files, onAdd, onRemove }: KnowledgeDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const ingest = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return
    const added: KnowledgeFile[] = Array.from(fileList).map((f) => ({
      id: `k-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: f.name,
      kind: kindFromName(f.name),
      sizeBytes: f.size,
      status: "indexing" as const,
      chunks: 0,
      addedAt: new Date().toISOString(),
    }))
    onAdd(added)
    // 模拟异步索引完成
    added.forEach((doc, i) => {
      setTimeout(
        () => {
          onAdd([
            {
              ...doc,
              status: "ready",
              chunks: Math.max(4, Math.round(doc.sizeBytes / 24000)),
            },
          ])
        },
        1200 + i * 600,
      )
    })
  }

  const totalBytes = files.reduce((sum, f) => sum + f.sizeBytes, 0)

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="知识库"
      description="上传 PDF、Word、PPT、Excel 等文档，助手将建立本地向量索引以供检索。"
      className="max-w-lg"
    >
      <div className="space-y-4">
        {/* Dropzone */}
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            ingest(e.dataTransfer.files)
          }}
          className={cn(
            "flex w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-8 text-center transition-colors",
            dragging ? "border-primary bg-primary/5" : "border-border hover:border-ring hover:bg-muted/40",
          )}
        >
          <span className="flex size-10 items-center justify-center rounded-full bg-secondary text-muted-foreground">
            <UploadCloud className="size-5" />
          </span>
          <span className="text-sm font-medium">点击或拖拽文件到此处上传</span>
          <span className="text-xs text-muted-foreground">
            支持 PDF · Word · PPT · Excel · CSV · TXT · Markdown
          </span>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={ACCEPTED_EXTENSIONS}
            className="hidden"
            onChange={(e) => {
              ingest(e.target.files)
              e.target.value = ""
            }}
          />
        </button>

        {/* File list */}
        {files.length > 0 && (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                已索引文档
              </span>
              <span className="text-xs text-muted-foreground">
                {files.length} 个 · {formatBytes(totalBytes)}
              </span>
            </div>
            <ul className="max-h-64 space-y-1.5 overflow-y-auto">
              {files.map((f) => {
                const meta = KIND_META[f.kind]
                const Icon = meta.icon
                return (
                  <li
                    key={f.id}
                    className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2"
                  >
                    <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-md", meta.className)}>
                      <Icon className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{f.name}</p>
                      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        {formatBytes(f.sizeBytes)}
                        {f.status === "indexing" ? (
                          <span className="flex items-center gap-1 text-amber-400">
                            <Loader2 className="size-3 animate-spin" /> 索引中
                          </span>
                        ) : f.status === "ready" ? (
                          <span className="flex items-center gap-1 text-emerald-400">
                            <CheckCircle2 className="size-3" /> {f.chunks} 块
                          </span>
                        ) : (
                          <span className="text-red-400">索引失败</span>
                        )}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => onRemove(f.id)}
                      aria-label={`删除 ${f.name}`}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  )
}
