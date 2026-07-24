"use client"

import { useEffect, useState, useCallback, useMemo } from "react"
import { Loader2, Terminal, Filter, Download, Search } from "lucide-react"
import { getAuditLog, isTauri, type AuditEntry } from "@/lib/tauri-api"
import { timeAgo } from "@/lib/format"

export function AuditPanel({ sessionId }: { sessionId?: string }) {
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [filterText, setFilterText] = useState("")
  const [filterFailedOnly, setFilterFailedOnly] = useState(false)
  const [filterSandboxed, setFilterSandboxed] = useState<boolean | null>(null)

  useEffect(() => {
    if (!sessionId || !isTauri()) {
      setEntries([])
      return
    }
    let cancelled = false
    setLoading(true)
    getAuditLog(sessionId, 100)
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

  const filtered = useMemo(() => {
    let result = entries
    if (filterText) {
      const lower = filterText.toLowerCase()
      result = result.filter(
        (e) =>
          e.command.toLowerCase().includes(lower) ||
          e.cwd.toLowerCase().includes(lower),
      )
    }
    if (filterFailedOnly) {
      result = result.filter((e) => e.exitCode !== 0)
    }
    if (filterSandboxed !== null) {
      result = result.filter((e) => e.sandboxed === filterSandboxed)
    }
    return result
  }, [entries, filterText, filterFailedOnly, filterSandboxed])

  const exportCsv = useCallback(() => {
    const header = "Timestamp,Command,CWD,ExitCode,DurationMs,Sandboxed,Stderr"
    const rows = filtered.map((e) =>
      [
        e.createdAt,
        `"${e.command.replace(/"/g, '""')}"`,
        `"${e.cwd.replace(/"/g, '""')}"`,
        e.exitCode,
        e.durationMs,
        e.sandboxed ? "yes" : "no",
        `"${(e.stderr ?? "").replace(/"/g, '""').slice(0, 500)}"`,
      ].join(","),
    )
    const csv = [header, ...rows].join("\n")
    const blob = new Blob([csv], { type: "text/csv" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `audit-log-${sessionId?.slice(0, 8) ?? "export"}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [filtered, sessionId])

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

  const totalCommands = entries.length
  const failedCommands = entries.filter((e) => e.exitCode !== 0).length

  return (
    <div className="flex flex-col h-full">
      {entries.length > 0 && (
        <div className="border-b border-border p-2 space-y-2">
          <div className="flex items-center gap-1">
            <Search className="size-3 text-muted-foreground" />
            <input
              type="text"
              placeholder="过滤命令或路径…"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              className="flex-1 rounded border border-border bg-muted/30 px-2 py-1 font-mono text-xs text-foreground placeholder:text-muted-foreground"
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={filterFailedOnly}
                  onChange={(e) => setFilterFailedOnly(e.target.checked)}
                  className="size-3 rounded"
                />
                仅失败
              </label>
              <select
                value={filterSandboxed === null ? "all" : filterSandboxed ? "sandboxed" : "unsandboxed"}
                onChange={(e) => {
                  const v = e.target.value
                  setFilterSandboxed(v === "all" ? null : v === "sandboxed")
                }}
                className="rounded border border-border bg-muted/30 px-1.5 py-0.5 text-[10px] text-foreground"
              >
                <option value="all">全部</option>
                <option value="sandboxed">沙箱</option>
                <option value="unsandboxed">非沙箱</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground">
                {totalCommands} 条 · {failedCommands} 失败
              </span>
              <button
                type="button"
                onClick={exportCsv}
                className="flex items-center gap-1 rounded p-1 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
                title="导出 CSV"
              >
                <Download className="size-3" />
                CSV
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="px-3 py-8 text-center text-xs text-muted-foreground">
            {entries.length === 0 ? "本会话暂无 Shell 命令审计记录。" : "无匹配记录。"}
          </p>
        ) : (
          <div className="space-y-1 p-2">
            {filtered.map((e) => (
              <div key={e.id} className="rounded border border-border p-2 text-xs">
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
        )}
      </div>
    </div>
  )
}
