"use client"

import { useCallback, useEffect, useState } from "react"
import { X, BookOpen, MessageSquare, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import type { KnowledgeChunkHit, SelectionLookupStartEvent, SelectionLookupErrorEvent } from "@/lib/selection-lookup"
import {
  continueSelectionInAssistant,
  hideSelectionPopup,
  onSelectionLookupError,
  onSelectionLookupStart,
  retrieveKnowledgeContext,
} from "@/lib/tauri-api"

function excerpt(text: string, max = 400): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}…`
}

export function SelectionPopupView() {
  const [query, setQuery] = useState<string | null>(null)
  const [kbaseId, setKbaseId] = useState<string | null>(null)
  const [topK, setTopK] = useState(8)
  const [loading, setLoading] = useState(false)
  const [chunks, setChunks] = useState<KnowledgeChunkHit[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    document.body.style.paddingTop = "0"
    return () => {
      document.body.style.paddingTop = "34px"
    }
  }, [])

  const runSearch = useCallback(async (event: SelectionLookupStartEvent) => {
    setQuery(event.text)
    setKbaseId(event.kbaseId)
    setTopK(event.topK)
    setLoading(true)
    setError(null)
    setChunks([])
    try {
      const result = await retrieveKnowledgeContext([event.kbaseId], event.text, event.topK)
      setChunks(result.chunks)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const offStart = onSelectionLookupStart((event) => {
      void runSearch(event)
    })
    const offError = onSelectionLookupError((event: SelectionLookupErrorEvent) => {
      setQuery(null)
      setLoading(false)
      setChunks([])
      setError(event.message)
    })
    return () => {
      offStart()
      offError()
    }
  }, [runSearch])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") void hideSelectionPopup()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const handleClose = () => {
    void hideSelectionPopup()
  }

  const handleContinue = () => {
    if (!query) return
    void continueSelectionInAssistant(query, kbaseId)
  }

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <header
        data-tauri-drag-region
        className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3"
      >
        <BookOpen className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="flex-1 truncate text-xs font-medium" data-tauri-drag-region>
          知识库查询
        </span>
        <button
          type="button"
          onClick={handleClose}
          className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="关闭"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-3">
        {query && (
          <div className="mb-3 rounded-lg border border-border bg-muted/30 px-3 py-2">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              选中内容
            </p>
            <p className="mt-1 text-sm leading-relaxed">{query}</p>
          </div>
        )}

        {loading && (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            正在检索知识库…
          </div>
        )}

        {error && !loading && (
          <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        {!loading && !error && chunks.length === 0 && query && (
          <p className="py-4 text-center text-sm text-muted-foreground">
            未找到相关内容，请尝试其他关键词或上传文档到知识库。
          </p>
        )}

        {!loading && chunks.length > 0 && (
          <ul className="space-y-2">
            {chunks.map((hit) => (
              <li
                key={hit.id}
                className="rounded-lg border border-border bg-card px-3 py-2"
              >
                <p className="text-[10px] text-muted-foreground">
                  {hit.kbaseName} / {hit.documentName} · chunk {hit.chunkIndex}
                </p>
                <p className={cn("mt-1 text-sm leading-relaxed whitespace-pre-wrap")}>
                  {excerpt(hit.content)}
                </p>
              </li>
            ))}
          </ul>
        )}

        {!query && !error && !loading && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            选中文字后使用快捷键或自动模式触发查询。
          </p>
        )}
      </div>

      <footer className="shrink-0 border-t border-border p-2">
        <button
          type="button"
          disabled={!query}
          onClick={handleContinue}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-40"
        >
          <MessageSquare className="h-4 w-4" />
          在助手中继续
        </button>
      </footer>
    </div>
  )
}
