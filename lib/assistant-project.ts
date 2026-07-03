/**
 * Resolve or create a DB project row for an Assistant-bound folder path.
 */

import { listProjects, createProject } from "@/lib/tauri-api"

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase()
}

export async function ensureProjectForFolder(folderPath: string): Promise<string> {
  const norm = normalizePath(folderPath)
  const projects = await listProjects()
  const existing = projects.find((p) => normalizePath(p.localPath) === norm)
  if (existing) return existing.id

  const name =
    folderPath.split(/[/\\]/).filter(Boolean).pop() ?? "workspace"

  const created = await createProject({
    name,
    local_path: folderPath,
  })
  return created.id
}
