/**
 * Pick a local folder and open it as a coding project (Tauri).
 */

import type { Project } from "@/lib/types"
import { isTauri, pickFolder, listProjects, createProject, openProject } from "@/lib/tauri-api"

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase()
}

export function projectNameFromPath(folder: string): string {
  const trimmed = folder.replace(/[/\\]+$/, "")
  return trimmed.split(/[/\\]/).filter(Boolean).pop() ?? "project"
}

/** Open folder picker → create or reuse project → return opened project row. */
export async function pickAndOpenLocalProject(): Promise<Project | null> {
  if (!isTauri()) {
    throw new Error("请在桌面应用中使用此功能")
  }

  const folder = await pickFolder()
  if (!folder) return null

  const norm = normalizePath(folder)
  const existing = (await listProjects()).find((p) => normalizePath(p.localPath) === norm)

  if (existing) {
    return openProject(existing.id)
  }

  const created = await createProject({
    name: projectNameFromPath(folder),
    local_path: folder,
  })
  return openProject(created.id)
}
