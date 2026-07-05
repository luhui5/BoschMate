export type MarkdownBlock =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; text: string }
  | { type: "code"; lang?: string; code: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "hr" }
  | { type: "table"; headers: string[]; rows: string[][] }

export function parseTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim())
}

export function isTableRow(line: string): boolean {
  const t = line.trim()
  return t.includes("|") && !isTableSeparator(t)
}

export function isTableSeparator(line: string): boolean {
  const cells = parseTableRow(line)
  if (cells.length === 0) return false
  return cells.every((cell) => /^:?-{3,}:?$/.test(cell))
}

export function parseBlocks(text: string): MarkdownBlock[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n")
  const blocks: MarkdownBlock[] = []
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
