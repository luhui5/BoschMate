const PINNED_KEY = "bc-pinned-sessions"

function readSet(): Set<string> {
  try {
    const raw = localStorage.getItem(PINNED_KEY)
    if (!raw) return new Set()
    return new Set(JSON.parse(raw) as string[])
  } catch {
    return new Set()
  }
}

function writeSet(set: Set<string>) {
  try {
    localStorage.setItem(PINNED_KEY, JSON.stringify(Array.from(set)))
  } catch {
    /* ignore */
  }
}

export function isSessionPinned(sessionId: string): boolean {
  return readSet().has(sessionId)
}

export function toggleSessionPinned(sessionId: string): boolean {
  const set = readSet()
  if (set.has(sessionId)) set.delete(sessionId)
  else set.add(sessionId)
  writeSet(set)
  return set.has(sessionId)
}

export function sortSessionsPinnedFirst<T extends { id: string; pinned?: boolean }>(sessions: T[]): T[] {
  const pinned = readSet()
  return [...sessions].sort((a, b) => {
    const ap = a.pinned ?? pinned.has(a.id)
    const bp = b.pinned ?? pinned.has(b.id)
    if (ap !== bp) return ap ? -1 : 1
    return 0
  })
}
