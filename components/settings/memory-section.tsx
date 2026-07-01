"use client"

import { useState } from "react"
import { Lock, Trash2, Search, Database, Layers } from "lucide-react"
import { cn } from "@/lib/utils"
import { memories as seedMemories } from "@/lib/mock-data"
import type { Memory, MemoryType } from "@/lib/types"
import { timeAgo } from "@/lib/format"
import { SectionHeader, SettingsCard, SettingRow, Select } from "./primitives"
import { Switch } from "@/components/ui/switch"
import { Input } from "@/components/ui/input"
import { useSetting } from "@/lib/use-setting"

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
  const [memories, setMemories] = useState<Memory[]>(seedMemories)
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState<MemoryType | "all">("all")
  const [autoCompress, setAutoCompress] = useSetting("memory_auto_compress", true)

  const filtered = memories.filter(
    (m) =>
      (filter === "all" || m.type === filter) &&
      m.content.toLowerCase().includes(query.toLowerCase()),
  )

  function remove(id: string) {
    setMemories((prev) => prev.filter((m) => m.id !== id))
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        title="记忆管理"
        desc="Agent 的长期记忆存储在本地 SQLite + 向量索引中。你可以审查、检索与删除任意条目。"
      />

      <div className="grid grid-cols-3 gap-3">
        <StatCard icon={Database} label="记忆条目" value={String(memories.length)} />
        <StatCard icon={Layers} label="向量维度" value="768" />
        <StatCard icon={Lock} label="加密条目" value={String(memories.filter((m) => m.encrypted).length)} />
      </div>

      <SettingsCard>
        <SettingRow title="自动压缩" desc="周期性聚合相似记忆，折叠过旧的版本链以节省空间">
          <Switch checked={autoCompress} onCheckedChange={setAutoCompress} />
        </SettingRow>
        <SettingRow title="检索阈值" desc="相似度高于该值的记忆才会注入上下文">
          <Select
            value="0.78"
            onChange={() => {}}
            options={[
              { value: "0.7", label: "0.70 (宽松)" },
              { value: "0.78", label: "0.78 (默认)" },
              { value: "0.85", label: "0.85 (严格)" },
            ]}
          />
        </SettingRow>
      </SettingsCard>

      <div>
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="语义检索记忆…"
              className="h-8 pl-8 text-sm"
            />
          </div>
          <div className="flex gap-1">
            {(["all", "fact", "behavior", "interaction", "plan"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setFilter(t)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                  filter === t
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t === "all" ? "全部" : TYPE_LABEL[t]}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          {filtered.map((m) => (
            <div
              key={m.id}
              className="group rounded-lg border border-border bg-card p-3 transition-colors hover:border-ring"
            >
              <div className="mb-2 flex items-center gap-2">
                <span
                  className={cn(
                    "rounded px-1.5 py-0.5 text-[11px] font-medium",
                    TYPE_COLOR[m.type],
                  )}
                >
                  {TYPE_LABEL[m.type]}
                </span>
                {m.encrypted && (
                  <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <Lock className="h-3 w-3" /> 已加密
                  </span>
                )}
                <span className="text-[11px] text-muted-foreground">v{m.version}</span>
                <span className="ml-auto text-[11px] text-muted-foreground">
                  调用 {m.accessCount} 次 · {timeAgo(m.lastAccessedAt ?? m.createdAt)}
                </span>
                <button
                  onClick={() => remove(m.id)}
                  className="opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                  aria-label="删除记忆"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              <p className="text-sm leading-relaxed text-foreground/90">{m.content}</p>
              <div className="mt-2 flex items-center gap-2">
                <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${m.importance * 100}%` }}
                  />
                </div>
                <span className="text-[11px] tabular-nums text-muted-foreground">
                  重要度 {(m.importance * 100).toFixed(0)}%
                </span>
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">没有匹配的记忆条目</p>
          )}
        </div>
      </div>
    </div>
  )
}

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Database
  label: string
  value: string
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <Icon className="h-4 w-4 text-muted-foreground" />
      <p className="mt-2 text-xl font-semibold tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  )
}
