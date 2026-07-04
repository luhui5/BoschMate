/** Collapse long runs of context lines for diff performance. */
import type { DiffLine } from '@/lib/types'

export type DisplayDiffRow =
  | { kind: 'line'; line: DiffLine; index: number }
  | { kind: 'collapsed'; count: number; startIndex: number }

const CONTEXT_COLLAPSE_THRESHOLD = 6

export function buildDisplayRows(lines: DiffLine[]): DisplayDiffRow[] {
  const rows: DisplayDiffRow[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.type !== 'context') {
      rows.push({ kind: 'line', line, index: i })
      i++
      continue
    }
    let j = i
    while (j < lines.length && lines[j].type === 'context') j++
    const runLen = j - i
    if (runLen > CONTEXT_COLLAPSE_THRESHOLD) {
      rows.push({ kind: 'line', line: lines[i], index: i })
      rows.push({ kind: 'collapsed', count: runLen - 2, startIndex: i + 1 })
      rows.push({ kind: 'line', line: lines[j - 1], index: j - 1 })
      i = j
    } else {
      for (let k = i; k < j; k++) {
        rows.push({ kind: 'line', line: lines[k], index: k })
      }
      i = j
    }
  }
  return rows
}

export function expandCollapsedRows(
  lines: DiffLine[],
  rows: DisplayDiffRow[],
  collapsedStartIndex: number,
): DisplayDiffRow[] {
  const collapsed = rows.find(
    (r) => r.kind === 'collapsed' && r.startIndex === collapsedStartIndex,
  )
  if (!collapsed || collapsed.kind !== 'collapsed') return rows

  const out: DisplayDiffRow[] = []
  for (const row of rows) {
    if (row.kind === 'collapsed' && row.startIndex === collapsedStartIndex) {
      for (let i = row.startIndex; i < row.startIndex + row.count; i++) {
        out.push({ kind: 'line', line: lines[i], index: i })
      }
    } else {
      out.push(row)
    }
  }
  return out
}

const FILE_REF_EXT =
  /\.(tsx?|jsx?|rs|py|go|md|json|yaml|yml|toml|css|html|vue|svelte|bat|sh|ps1|cmd|sql|txt|xml|java|kt|swift|c|cpp|h|hpp)$/i

/** True when a string plausibly names a workspace file (excludes @echo off false positives). */
export function isLikelyFileRef(ref: string): boolean {
  const t = ref.trim()
  if (!t) return false
  return t.includes("/") || FILE_REF_EXT.test(t)
}

function stripFencedCodeBlocks(text: string): string {
  return text.replace(/```[\s\S]*?```/g, "")
}

/** Extract @path and bare file paths from message text. */
export function extractFileRefs(text: string): string[] {
  const refs = new Set<string>()
  const scanText = stripFencedCodeBlocks(text)
  const atPattern = /@([^\s@`]+(?:\/[^\s@`,]+)*)/g
  let m: RegExpExecArray | null
  while ((m = atPattern.exec(scanText)) !== null) {
    if (isLikelyFileRef(m[1])) refs.add(m[1])
  }
  const pathPattern =
    /(?:^|\s)((?:[\w.-]+\/)+[\w.-]+\.(?:tsx?|jsx?|rs|py|go|md|json|yaml|yml|toml|css|html|vue|svelte|bat|sh|ps1|cmd))(?:\s|$|[,.])/g
  while ((m = pathPattern.exec(scanText)) !== null) {
    refs.add(m[1])
  }
  return Array.from(refs)
}

export function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
