"use client"

import { useEffect, useState } from "react"
import { SectionHeader, SettingsCard } from "./primitives"
import { useSetting } from "@/lib/use-setting"
import {
  DEFAULT_SELECTION_LOOKUP_SETTINGS,
  type SelectionLookupSettings,
} from "@/lib/selection-lookup"

function Keycap({ k }: { k: string }) {
  return (
    <kbd className="inline-flex h-6 min-w-6 items-center justify-center rounded-md border border-border bg-muted px-1.5 font-mono text-xs text-foreground">
      {k}
    </kbd>
  )
}

function formatShortcut(shortcut: string): string[] {
  return shortcut.split("+").map((part) => {
    const p = part.trim()
    if (p === "Ctrl" || p === "Control") return "⌃"
    if (p === "Shift") return "⇧"
    if (p === "Alt") return "⌥"
    if (p === "Meta" || p === "Command") return "⌘"
    return p
  })
}

const GROUPS: { group: string; items: { label: string; keys: string[] }[] }[] = [
  {
    group: "通用",
    items: [
      { label: "打开命令面板", keys: ["⌘", "K"] },
      { label: "全局搜索", keys: ["⌘", "P"] },
      { label: "打开设置", keys: ["⌘", ","] },
      { label: "切换主题", keys: ["⌘", "⇧", "L"] },
    ],
  },
  {
    group: "会话",
    items: [
      { label: "新建会话", keys: ["⌘", "N"] },
      { label: "发送消息", keys: ["↵"] },
      { label: "换行", keys: ["⇧", "↵"] },
      { label: "中断生成", keys: ["⌘", "."] },
      { label: "切换 Agent 模式", keys: ["⌘", "M"] },
    ],
  },
  {
    group: "代码与变更",
    items: [
      { label: "接受全部变更", keys: ["⌘", "⇧", "↵"] },
      { label: "拒绝全部变更", keys: ["⌘", "⇧", "⌫"] },
      { label: "下一处变更", keys: ["⌥", "↓"] },
      { label: "上一处变更", keys: ["⌥", "↑"] },
    ],
  },
  {
    group: "面板",
    items: [
      { label: "切换左侧栏", keys: ["⌘", "B"] },
      { label: "切换右侧栏", keys: ["⌘", "⌥", "B"] },
      { label: "聚焦文件树", keys: ["⌘", "⇧", "E"] },
      { label: "聚焦 Git 面板", keys: ["⌘", "⇧", "G"] },
    ],
  },
]

export function ShortcutsSection() {
  const [settings] = useSetting<SelectionLookupSettings>(
    "selection_lookup",
    DEFAULT_SELECTION_LOOKUP_SETTINGS,
  )
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const lookupKeys = mounted ? formatShortcut(settings.shortcut) : ["Ctrl", "Shift", "K"]

  return (
    <div className="space-y-6">
      <SectionHeader title="快捷键" desc="键盘绑定遵循 macOS 习惯，Windows / Linux 上 ⌘ 对应 Ctrl。" />
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          划词查询
        </p>
        <SettingsCard>
          <div className="flex items-center justify-between border-b border-border px-4 py-3 last:border-b-0">
            <span className="text-sm">划词知识库查询</span>
            <span className="flex items-center gap-1">
              {lookupKeys.map((k, i) => (
                <Keycap key={i} k={k} />
              ))}
            </span>
          </div>
        </SettingsCard>
      </div>
      {GROUPS.map((g) => (
        <div key={g.group}>
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {g.group}
          </p>
          <SettingsCard>
            {g.items.map((item) => (
              <div
                key={item.label}
                className="flex items-center justify-between border-b border-border px-4 py-3 last:border-b-0"
              >
                <span className="text-sm">{item.label}</span>
                <span className="flex items-center gap-1">
                  {item.keys.map((k, i) => (
                    <Keycap key={i} k={k} />
                  ))}
                </span>
              </div>
            ))}
          </SettingsCard>
        </div>
      ))}
    </div>
  )
}
