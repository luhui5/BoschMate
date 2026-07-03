"use client"

import { useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { AppShell } from "@/components/shell/app-shell"
import { WorkspaceView } from "@/components/workspace/workspace-view"
import { ASSISTANT_PROJECT_ID } from "@/lib/constants"

export function HomeRouter() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const projectId = searchParams.get("project")

  useEffect(() => {
    if (projectId === ASSISTANT_PROJECT_ID) {
      router.replace("/assistant/")
    }
  }, [projectId, router])

  if (projectId === ASSISTANT_PROJECT_ID) {
    return (
      <div className="flex min-h-[calc(100vh-34px)] items-center justify-center text-sm text-muted-foreground">
        跳转 Assistant…
      </div>
    )
  }

  if (projectId) {
    return <WorkspaceView projectId={projectId} />
  }

  return <AppShell />
}
