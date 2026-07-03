import type { Project } from "@/lib/types"

const PINNED_KEY = "bc-pinned-projects"

function readSet(): Set<string> {
  if (typeof window === "undefined") return new Set()
  try {
    const raw = localStorage.getItem(PINNED_KEY)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw)
    return new Set(Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [])
  } catch {
    return new Set()
  }
}

function writeSet(ids: Set<string>) {
  localStorage.setItem(PINNED_KEY, JSON.stringify([...ids]))
}

export function isProjectPinned(id: string): boolean {
  return readSet().has(id)
}

export function toggleProjectPinned(id: string): boolean {
  const set = readSet()
  if (set.has(id)) set.delete(id)
  else set.add(id)
  writeSet(set)
  return set.has(id)
}

export function applyProjectPins(projects: Project[]): Project[] {
  const pinned = readSet()
  return projects.map((p) => ({ ...p, pinned: pinned.has(p.id) }))
}

export function clearProjectPin(id: string) {
  const set = readSet()
  if (!set.has(id)) return
  set.delete(id)
  writeSet(set)
}
