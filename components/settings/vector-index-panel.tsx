"use client"

import { useEffect, useState } from "react"
import { Loader2, Database, RotateCcw, CheckCircle2, AlertTriangle } from "lucide-react"
import { isTauri, getVectorIndexMeta, rebuildVectorIndex, type VectorIndexMeta } from "@/lib/tauri-api"
import { Button } from "@/components/ui/button"

export function VectorIndexPanel() {
  const [metas, setMetas] = useState<VectorIndexMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [rebuilding, setRebuilding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    if (!isTauri()) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const data = await getVectorIndexMeta()
      setMetas(data)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const handleRebuild = async (projectId?: string | null) => {
    if (!isTauri()) return
    setRebuilding(true)
    setError(null)
    try {
      await rebuildVectorIndex(projectId ?? undefined)
      await load()
    } catch (e) {
      setError(String(e))
    } finally {
      setRebuilding(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        加载索引状态…
      </div>
    )
  }

  return (
    <div className="space-y-3 p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Database className="size-4 text-muted-foreground" />
          <span className="text-sm font-medium">向量索引</span>
        </div>
        <Button
          size="sm"
          variant="ghost"
          disabled={rebuilding}
          onClick={() => handleRebuild(null)}
          className="gap-1"
        >
          {rebuilding ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <RotateCcw className="size-3" />
          )}
          重建
        </Button>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertTriangle className="size-3.5 shrink-0" />
          {error}
        </div>
      )}

      {metas.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {isTauri() ? "暂无索引数据。" : "浏览器模式下不可用。"}
        </p>
      ) : (
        <div className="space-y-2">
          {metas.map((meta) => (
            <div
              key={meta.id}
              className="rounded-lg border border-border p-3"
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-mono text-xs font-medium">
                  {meta.projectId ?? "全局索引"}
                </span>
                <span
                  className={
                    meta.status === "ok"
                      ? "text-emerald-400"
                      : "text-destructive"
                  }
                >
                  {meta.status === "ok" ? (
                    <CheckCircle2 className="size-3.5" />
                  ) : (
                    <AlertTriangle className="size-3.5" />
                  )}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1 text-[10px] text-muted-foreground">
                <span>维度: {meta.dimension}</span>
                <span>条目: {meta.entryCount}</span>
                <span>后端: {meta.backend}</span>
                {meta.lastRebuildAt && (
                  <span className="col-span-2">
                    上次重建: {new Date(meta.lastRebuildAt).toLocaleString()}
                  </span>
                )}
              </div>
              <div className="mt-2">
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={rebuilding}
                  onClick={() => handleRebuild(meta.projectId)}
                >
                  重建此索引
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
