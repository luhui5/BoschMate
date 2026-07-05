"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Modal } from "@/components/ui/modal"
import {
  createKnowledgeBase,
  deleteKnowledgeBase,
  deleteKnowledgeDocument,
  ingestKnowledgeDocument,
  ingestKnowledgeDocumentFromPaths,
  isTauri,
  listKnowledgeBases,
  listKnowledgeDocuments,
  onKnowledgeIndexProgress,
} from "@/lib/tauri-api"
import { kindFromName, type KnowledgeBase, type KnowledgeDocument } from "@/lib/knowledge"
import { KnowledgeBaseList } from "./knowledge-base-list"
import { KnowledgeBaseDetail, fileToBase64 } from "./knowledge-base-detail"
import { CreateKnowledgeBaseDialog } from "./create-knowledge-base-dialog"

interface KnowledgePanelProps {
  open: boolean
  onClose: () => void
  onDocumentCountChange?: (count: number) => void
}

export function KnowledgePanel({ open, onClose, onDocumentCountChange }: KnowledgePanelProps) {
  const [bases, setBases] = useState<KnowledgeBase[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([])
  const [createOpen, setCreateOpen] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [loading, setLoading] = useState(false)
  const selectedIdRef = useRef<string | null>(null)

  useEffect(() => {
    selectedIdRef.current = selectedId
  }, [selectedId])

  const refreshBases = useCallback(async () => {
    if (!isTauri()) return
    const list = await listKnowledgeBases()
    setBases(list)
    const totalDocs = list.reduce((sum, b) => sum + b.documentCount, 0)
    onDocumentCountChange?.(totalDocs)
  }, [onDocumentCountChange])

  const refreshDocuments = useCallback(async (kbaseId: string) => {
    if (!isTauri()) return
    const docs = await listKnowledgeDocuments(kbaseId)
    setDocuments(docs)
  }, [])

  const handleUploadFromPaths = useCallback(async (paths: string[]) => {
    const kbaseId = selectedIdRef.current
    if (!kbaseId || uploading || paths.length === 0) return
    setUploading(true)
    try {
      const docs = await ingestKnowledgeDocumentFromPaths({ kbaseId, paths })
      setDocuments((prev) => {
        const ids = new Set(docs.map((d) => d.id))
        return [...docs, ...prev.filter((d) => !ids.has(d.id))]
      })
      await refreshBases()
      await refreshDocuments(kbaseId)
    } finally {
      setUploading(false)
    }
  }, [uploading, refreshBases, refreshDocuments])

  useEffect(() => {
    if (!open || !isTauri()) return
    let unlistenTauriDrop: (() => void) | null = null
    void import("@tauri-apps/api/webviewWindow").then(({ getCurrentWebviewWindow }) => {
      void getCurrentWebviewWindow()
        .onDragDropEvent((event) => {
          if (event.payload.type !== "drop") return
          const paths = "paths" in event.payload ? event.payload.paths : []
          if (paths.length > 0) void handleUploadFromPaths(paths)
        })
        .then((fn) => {
          unlistenTauriDrop = fn
        })
    })
    return () => {
      if (unlistenTauriDrop) unlistenTauriDrop()
    }
  }, [open, handleUploadFromPaths])

  useEffect(() => {
    if (!open || !isTauri()) return
    setLoading(true)
    void refreshBases().finally(() => setLoading(false))
  }, [open, refreshBases])

  useEffect(() => {
    if (!selectedId || !open) {
      setDocuments([])
      return
    }
    void refreshDocuments(selectedId)
  }, [selectedId, open, refreshDocuments])

  useEffect(() => {
    if (!open || !isTauri()) return
    return onKnowledgeIndexProgress((event) => {
      if (event.kbaseId === selectedId) {
        setDocuments((prev) =>
          prev.map((d) =>
            d.id === event.documentId
              ? {
                  ...d,
                  status: event.status,
                  chunkCount: event.chunkCount,
                  error: event.error,
                }
              : d,
          ),
        )
      }
      void refreshBases()
      if (event.kbaseId === selectedId) {
        void refreshDocuments(event.kbaseId)
      }
    })
  }, [open, selectedId, refreshBases, refreshDocuments])

  const handleCreate = async (name: string, description?: string) => {
    const base = await createKnowledgeBase({ name, description })
    await refreshBases()
    setSelectedId(base.id)
  }

  const handleDeleteBase = async (id: string) => {
    if (!confirm("确定删除该知识库及其所有文档？")) return
    await deleteKnowledgeBase(id)
    if (selectedId === id) {
      setSelectedId(null)
      setDocuments([])
    }
    await refreshBases()
  }

  const handleUpload = async (fileList: FileList) => {
    if (!selectedId || uploading) return
    setUploading(true)
    try {
      for (const file of Array.from(fileList)) {
        const dataBase64 = await fileToBase64(file)
        const doc = await ingestKnowledgeDocument({
          kbaseId: selectedId,
          name: file.name,
          kind: kindFromName(file.name),
          dataBase64,
        })
        setDocuments((prev) => [doc, ...prev.filter((d) => d.id !== doc.id)])
      }
      await refreshBases()
      await refreshDocuments(selectedId)
    } catch (err) {
      throw err
    } finally {
      setUploading(false)
    }
  }

  const handleRemoveDocument = async (documentId: string) => {
    await deleteKnowledgeDocument(documentId)
    setDocuments((prev) => prev.filter((d) => d.id !== documentId))
    await refreshBases()
  }

  const selectedBase = bases.find((b) => b.id === selectedId) ?? null

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title="知识库"
        description="管理全局知识库与文档；在发送栏选择知识库以用于对话。"
        className="max-w-3xl"
      >
        <div className="flex h-[28rem] overflow-hidden rounded-lg border border-border">
          <div className="w-52 shrink-0">
            <KnowledgeBaseList
              bases={bases}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onCreate={() => setCreateOpen(true)}
              onDelete={(id) => void handleDeleteBase(id)}
            />
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            {loading ? (
              <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                加载中…
              </div>
            ) : (
              <KnowledgeBaseDetail
                base={selectedBase}
                documents={documents}
                uploading={uploading}
                onUpload={handleUpload}
                onRemoveDocument={(id) => void handleRemoveDocument(id)}
              />
            )}
          </div>
        </div>
      </Modal>

      <CreateKnowledgeBaseDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={handleCreate}
      />
    </>
  )
}
