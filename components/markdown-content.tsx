"use client"

import { memo, useEffect, useMemo, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import { isLikelyFileRef } from "@/lib/workspace-utils"
import { splitStreamingMarkdown } from "@/lib/markdown-streaming"
import { parseBlocks } from "@/lib/markdown-blocks"
import type { MarkdownBlock } from "@/lib/markdown-blocks"

/** Debounce stable-block parse during stream to avoid main-thread freeze. */
const STABLE_PARSE_DEBOUNCE_MS = 250
/** Beyond this length, freeze stable parse during stream; tail stays plain until done. */
const STREAM_PARSE_FREEZE_LEN = 4500
/** Max content length to render without truncation (non-streaming). */
const MAX_RENDER_LENGTH = 30_000
/** Max tail length shown during streaming to keep DOM light. */
const MAX_STREAMING_TAIL_LEN = 12_000

function inline(text: string, onOpenFile?: (path: string) => void) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|@[^\s`,]+)/g)
  return parts.map((p, i) => {
    if (p.startsWith("@") && onOpenFile) {
      const path = p.slice(1)
      if (!isLikelyFileRef(path)) return p
      return (
        <button
          key={i}
          type="button"
          onClick={() => onOpenFile(path)}
          className="font-mono text-primary underline-offset-2 hover:underline"
        >
          {p}
        </button>
      )
    }
    if (p.startsWith("`") && p.endsWith("`")) {
      return (
        <code
          key={i}
          className="rounded bg-secondary px-1 py-0.5 font-mono text-[0.85em] text-primary"
        >
          {p.slice(1, -1)}
        </code>
      )
    }
    if (p.startsWith("**") && p.endsWith("**")) {
      return (
        <strong key={i} className="font-semibold">
          {p.slice(2, -2)}
        </strong>
      )
    }
    return p
  })
}

const headingClass: Record<number, string> = {
  1: "mt-3 mb-2 text-lg font-bold text-foreground",
  2: "mt-3 mb-1.5 text-base font-semibold text-foreground",
  3: "mt-2 mb-1 text-sm font-semibold text-foreground",
  4: "mt-2 mb-1 text-sm font-medium text-foreground",
  5: "mt-1.5 mb-0.5 text-xs font-medium text-foreground",
  6: "mt-1.5 mb-0.5 text-xs font-medium text-muted-foreground",
}

function renderBlock(block: MarkdownBlock, key: number, onOpenFile?: (path: string) => void) {
  switch (block.type) {
    case "heading": {
      const className = headingClass[block.level] ?? headingClass[3]
      return (
        <p key={key} className={className}>
          {inline(block.text, onOpenFile)}
        </p>
      )
    }
    case "paragraph":
      return (
        <p key={key} className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
          {inline(block.text, onOpenFile)}
        </p>
      )
    case "code":
      return (
        <div key={key} className="my-2 overflow-hidden rounded-md border border-border bg-muted/40">
          {block.lang && (
            <div className="border-b border-border/60 px-3 py-1 font-mono text-[10px] text-muted-foreground">
              {block.lang}
            </div>
          )}
          <pre className="overflow-x-auto p-3 font-mono text-xs leading-relaxed text-foreground/90">
            <code>{block.code}</code>
          </pre>
        </div>
      )
    case "ul":
      return (
        <ul key={key} className="my-1 list-disc space-y-1 pl-5 text-sm leading-relaxed text-foreground/90">
          {block.items.map((item, idx) => (
            <li key={idx}>{inline(item, onOpenFile)}</li>
          ))}
        </ul>
      )
    case "ol":
      return (
        <ol key={key} className="my-1 list-decimal space-y-1 pl-5 text-sm leading-relaxed text-foreground/90">
          {block.items.map((item, idx) => (
            <li key={idx}>{inline(item, onOpenFile)}</li>
          ))}
        </ol>
      )
    case "hr":
      return <hr key={key} className="my-3 border-border" />
    case "table":
      return (
        <div key={key} className="my-2 overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[240px] border-collapse text-sm">
            <thead>
              <tr className="bg-muted/40">
                {block.headers.map((header, hi) => (
                  <th
                    key={hi}
                    className="border-b border-border px-3 py-2 text-left text-xs font-semibold text-foreground"
                  >
                    {inline(header, onOpenFile)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, ri) => (
                <tr key={ri} className={ri % 2 === 1 ? "bg-muted/15" : undefined}>
                  {block.headers.map((_, ci) => (
                    <td
                      key={ci}
                      className="border-b border-border/60 px-3 py-2 text-xs leading-relaxed text-foreground/90 last:border-b-0"
                    >
                      {inline(row[ci] ?? "", onOpenFile)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    default:
      return null
  }
}

const StableMarkdownBlocks = memo(function StableMarkdownBlocks({
  stableText,
  onOpenFile,
}: {
  stableText: string
  onOpenFile?: (path: string) => void
}) {
  const blocks = useMemo(() => parseBlocks(stableText), [stableText])
  if (blocks.length === 0) return null
  return <>{blocks.map((block, i) => renderBlock(block, i, onOpenFile))}</>
})

function StreamingCursor() {
  return (
    <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-primary align-middle" />
  )
}

function useDebouncedStableText(stableText: string, streaming: boolean, contentLen: number) {
  const [debounced, setDebounced] = useState(stableText)
  const frozenRef = useRef(false)

  useEffect(() => {
    if (!streaming) {
      frozenRef.current = false
      setDebounced(stableText)
      return
    }
    if (contentLen > STREAM_PARSE_FREEZE_LEN) {
      if (!frozenRef.current) {
        frozenRef.current = true
        setDebounced(stableText)
      }
      return
    }
    frozenRef.current = false
    const timer = window.setTimeout(() => setDebounced(stableText), STABLE_PARSE_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [stableText, streaming, contentLen])

  return debounced
}

function streamingPendingPlain(content: string, formattedStable: string): string {
  if (!formattedStable) return content
  if (content.startsWith(formattedStable)) {
    const rest = content.slice(formattedStable.length)
    return rest.startsWith("\n") ? rest.slice(1) : rest
  }
  return content
}

export function MarkdownContent({
  content,
  onOpenFile,
  className,
  streaming = false,
}: {
  content: string
  onOpenFile?: (path: string) => void
  className?: string
  /** When true, complete blocks are formatted (debounced); pending tail stays plain text. */
  streaming?: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  // Reset expanded when content changes (new message)
  useEffect(() => {
    setExpanded(false)
  }, [content])

  const liveSplit = useMemo(() => {
    if (!streaming) return { stableText: content, tail: "" }
    return splitStreamingMarkdown(content)
  }, [content, streaming])

  const debouncedStable = useDebouncedStableText(
    liveSplit.stableText,
    streaming,
    content.length,
  )

  const pendingPlain = useMemo(() => {
    if (!streaming) return ""
    const raw = streamingPendingPlain(content, debouncedStable)
    // Limit streaming tail length to avoid huge DOM nodes
    if (raw.length <= MAX_STREAMING_TAIL_LEN) return raw
    return raw.slice(raw.length - MAX_STREAMING_TAIL_LEN)
  }, [content, debouncedStable, streaming])

  const truncated = !streaming && !expanded && content.length > MAX_RENDER_LENGTH

  const renderContent = useMemo(() => {
    if (!streaming && !truncated) return content
    if (truncated) return content.slice(0, MAX_RENDER_LENGTH)
    return ""
  }, [content, streaming, truncated])

  const completeBlocks = useMemo(
    () => (!streaming ? parseBlocks(renderContent) : null),
    [renderContent, streaming],
  )

  if (!streaming) {
    return (
      <div className={cn("flex flex-col gap-1.5 text-left", className)}>
        {completeBlocks!.map((block, i) => renderBlock(block, i, onOpenFile))}
        {truncated && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="self-start rounded-md border border-border bg-muted/40 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            展开全部（共 {Math.round(content.length / 1024)} KB）
          </button>
        )}
      </div>
    )
  }

  return (
    <div className={cn("flex flex-col gap-1.5 text-left", className)}>
      <StableMarkdownBlocks stableText={debouncedStable} onOpenFile={onOpenFile} />
      {pendingPlain.length > 0 ? (
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
          {pendingPlain}
          <StreamingCursor />
        </p>
      ) : (
        <StreamingCursor />
      )}
    </div>
  )
}

/** Inline-only rendering for user bubbles (no block markdown). */
export function MarkdownInline({
  content,
  onOpenFile,
}: {
  content: string
  onOpenFile?: (path: string) => void
}) {
  return <>{inline(content, onOpenFile)}</>
}
