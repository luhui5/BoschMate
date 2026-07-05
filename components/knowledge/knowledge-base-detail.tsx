"use client"

import { useRef, useState } from "react"
import { UploadCloud } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  ACCEPTED_EXTENSIONS,
  kindFromName,
  type KnowledgeBase,
  type KnowledgeDocument,
} from "@/lib/knowledge"
import { KnowledgeDocumentList } from "./knowledge-document-list"

interface KnowledgeBaseDetailProps {
  base: KnowledgeBase | null
  documents: KnowledgeDocument[]
  uploading: boolean
  onUpload: (files: FileList) => Promise<void>
  onRemoveDocument: (id: string) => void
}

async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let binary = ""
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

export function KnowledgeBaseDetail({
  base,
  documents,
  uploading,
  onUpload,
  onRemoveDocument,
}: KnowledgeBaseDetailProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  if (!base) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        选择或创建一个知识库
      </div>
    )
  }

  const ingest = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0 || uploading) return
    void onUpload(fileList)
  }

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-hidden p-4">
      <div>
        <h3 className="text-base font-semibold">{base.name}</h3>
        {base.description && (
          <p className="mt-0.5 text-sm text-muted-foreground">{base.description}</p>
        )}
        <p className="mt-1 text-xs text-muted-foreground">
          {base.documentCount} 个文档 · {base.chunkCount} 块 · 更新于{" "}
          {new Date(base.updatedAt).toLocaleString("zh-CN")}
        </p>
      </div>

      <button
        type="button"
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setDragging(false)
          ingest(e.dataTransfer.files)
        }}
        className={cn(
          "flex w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-6 text-center transition-colors",
          dragging ? "border-primary bg-primary/5" : "border-border hover:border-ring hover:bg-muted/40",
          uploading && "pointer-events-none opacity-60",
        )}
      >
        <span className="flex size-9 items-center justify-center rounded-full bg-secondary text-muted-foreground">
          <UploadCloud className="size-4" />
        </span>
        <span className="text-sm font-medium">
          {uploading ? "上传中…" : "点击或拖拽文件到此处上传"}
        </span>
        <span className="text-xs text-muted-foreground">
          支持 PDF · Word (.docx) · Excel · CSV · TXT · Markdown
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

      <KnowledgeDocumentList documents={documents} onRemove={onRemoveDocument} />
    </div>
  )
}

export { fileToBase64 }
