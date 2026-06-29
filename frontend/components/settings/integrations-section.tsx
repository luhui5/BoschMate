"use client"

import { useState } from "react"
import { GitBranch, Terminal, Boxes, Puzzle } from "lucide-react"
import { cn } from "@/lib/utils"
import { skills as seedSkills } from "@/lib/mock-data"
import type { Skill } from "@/lib/types"
import { SectionHeader, SettingsCard } from "./primitives"
import { Switch } from "@/components/ui/switch"

const SOURCE_LABEL: Record<Skill["source"], string> = {
  builtin: "内置",
  registry: "注册表",
  local: "本地",
}

export function IntegrationsSection() {
  const [skills, setSkills] = useState<Skill[]>(seedSkills)

  function toggle(id: string) {
    setSkills((prev) => prev.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s)))
  }

  return (
    <div className="space-y-6">
      <SectionHeader title="集成" desc="连接 Git、终端与 MCP 工具，管理 Agent 可调用的技能。" />

      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          连接
        </p>
        <SettingsCard>
          <ConnectionRow icon={GitBranch} title="Git" detail="已连接 · origin/main" connected />
          <ConnectionRow icon={Terminal} title="集成终端" detail="zsh · /Users/dev" connected />
          <ConnectionRow icon={Boxes} title="MCP 服务器" detail="2 个已连接" connected />
        </SettingsCard>
      </div>

      <div>
        <p className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          <Puzzle className="h-3.5 w-3.5" /> 技能 ({skills.filter((s) => s.enabled).length}/{skills.length} 启用)
        </p>
        <SettingsCard>
          {skills.map((s) => (
            <div
              key={s.id}
              className="flex items-center justify-between gap-4 border-b border-border px-4 py-3 last:border-b-0"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <code className="font-mono text-sm font-medium">{s.name}</code>
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                    {SOURCE_LABEL[s.source]}
                  </span>
                  <span className="text-[11px] text-muted-foreground">v{s.version}</span>
                </div>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">{s.description}</p>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {s.permissions.map((p) => (
                    <span
                      key={p}
                      className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-400"
                    >
                      {p}
                    </span>
                  ))}
                </div>
              </div>
              <Switch checked={s.enabled} onCheckedChange={() => toggle(s.id)} />
            </div>
          ))}
        </SettingsCard>
      </div>
    </div>
  )
}

function ConnectionRow({
  icon: Icon,
  title,
  detail,
  connected,
}: {
  icon: typeof GitBranch
  title: string
  detail: string
  connected?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border px-4 py-3.5 last:border-b-0">
      <div className="flex items-center gap-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <Icon className="h-4 w-4" />
        </span>
        <div>
          <p className="text-sm font-medium">{title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>
        </div>
      </div>
      <span
        className={cn(
          "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
          connected ? "bg-emerald-500/15 text-emerald-400" : "bg-muted text-muted-foreground",
        )}
      >
        <span className={cn("h-1.5 w-1.5 rounded-full", connected ? "bg-emerald-400" : "bg-muted-foreground")} />
        {connected ? "已连接" : "未连接"}
      </span>
    </div>
  )
}
