"use client"

import { useCallback, useEffect, useState } from "react"
import type { FileNode, GitFile } from "@/lib/types"
import { sidebarFeatures } from "@/lib/ui-features"
import { gitStatus, isTauri, listDirectoryTree } from "@/lib/tauri-api"

export function useProjectWorkspace(
  projectId: string | null,
  localPath: string | null,
  initialBranch = "main",
) {
  const [fileTree, setFileTree] = useState<FileNode[]>([])
  const [fileTreeLoading, setFileTreeLoading] = useState(false)
  const [gitFiles, setGitFiles] = useState<GitFile[]>([])
  const [gitBranch, setGitBranch] = useState(initialBranch)
  const [gitError, setGitError] = useState<string | null>(null)

  const refreshGit = useCallback(async () => {
    if (!sidebarFeatures.git || !isTauri() || !projectId) return
    try {
      const status = await gitStatus(projectId)
      setGitFiles(status.files)
      setGitBranch(status.branch)
      setGitError(null)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setGitFiles([])
      setGitError(msg)
    }
  }, [projectId])

  const refreshFileTree = useCallback(async () => {
    if (!isTauri() || !projectId || !localPath) return
    setFileTreeLoading(true)
    try {
      const nodes = await listDirectoryTree(projectId, localPath)
      setFileTree(nodes)
    } catch {
      setFileTree([])
    } finally {
      setFileTreeLoading(false)
    }
  }, [projectId, localPath])

  const loadTreeChildren = useCallback(
    async (dirPath: string) => {
      if (!projectId || !localPath) return []
      return listDirectoryTree(projectId, localPath, dirPath)
    },
    [projectId, localPath],
  )

  useEffect(() => {
    if (!projectId) {
      setFileTree([])
      setGitFiles([])
      setGitError(null)
      return
    }
    if (sidebarFeatures.git) void refreshGit()
    if (localPath) {
      void refreshFileTree()
    } else {
      setFileTree([])
    }
  }, [projectId, localPath, refreshFileTree, refreshGit])

  return {
    fileTree,
    setFileTree,
    fileTreeLoading,
    gitFiles,
    gitBranch,
    setGitBranch,
    gitError,
    refreshGit,
    refreshFileTree,
    loadTreeChildren,
  }
}
