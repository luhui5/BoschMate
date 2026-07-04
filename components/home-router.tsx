"use client"

import { useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { AppShell } from "@/components/shell/app-shell"

export function HomeRouter() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const projectId = searchParams.get("project")
  const workspaceId = searchParams.get("workspace")

  useEffect(() => {
    if (projectId) {
      const params = new URLSearchParams()
      if (workspaceId || projectId) params.set("workspace", workspaceId ?? projectId)
      const qs = params.toString()
      router.replace(qs ? `/?${qs}` : "/")
    }
  }, [projectId, workspaceId, router])

  if (projectId) {
    return (
      <div className="flex min-h-[calc(100vh-34px)] items-center justify-center text-sm text-muted-foreground">
        跳转 Assistant…
      </div>
    )
  }

  return <AppShell />
}
