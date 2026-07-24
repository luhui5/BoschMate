"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Modal } from "@/components/ui/modal"
import { Database, RotateCcw, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react"
import { isTauri, checkDatabase, repairDatabase } from "@/lib/tauri-api"

interface DbStatus {
  integrity_ok: boolean
  vector_corrupted: boolean
  vector_entries: number
}

export function DatabaseRepairDialog({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const [status, setStatus] = useState<DbStatus | null>(null)
  const [checking, setChecking] = useState(false)
  const [repairing, setRepairing] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleCheck = async () => {
    if (!isTauri()) return
    setChecking(true)
    setError(null)
    try {
      const s = await checkDatabase()
      setStatus(s)
    } catch (e) {
      setError(String(e))
    } finally {
      setChecking(false)
    }
  }

  const handleRepair = async () => {
    if (!isTauri()) return
    setRepairing(true)
    setError(null)
    try {
      const r = await repairDatabase()
      setResult(`修复完成：${r.vector_entries} 条向量记录，完整性 ${r.integrity_ok ? "✅" : "⚠️"}`)
      setStatus({
        integrity_ok: r.integrity_ok,
        vector_corrupted: false,
        vector_entries: r.vector_entries,
      })
    } catch (e) {
      setError(String(e))
    } finally {
      setRepairing(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="数据库修复向导">
      <div className="max-w-md space-y-4 py-2">
        <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/30 p-3">
          <Database className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <div className="text-sm text-muted-foreground">
            <p className="font-medium text-foreground">数据库健康检查</p>
            <p className="mt-1">
              检查 SQLite 完整性、WAL 恢复状态和向量索引健康状况。如果检测到问题，可使用修复功能。
            </p>
          </div>
        </div>

        {!status && !checking && (
          <div className="flex justify-center">
            <Button onClick={handleCheck} className="gap-2">
              <Database className="size-4" />
              检查数据库
            </Button>
          </div>
        )}

        {checking && (
          <div className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            正在检查数据库…
          </div>
        )}

        {status && (
          <div className="space-y-3">
            <div className="rounded-lg border border-border p-3 space-y-2">
              <StatusRow
                label="SQLite 完整性"
                ok={status.integrity_ok}
              />
              <StatusRow
                label="向量索引"
                ok={!status.vector_corrupted}
              />
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">向量条目数</span>
                <span className="font-mono">{status.vector_entries}</span>
              </div>
            </div>

            {(status.vector_corrupted || !status.integrity_ok) && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-400" />
                <div className="text-xs text-amber-400/90">
                  <p className="font-medium">检测到问题</p>
                  <p className="mt-0.5">
                    可尝试以下修复：WAL checkpoint → 重建索引 → 向量索引重建。修复过程中会保留原始数据。
                  </p>
                </div>
              </div>
            )}

            {result && (
              <div className="flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-400" />
                <p className="text-xs text-emerald-400/90">{result}</p>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={handleCheck} disabled={checking}>
                重新检查
              </Button>
              <Button
                size="sm"
                onClick={handleRepair}
                disabled={repairing || (status.integrity_ok && !status.vector_corrupted)}
                className="gap-1.5"
              >
                {repairing ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" />
                    修复中…
                  </>
                ) : (
                  <>
                    <RotateCcw className="size-3.5" />
                    修复数据库
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
            <p className="text-xs text-destructive">{error}</p>
          </div>
        )}

        <p className="text-[10px] text-muted-foreground">
          提示：修复过程不会删除数据，仅重建索引和日志结构。如问题仍然存在，可使用"导出备份"功能导出全部数据后重新导入。
        </p>
      </div>
    </Modal>
  )
}

function StatusRow({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className={ok ? "text-emerald-400" : "text-destructive"}>
        {ok ? "正常" : "异常"}
      </span>
    </div>
  )
}
