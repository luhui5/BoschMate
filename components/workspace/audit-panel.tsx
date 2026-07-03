"use client"

import { useEffect, useState } from "react"
import { Loader2, Terminal } from "lucide-react"
import { getAuditLog, isTauri, type AuditEntry } from "@/lib/tauri-api"
import { timeAgo } from "@/lib/format"

export function AuditPanel({ sessionId }: { sessionId?: string }) {
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!sessionId || !isTauri()) {
      setEntries([])
      return
    }
    let cancelled = false
    setLoading(true)
    getAuditLog(sessionId, 30)
      .then((rows) => {
        if (!cancelled) setEntries(rows)
      })
      .catch(() => {
        if (!cancelled) setEntries([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [sessionId])

  if (!sessionId) {
    return (
      <p className="px-3 py-8 text-center text-xs text-muted-foreground">选择会话以查看审计日志。</p>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-12 text-xs text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> 加载审计日志…
      </div>
    )
  }

  if (entries.length === 0) {
    return (
      <p className="px-3 py-8 text-center text-xs text-muted-foreground">本会话暂无 Shell 命令审计记录。</p>
    )
  }

  return (
    <div className="space-y-2 p-2">
      {entries.map((e) => (
        <div key={e.id} className="rounded-lg border border-border p-2 text-xs">
          <div className="mb-1 flex items-center gap-2">
            <Terminal className="size-3.5 text-muted-foreground" />
            <code className="flex-1 truncate font-mono">{e.command}</code>
            <span className={e.exitCode === 0 ? "text-emerald-400" : "text-destructive"}>
              exit {e.exitCode}
            </span>
          </div>
          <div className="text-[10px] text-muted-foreground">
            {e.cwd} · {timeAgo(e.createdAt)} · {e.durationMs}ms
            {e.sandboxed ? " · 沙箱" : ""}
          </div>
          {e.stderr && (
            <pre className="mt-1 max-h-20 overflow-auto rounded bg-muted/50 p-1 font-mono text-[10px] text-destructive">
              {e.stderr.slice(0, 500)}
            </pre>
          )}
        </div>
      ))}
    </div>
  )
}
