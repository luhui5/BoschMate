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
  const [gitError, setGitError] = useState<string | null>(null)

  const refreshGit = useCallback(async () => {
    if (!isTauri() || !projectId) return
    try {
      const status = await gitStatus(projectId)
      setGitFiles(status.files)
      setGitBranch(status.branch)
      setGitError(null)
      // #region agent log
      fetch('http://127.0.0.1:7825/ingest/63a9e25e-66bf-4bb3-bf86-ab3d44a823dd',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'5822a1'},body:JSON.stringify({sessionId:'5822a1',location:'use-project-workspace.ts:refreshGit',message:'git status ok',data:{projectId,localPath,fileCount:status.files.length,staged:status.files.filter(f=>f.staged).length,branch:status.branch},hypothesisId:'A,B',timestamp:Date.now()})}).catch(()=>{});
      // #endregion
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setGitFiles([])
      setGitError(msg)
      // #region agent log
      fetch('http://127.0.0.1:7825/ingest/63a9e25e-66bf-4bb3-bf86-ab3d44a823dd',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'5822a1'},body:JSON.stringify({sessionId:'5822a1',location:'use-project-workspace.ts:refreshGit:catch',message:'git status failed',data:{projectId,localPath,error:msg},hypothesisId:'A,B',timestamp:Date.now()})}).catch(()=>{});
      // #endregion
    }
  }, [projectId, localPath])

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
    void refreshGit()
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
