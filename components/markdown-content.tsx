"use client"

import { cn } from "@/lib/utils"

type Block =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; text: string }
  | { type: "code"; lang?: string; code: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "hr" }
  | { type: "table"; headers: string[]; rows: string[][] }

function parseTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim())
}

function isTableRow(line: string): boolean {
  const t = line.trim()
  return t.includes("|") && !isTableSeparator(t)
}

function isTableSeparator(line: string): boolean {
  const cells = parseTableRow(line)
  if (cells.length === 0) return false
  return cells.every((cell) => /^:?-{3,}:?$/.test(cell))
}

function parseBlocks(text: string): Block[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n")
  const blocks: Block[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()

    if (trimmed.startsWith("```")) {
      const lang = trimmed.slice(3).trim() || undefined
      const codeLines: string[] = []
      i += 1
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i])
        i += 1
      }
      blocks.push({ type: "code", lang, code: codeLines.join("\n") })
      if (i < lines.length) i += 1
      continue
    }

    if (/^(\*{3,}|-{3,}|_{3,})$/.test(trimmed)) {
      blocks.push({ type: "hr" })
      i += 1
      continue
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/)
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2] })
      i += 1
      continue
    }

    if (/^[-*+]\s/.test(trimmed)) {
      const items: string[] = []
      while (i < lines.length && /^[-*+]\s/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*+]\s/, ""))
        i += 1
      }
      blocks.push({ type: "ul", items })
      continue
    }

    if (/^\d+\.\s/.test(trimmed)) {
      const items: string[] = []
      while (i < lines.length && /^\d+\.\s/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s/, ""))
        i += 1
      }
      blocks.push({ type: "ol", items })
      continue
    }

    if (
      isTableRow(trimmed) &&
      i + 1 < lines.length &&
      isTableSeparator(lines[i + 1].trim())
    ) {
      const headers = parseTableRow(trimmed)
      i += 2
      const rows: string[][] = []
      while (i < lines.length) {
        const rowLine = lines[i].trim()
        if (!isTableRow(rowLine) || isTableSeparator(rowLine)) break
        rows.push(parseTableRow(rowLine))
        i += 1
      }
      blocks.push({ type: "table", headers, rows })
      continue
    }

    if (trimmed === "") {
      i += 1
      continue
    }

    const paraLines: string[] = []
    while (i < lines.length) {
      const l = lines[i]
      const t = l.trim()
      if (t === "") break
      if (t.startsWith("```")) break
      if (/^(#{1,6})\s/.test(t)) break
      if (/^(\*{3,}|-{3,}|_{3,})$/.test(t)) break
      if (/^[-*+]\s/.test(t)) break
      if (/^\d+\.\s/.test(t)) break
      if (isTableRow(t)) break
      paraLines.push(l)
      i += 1
    }
    if (paraLines.length > 0) {
      blocks.push({ type: "paragraph", text: paraLines.join("\n") })
    }
  }

  return blocks
}

function inline(text: string, onOpenFile?: (path: string) => void) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|@[^\s`,]+)/g)
  return parts.map((p, i) => {
    if (p.startsWith("@") && onOpenFile) {
      const path = p.slice(1)
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

function renderBlock(block: Block, key: number, onOpenFile?: (path: string) => void) {
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

export function MarkdownContent({
  content,
  onOpenFile,
  className,
}: {
  content: string
  onOpenFile?: (path: string) => void
  className?: string
}) {
  const blocks = parseBlocks(content)
  return (
    <div className={cn("flex flex-col gap-1.5 text-left", className)}>
      {blocks.map((block, i) => renderBlock(block, i, onOpenFile))}
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
