"use client"

import { useEffect, useState } from "react"
import { Lock, Trash2, Search, Database, Layers, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Memory, MemoryType } from "@/lib/types"
import { timeAgo } from "@/lib/format"
import { SectionHeader, SettingsCard, SettingRow, Select } from "./primitives"
import { Switch } from "@/components/ui/switch"
import { Input } from "@/components/ui/input"
import { useSetting } from "@/lib/use-setting"
import { isTauri, listProjects, listMemories, deleteMemory, searchMemories, compressMemories } from "@/lib/tauri-api"

const TYPE_LABEL: Record<MemoryType, string> = {
  fact: "事实",
  interaction: "交互",
  behavior: "行为",
  plan: "计划",
}

const TYPE_COLOR: Record<MemoryType, string> = {
  fact: "bg-sky-500/15 text-sky-400",
  interaction: "bg-violet-500/15 text-violet-300",
  behavior: "bg-emerald-500/15 text-emerald-400",
  plan: "bg-amber-500/15 text-amber-400",
}

export function MemorySection() {
  const [memories, setMemories] = useState<Memory[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState<MemoryType | "all">("all")
  const [autoCompress, setAutoCompress] = useSetting("memory_auto_compress", true)
  const [vectorDim] = useState("768")

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      if (!isTauri()) {
        setLoading(false)
        return
      }
      try {
        const projects = await listProjects()
        const all: Memory[] = []
        for (const p of projects) {
          const mems = await listMemories(p.id)
          all.push(...mems)
        }
        if (!cancelled) setMemories(all)
      } catch {
        if (!cancelled) setMemories([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  const filtered = memories.filter(
    (m) =>
      (filter === "all" || m.type === filter) &&
      m.content.toLowerCase().includes(query.toLowerCase()),
  )

  async function remove(id: string) {
    if (isTauri()) await deleteMemory(id)
    setMemories((prev) => prev.filter((m) => m.id !== id))
  }

  async function runSearch() {
    if (!isTauri() || !query.trim()) return
    const projects = await listProjects()
    const results: Memory[] = []
    for (const p of projects) {
      const found = await searchMemories(p.id, query, 20)
      results.push(...found)
    }
    setMemories(results.length ? results : memories)
  }

  async function handleCompress() {
    if (!isTauri()) return
    const projects = await listProjects()
    for (const p of projects) {
      await compressMemories(p.id)
    }
    const all: Memory[] = []
    for (const p of projects) {
      all.push(...(await listMemories(p.id)))
    }
    setMemories(all)
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        title="记忆管理"
        desc="Agent 的长期记忆存储在本地 SQLite + 向量索引中。你可以审查、检索与删除任意条目。"
      />

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> 加载记忆…
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            <StatCard icon={Database} label="记忆条目" value={String(memories.length)} />
            <StatCard icon={Layers} label="向量维度" value={vectorDim} />
            <StatCard icon={Lock} label="加密条目" value={String(memories.filter((m) => m.encrypted).length)} />
          </div>

          <SettingsCard>
            <SettingRow title="自动压缩" desc="周期性聚合相似记忆，折叠过旧的版本链以节省空间">
              <Switch checked={autoCompress} onCheckedChange={setAutoCompress} />
            </SettingRow>
            <SettingRow title="手动压缩" desc="立即触发记忆压缩">
              <button type="button" className="text-sm text-primary hover:underline" onClick={() => void handleCompress()}>
                立即压缩
              </button>
            </SettingRow>
          </SettingsCard>

          <div>
            <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void runSearch()}
                  placeholder="搜索记忆内容…"
                  className="pl-8"
                />
              </div>
              <Select
                value={filter}
                onChange={(v) => setFilter(v as MemoryType | "all")}
                options={[
                  { value: "all", label: "全部类型" },
                  { value: "fact", label: "事实" },
                  { value: "interaction", label: "交互" },
                  { value: "behavior", label: "行为" },
                  { value: "plan", label: "计划" },
                ]}
              />
            </div>

            <div className="space-y-2">
              {filtered.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">暂无记忆条目</p>
              ) : (
                filtered.map((m) => (
                  <div key={m.id} className="rounded-lg border border-border p-3">
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", TYPE_COLOR[m.type])}>
                        {TYPE_LABEL[m.type]}
                      </span>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        {m.encrypted && <Lock className="size-3" />}
                        <span>{timeAgo(m.createdAt)}</span>
                        <button type="button" onClick={() => void remove(m.id)} className="text-destructive hover:underline">
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    </div>
                    <p className="text-sm leading-relaxed">{m.summary ?? m.content}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function StatCard({ icon: Icon, label, value }: { icon: typeof Database; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="size-4" />
        <span className="text-xs">{label}</span>
      </div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
    </div>
  )
}
