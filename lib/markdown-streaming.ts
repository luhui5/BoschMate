import { isTableRow, isTableSeparator, parseBlocks, type MarkdownBlock } from "@/lib/markdown-blocks"

export type { MarkdownBlock }

export interface StreamingMarkdownParts {
  blocks: MarkdownBlock[]
  tail: string
}

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, "\n")
}

/** Index of line starting an unclosed ``` fence, or -1. */
function unclosedFenceOpenLine(lines: string[]): number {
  let openIdx = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().startsWith("```")) {
      if (openIdx < 0) openIdx = i
      else openIdx = -1
    }
  }
  return openIdx
}

function incompleteTableStart(lines: string[]): number {
  if (lines.length === 0) return -1
  const last = lines[lines.length - 1].trim()
  if (!isTableRow(last)) return -1

  let start = lines.length - 1
  while (start > 0) {
    const prev = lines[start - 1].trim()
    if (!isTableRow(prev) || isTableSeparator(prev)) break
    start--
  }

  const segment = lines.slice(start)
  if (segment.length === 1) return start

  if (
    segment.length === 2 &&
    isTableRow(segment[0].trim()) &&
    !isTableSeparator(segment[1].trim())
  ) {
    return start
  }

  return -1
}

function isIncompleteHeadingLine(line: string): boolean {
  const t = line.trim()
  if (!t.startsWith("#")) return false
  if (/^#{1,6}\s+\S/.test(t)) return false
  return true
}

/**
 * Split streaming markdown into parsed stable blocks and a plain-text tail.
 * Stable blocks are fully closed; the tail is rendered as plain text (+ inline) until complete.
 */
export function splitStreamingMarkdown(text: string): { stableText: string; tail: string } {
  const normalized = normalizeNewlines(text)
  if (!normalized) return { stableText: "", tail: "" }

  const lines = normalized.split("\n")

  const fenceIdx = unclosedFenceOpenLine(lines)
  if (fenceIdx >= 0) {
    return {
      stableText: lines.slice(0, fenceIdx).join("\n").replace(/\n+$/, ""),
      tail: lines.slice(fenceIdx).join("\n"),
    }
  }

  const tableIdx = incompleteTableStart(lines)
  if (tableIdx >= 0) {
    return {
      stableText: lines.slice(0, tableIdx).join("\n").replace(/\n+$/, ""),
      tail: lines.slice(tableIdx).join("\n"),
    }
  }

  const lastLine = lines[lines.length - 1]
  const lastTrimmed = lastLine.trim()

  if (isIncompleteHeadingLine(lastLine)) {
    return {
      stableText: lines.slice(0, -1).join("\n").replace(/\n+$/, ""),
      tail: lastLine,
    }
  }

  if (lastTrimmed === "") {
    const stableText = normalized.replace(/\n+$/, "")
    return { stableText, tail: "" }
  }

  if (lines.length === 1) {
    return { stableText: "", tail: normalized }
  }

  return {
    stableText: lines.slice(0, -1).join("\n"),
    tail: lastLine,
  }
}

export function parseStreamingMarkdown(text: string, streaming: boolean): StreamingMarkdownParts {
  if (!streaming) {
    return { blocks: parseBlocks(text), tail: "" }
  }
  const { stableText, tail } = splitStreamingMarkdown(text)
  return { blocks: parseBlocks(stableText), tail }
}
