"use client"

import { useEffect, useState, useCallback } from "react"
import { GitBranch, Terminal, Boxes, Puzzle, Loader2, Trash2, Power, PowerOff } from "lucide-react"
import { cn } from "@/lib/utils"
import { isTauri, listSkills, enableSkill, disableSkill, uninstallSkill, type BackendSkill } from "@/lib/tauri-api"
import { SectionHeader, SettingsCard } from "./primitives"

export function IntegrationsSection() {
  const [skills, setSkills] = useState<BackendSkill[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const refresh = useCallback(() => {
    if (!isTauri()) {
      setLoading(false)
      return
    }
    setLoading(true)
    listSkills()
      .then((s) => { setSkills(s); setError(null) })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const handleToggle = async (skill: BackendSkill) => {
    if (!isTauri()) return
    setActionLoading(skill.name)
    try {
      if (skill.enabled) {
        await disableSkill(skill.name)
      } else {
        await enableSkill(skill.name)
      }
      await refresh()
    } catch (e) {
      setError(String(e))
    } finally {
      setActionLoading(null)
    }
  }

  const handleUninstall = async (skill: BackendSkill) => {
    if (!isTauri()) return
    setActionLoading(skill.name)
    try {
      await uninstallSkill(skill.name)
      await refresh()
    } catch (e) {
      setError(String(e))
    } finally {
      setActionLoading(null)
    }
  }

  return (
    <div className="space-y-6">
      <SectionHeader title="集成" desc="连接 Git、终端与 MCP 工具，管理 Agent 可调用的技能。" />

      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          连接
        </p>
        <SettingsCard>
          <ConnectionRow icon={GitBranch} title="Git" detail="随项目工作区自动检测" connected />
          <ConnectionRow icon={Terminal} title="集成终端" detail="Agent 沙箱内执行 shell 命令" connected />
          <ConnectionRow icon={Boxes} title="MCP 服务器" detail="即将推出" />
        </SettingsCard>
      </div>

      <div>
        <p className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          <Puzzle className="h-3.5 w-3.5" /> 技能 ({skills.length})
        </p>
        <SettingsCard>
          {loading ? (
            <div className="flex items-center justify-center gap-2 px-4 py-8 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              加载技能列表…
            </div>
          ) : error ? (
            <p className="px-4 py-8 text-center text-xs text-destructive">加载技能失败：{error}</p>
          ) : skills.length === 0 ? (
            <p className="px-4 py-8 text-center text-xs text-muted-foreground">
              {isTauri() ? "暂无已安装技能。" : "浏览器预览模式下无法加载技能，请使用桌面应用。"}
            </p>
          ) : (
            skills.map((s) => (
              <SkillRow
                key={s.name}
                skill={s}
                loading={actionLoading === s.name}
                onToggle={() => handleToggle(s)}
                onUninstall={() => handleUninstall(s)}
              />
            ))
          )}
        </SettingsCard>
      </div>
    </div>
  )
}

function SkillRow({
  skill,
  loading,
  onToggle,
  onUninstall,
}: {
  skill: BackendSkill
  loading: boolean
  onToggle: () => void
  onUninstall: () => void
}) {
  const enabled = skill.enabled !== false

  return (
    <div
      className={cn(
        "flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0",
        !enabled && "opacity-50",
      )}
    >
      <button
        type="button"
        disabled={loading}
        onClick={onToggle}
        className={cn(
          "shrink-0 rounded p-1 transition-colors hover:bg-muted",
          enabled ? "text-emerald-400" : "text-muted-foreground",
        )}
        title={enabled ? "禁用技能" : "启用技能"}
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : enabled ? (
          <Power className="h-4 w-4" />
        ) : (
          <PowerOff className="h-4 w-4" />
        )}
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <code className="font-mono text-sm font-medium">{skill.name}</code>
          {skill.version && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
              v{skill.version}
            </span>
          )}
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{skill.description}</p>
      </div>

      {skill.command && (
        <code className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
          {skill.command}
        </code>
      )}

      <button
        type="button"
        disabled={loading}
        onClick={onUninstall}
        className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
        title="卸载技能"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
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
        {connected ? "可用" : "未启用"}
      </span>
    </div>
  )
}
