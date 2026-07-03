import type { DiffHunk, DiffLine } from './types'

/** Parse unified diff text into DiffHunk lines for UI rendering. */
export function parseUnifiedDiff(filePath: string, diffText: string, status: DiffHunk['status'] = 'pending'): DiffHunk {
  const lines: DiffLine[] = []
  let additions = 0
  let deletions = 0
  let oldNo = 1
  let newNo = 1

  for (const raw of diffText.split('\n')) {
    if (raw.startsWith('---') || raw.startsWith('+++') || raw.startsWith('@@')) {
      lines.push({ type: 'meta', text: raw })
      continue
    }
    if (raw.startsWith('+')) {
      additions++
      lines.push({ type: 'add', text: raw.slice(1), newNo: newNo++ })
    } else if (raw.startsWith('-')) {
      deletions++
      lines.push({ type: 'del', text: raw.slice(1), oldNo: oldNo++ })
    } else if (raw.startsWith(' ')) {
      lines.push({ type: 'context', text: raw.slice(1), oldNo: oldNo++, newNo: newNo++ })
    } else if (raw.length > 0) {
      lines.push({ type: 'context', text: raw })
    }
  }

  const ext = filePath.split('.').pop() ?? 'txt'
  return {
    filePath,
    additions,
    deletions,
    language: ext,
    lines,
    status,
  }
}

export interface RawDiffEntry {
  id?: string
  filePath?: string
  file_path?: string
  diffText?: string
  diff_text?: string
  status?: string
  additions?: number
  deletions?: number
  editMeta?: {
    path?: string
    old_string?: string
    new_string?: string
    replace_all?: boolean
  }
  snapshotId?: string
}

export function parseDiffsFromRaw(raw: unknown): DiffHunk[] | undefined {
  if (!raw) return undefined
  const arr = Array.isArray(raw) ? raw : typeof raw === 'string' ? JSON.parse(raw) : null
  if (!Array.isArray(arr)) return undefined
  return arr.map((entry: RawDiffEntry) => {
    const filePath = entry.filePath ?? entry.file_path ?? 'unknown'
    const diffText = entry.diffText ?? entry.diff_text ?? ''
    const status = (entry.status as DiffHunk['status']) ?? 'pending'
    const hunk = parseUnifiedDiff(filePath, diffText, status)
    if (entry.additions != null) hunk.additions = entry.additions
    if (entry.deletions != null) hunk.deletions = entry.deletions
    if (entry.id) hunk.changeId = entry.id
    if (entry.editMeta) hunk.editMeta = entry.editMeta
    if (entry.snapshotId) hunk.snapshotId = entry.snapshotId
    return hunk
  })
}
