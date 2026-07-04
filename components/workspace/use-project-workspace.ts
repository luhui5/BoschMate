"use client"

import { useCallback, useEffect, useState } from "react"
import type { FileNode, GitFile } from "@/lib/types"
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

  const refreshGit = useCallback(async () => {
    if (!isTauri() || !projectId) return
    try {
      const status = await gitStatus(projectId)
      setGitFiles(status.files)
      setGitBranch(status.branch)
    } catch {
      setGitFiles([])
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
    if (!projectId || !localPath) {
      setFileTree([])
      setGitFiles([])
      return
    }
    void refreshFileTree()
    void refreshGit()
  }, [projectId, localPath, refreshFileTree, refreshGit])

  return {
    fileTree,
    setFileTree,
    fileTreeLoading,
    gitFiles,
    gitBranch,
    setGitBranch,
    refreshGit,
    refreshFileTree,
    loadTreeChildren,
  }
}
