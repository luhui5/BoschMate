"use client"

import { useEffect, useState } from "react"
import { Loader2, ShieldCheck } from "lucide-react"
import { listChanges, isTauri } from "@/lib/tauri-api"
import type { ChangeRecord } from "@/lib/types"

export function SessionChangesPanel({ sessionId }: { sessionId: string }) {
  const [changes, setChanges] = useState<ChangeRecord[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!isTauri() || !sessionId) return
    setLoading(true)
    listChanges(sessionId)
      .then(setChanges)
      .catch(() => setChanges([]))
      .finally(() => setLoading(false))
  }, [sessionId])

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        加载会话变更…
      </div>
    )
  }

  if (changes.length === 0) {
    return (
      <p className="px-3 py-8 text-center text-xs text-muted-foreground">
        数据库中暂无本会话的变更记录。
      </p>
    )
  }

  return (
    <div className="space-y-2 p-2">
      <p className="px-1 text-[10px] text-muted-foreground">
        变更持久化于 changes 表；已采纳项含 SHA256 备份 hash（snapshot_id）。
      </p>
      {changes.map((c) => (
        <div key={c.id} className="rounded-lg border border-border bg-card p-2 text-xs">
          <div className="flex items-center gap-2">
            <span className="truncate font-mono">{c.filePath}</span>
            <span className="ml-auto rounded bg-secondary px-1.5 py-0.5 text-[10px]">{c.status}</span>
          </div>
          {c.snapshotId && (
            <p className="mt-1 flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
              <ShieldCheck className="size-3 text-success" />
              backup: {c.snapshotId.slice(0, 12)}…
            </p>
          )}
        </div>
      ))}
    </div>
  )
}
