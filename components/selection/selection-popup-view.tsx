"use client"

import { useCallback, useEffect, useState } from "react"
import { X, Loader2 } from "lucide-react"
import { SelectionKbaseChip } from "@/components/selection/selection-kbase-chip"
import {
  SELECTION_CHAT_SIZE,
  SELECTION_CHIP_SIZE,
  type SelectionLookupErrorEvent,
  type SelectionLookupStartEvent,
} from "@/lib/selection-lookup"
import { runSelectionKnowledgeChat } from "@/lib/selection-knowledge-chat"
import {
  hideSelectionPopup,
  isTauri,
  onSelectionLookupError,
  onSelectionLookupStart,
} from "@/lib/tauri-api"

type PopupPhase = "idle" | "prompt" | "loading" | "answer" | "error"

async function setPopupSize(width: number, height: number) {
  if (!isTauri()) return
  const { getCurrentWindow } = await import("@tauri-apps/api/window")
  const { LogicalSize } = await import("@tauri-apps/api/dpi")
  await getCurrentWindow().setSize(new LogicalSize(width, height))
}

export function SelectionPopupView() {
  const [phase, setPhase] = useState<PopupPhase>("idle")
  const [prompt, setPrompt] = useState<SelectionLookupStartEvent | null>(null)
  const [query, setQuery] = useState<string | null>(null)
  const [answer, setAnswer] = useState<string | null>(null)
  const [activityLabel, setActivityLabel] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [chatRunning, setChatRunning] = useState(false)

  useEffect(() => {
    document.body.style.paddingTop = "0"
    return () => {
      document.body.style.paddingTop = "34px"
    }
  }, [])

  const showPrompt = useCallback(async (event: SelectionLookupStartEvent) => {
    setPrompt(event)
    setQuery(event.text)
    setAnswer(null)
    setError(null)
    setActivityLabel(null)
    setPhase("prompt")
    await setPopupSize(SELECTION_CHIP_SIZE.width, SELECTION_CHIP_SIZE.height)
  }, [])

  useEffect(() => {
    const offStart = onSelectionLookupStart((event) => {
      void showPrompt(event)
    })
    const offError = onSelectionLookupError((event: SelectionLookupErrorEvent) => {
      void (async () => {
        setError(event.message)
        setPhase("error")
        await setPopupSize(SELECTION_CHAT_SIZE.width, SELECTION_CHAT_SIZE.height)
      })()
    })
    return () => {
      offStart()
      offError()
    }
  }, [showPrompt])

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

  const handleChipClick = useCallback(async () => {
    if (!prompt || chatRunning) return
    setChatRunning(true)
    setPhase("loading")
    setAnswer("")
    setActivityLabel("正在检索知识库…")
    await setPopupSize(SELECTION_CHAT_SIZE.width, SELECTION_CHAT_SIZE.height)

    try {
      const result = await runSelectionKnowledgeChat({
        text: prompt.text,
        kbaseId: prompt.kbaseId,
        kbaseName: prompt.kbaseName,
        onToken: (content) => {
          setAnswer(content)
          setPhase("loading")
        },
        onActivity: (label) => {
          setActivityLabel(label)
        },
      })
      setAnswer(result.content)
      setPhase("answer")
      setActivityLabel(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setPhase("error")
    } finally {
      setChatRunning(false)
    }
  }, [prompt, chatRunning])

  if (phase === "idle") {
    return <div className="h-dvh bg-transparent" />
  }

  if (phase === "prompt" && prompt) {
    return (
      <div className="flex h-dvh items-stretch bg-transparent p-1">
        <SelectionKbaseChip
          kbaseName={prompt.kbaseName}
          onClick={() => void handleChipClick()}
          disabled={chatRunning}
        />
      </div>
    )
  }

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <header
        data-tauri-drag-region
        className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3"
      >
        <span className="flex-1 truncate text-xs font-medium" data-tauri-drag-region>
          {prompt?.kbaseName ?? "知识库查询"}
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

        {(phase === "loading" || (phase === "answer" && !answer)) && (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {activityLabel ?? "正在生成回答…"}
          </div>
        )}

        {error && phase === "error" && (
          <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        {answer && (phase === "loading" || phase === "answer") && (
          <div className="rounded-lg border border-border bg-card px-3 py-2">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              回答
            </p>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{answer}</p>
          </div>
        )}
      </div>
    </div>
  )
}
