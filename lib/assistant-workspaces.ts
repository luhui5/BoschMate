import type { Project } from "@/lib/types"
import { ASSISTANT_PROJECT_ID } from "@/lib/constants"
import { ensureProjectForFolder } from "@/lib/assistant-project"
import {
  isAssistantDefaultWorkspacePath,
  resolveDefaultAssistantWorkspace,
  shortFolderLabel,
} from "@/lib/assistant-workspace"
import { pickAndOpenLocalProject, projectNameFromPath } from "@/lib/open-local-project"
import {
  createProject,
  ensureAssistantWorkspace,
  isTauri,
  listProjects,
  openProject,
  removeProject,
} from "@/lib/tauri-api"

export interface AssistantWorkspace {
  projectId: string
  name: string
  localPath: string
  isHome: boolean
  subtitle: string
  kind: Project["kind"]
  sshHost?: string
  openedAt: string
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase()
}

export function isHomeWorkspace(path: string): boolean {
  return isAssistantDefaultWorkspacePath(path)
}

export function workspaceDisplayName(project: Project): string {
  if (isHomeWorkspace(project.localPath)) return "Home"
  return project.name
}

export function workspaceSubtitle(project: Project): string {
  if (isHomeWorkspace(project.localPath)) return "~/.boschassistant/workspace"
  if (project.kind === "ssh" && project.sshHost) return project.sshHost
  return shortFolderLabel(project.localPath)
}

function toAssistantWorkspace(project: Project): AssistantWorkspace {
  return {
    projectId: project.id,
    name: workspaceDisplayName(project),
    localPath: project.localPath,
    isHome: isHomeWorkspace(project.localPath),
    subtitle: workspaceSubtitle(project),
    kind: project.kind,
    sshHost: project.sshHost,
    openedAt: project.openedAt,
  }
}

/** Ensure default Home workspace exists and return its project row. */
export async function ensureHomeWorkspace(): Promise<AssistantWorkspace | null> {
  if (!isTauri()) return null
  const homePath = await ensureAssistantWorkspace()
  if (!homePath) return null
  const projectId = await ensureProjectForFolder(homePath)
  const project = await openProject(projectId)
  return toAssistantWorkspace(project)
}

/** List all assistant workspaces (Home first, then by openedAt desc). */
export async function listAssistantWorkspaces(): Promise<AssistantWorkspace[]> {
  if (!isTauri()) {
    const homePath = "~/.boschassistant/workspace"
    return [
      {
        projectId: "mock-home",
        name: "Home",
        localPath: homePath,
        isHome: true,
        subtitle: "~/.boschassistant/workspace",
        kind: "local",
        openedAt: new Date().toISOString(),
      },
    ]
  }

  await ensureHomeWorkspace()
  const projects = (await listProjects()).filter((p) => p.id !== ASSISTANT_PROJECT_ID)
  const workspaces = projects.map(toAssistantWorkspace)
  workspaces.sort((a, b) => {
    if (a.isHome && !b.isHome) return -1
    if (!a.isHome && b.isHome) return 1
    return new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime()
  })
  return workspaces
}

/** Pick local folder and register as workspace. */
export async function addLocalWorkspace(): Promise<AssistantWorkspace | null> {
  const project = await pickAndOpenLocalProject()
  if (!project) return null
  return toAssistantWorkspace(project)
}

export type SshWorkspaceInput = {
  name: string
  host: string
  remotePath: string
}

/** Register SSH remote as workspace (creates DB project in Tauri). */
export async function addSshWorkspace(input: SshWorkspaceInput): Promise<AssistantWorkspace> {
  const name = input.name.trim()
  const remotePath = input.remotePath.trim() || `~/${name}`
  const now = new Date().toISOString()

  if (isTauri()) {
    const created = await createProject({
      name,
      local_path: remotePath,
    })
    const opened = await openProject(created.id)
    return {
      ...toAssistantWorkspace(opened),
      kind: "ssh",
      sshHost: input.host.trim() || "remote-host",
      subtitle: input.host.trim() || remotePath,
    }
  }

  return {
    projectId: `p${Date.now()}`,
    name,
    localPath: remotePath,
    isHome: false,
    subtitle: input.host.trim() || remotePath,
    kind: "ssh",
    sshHost: input.host.trim() || "remote-host",
    openedAt: now,
  }
}

/** Remove workspace; Home and default path are protected. */
export async function removeWorkspace(workspace: AssistantWorkspace): Promise<void> {
  if (workspace.isHome || isHomeWorkspace(workspace.localPath)) {
    throw new Error("Home 默认工作区无法删除")
  }
  if (workspace.projectId === ASSISTANT_PROJECT_ID) {
    throw new Error("内置项目无法删除")
  }
  if (isTauri()) {
    await removeProject(workspace.projectId)
  }
}

/** Resolve workspace folder path for AI tools (Home uses default when empty). */
export async function resolveWorkspaceFolder(
  workspace: AssistantWorkspace | null | undefined,
): Promise<string | null> {
  if (!workspace) return resolveDefaultAssistantWorkspace()
  if (workspace.localPath?.trim()) return workspace.localPath
  if (workspace.isHome) return resolveDefaultAssistantWorkspace()
  return null
}

/** Find workspace matching a folder path (legacy session grouping). */
export function findWorkspaceByFolder(
  workspaces: AssistantWorkspace[],
  folder: string | null | undefined,
): AssistantWorkspace | undefined {
  if (!folder?.trim()) {
    return workspaces.find((w) => w.isHome) ?? workspaces[0]
  }
  const norm = normalizePath(folder)
  return workspaces.find((w) => normalizePath(w.localPath) === norm)
}

export { projectNameFromPath, normalizePath }
