import { ensureAssistantWorkspace, isTauri } from "@/lib/tauri-api"

/** Default assistant workspace: %USERPROFILE%/.boschassistant/workspace */
export async function resolveDefaultAssistantWorkspace(): Promise<string | null> {
  if (!isTauri()) return null
  return ensureAssistantWorkspace()
}

/** Use explicit folder when set; otherwise the default workspace directory. */
export async function resolveAssistantFolder(explicit: string | null | undefined): Promise<string | null> {
  const trimmed = explicit?.trim()
  if (trimmed) return trimmed
  return resolveDefaultAssistantWorkspace()
}

/** True when path is the built-in default assistant workspace (not a coding project). */
export function isAssistantDefaultWorkspacePath(localPath: string): boolean {
  const normalized = localPath.replace(/\\/g, "/").toLowerCase().replace(/\/+$/, "")
  return normalized.endsWith("/.boschassistant/workspace")
}

export function shortFolderLabel(folder: string | null | undefined): string {
  if (!folder?.trim()) return "工作区"
  const normalized = folder.replace(/\\/g, "/")
  if (normalized.includes("/.boschassistant/workspace")) {
    return "~/.boschassistant/workspace"
  }
  const parts = normalized.split("/").filter(Boolean)
  return parts[parts.length - 1] ?? folder
}
