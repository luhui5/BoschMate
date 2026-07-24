"use client"

import { useEffect, useState, useCallback } from "react"
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
    if (p === "Ctrl" || p === "Control") return "\u2303"
    if (p === "Shift") return "\u21E7"
    if (p === "Alt") return "\u2325"
    if (p === "Meta" || p === "Command") return "\u2318"
    return p
  })
}

const GROUPS = [
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

type CustomBinding = { label: string; keys: string[] }

function ShortcutRecorder({
  initialKeys,
  onSave,
  onCancel,
}: {
  initialKeys: string[]
  onSave: (keys: string[]) => void
  onCancel: () => void
}) {
  const [keys, setKeys] = useState<string[]>([])
  const [listening, setListening] = useState(false)

  useEffect(() => {
    if (!listening) return
    const handler = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const parts: string[] = []
      if (e.ctrlKey || e.metaKey) parts.push("Ctrl")
      if (e.shiftKey) parts.push("Shift")
      if (e.altKey) parts.push("Alt")
      const key = e.key
      if (key && !["Control", "Shift", "Alt", "Meta"].includes(key)) {
        const display =
          key === " " ? "Space" : key.length === 1 ? key.toUpperCase() : key
        parts.push(display)
      }
      if (parts.length > 0) {
        setKeys(parts)
        setListening(false)
      }
    }
    window.addEventListener("keydown", handler, true)
    return () => window.removeEventListener("keydown", handler, true)
  }, [listening])

  return (
    <div className="flex items-center gap-2">
      <span className="flex items-center gap-1">
        {keys.length > 0
          ? keys.map((k, i) => <Keycap key={i} k={k} />)
          : initialKeys.map((k, i) => <Keycap key={i} k={k} />)}
      </span>
      {listening ? (
        <span className="text-[10px] text-primary animate-pulse">按下快捷键…</span>
      ) : (
        <>
          <button
            type="button"
            onClick={() => setListening(true)}
            className="rounded px-2 py-0.5 text-[10px] text-primary hover:bg-primary/10"
          >
            录制
          </button>
          {keys.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => onSave(keys)}
                className="rounded px-2 py-0.5 text-[10px] text-emerald-400 hover:bg-emerald-400/10"
              >
                保存
              </button>
              <button
                type="button"
                onClick={onCancel}
                className="rounded px-2 py-0.5 text-[10px] text-muted-foreground hover:bg-muted"
              >
                取消
              </button>
            </>
          )}
        </>
      )}
    </div>
  )
}

export function ShortcutsSection() {
  const [settings] = useSetting<SelectionLookupSettings>(
    "selection_lookup",
    DEFAULT_SELECTION_LOOKUP_SETTINGS,
  )
  const [mounted, setMounted] = useState(false)
  const [customBindings, setCustomBindings] = useState<Map<string, CustomBinding>>(new Map())
  const [recording, setRecording] = useState<string | null>(null)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    try {
      const stored = localStorage.getItem("boschcode-custom-shortcuts")
      if (stored) {
        const parsed = JSON.parse(stored)
        setCustomBindings(new Map(Object.entries(parsed)))
      }
    } catch { /* ignore */ }
  }, [])

  const handleSaveBinding = useCallback((label: string, keys: string[]) => {
    const next = new Map(customBindings)
    next.set(label, { label, keys })
    setCustomBindings(next)
    setRecording(null)
    localStorage.setItem("boschcode-custom-shortcuts", JSON.stringify(Object.fromEntries(next)))
  }, [customBindings])

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
            {g.items.map((item) => {
              const custom = customBindings.get(item.label)
              const displayKeys = custom?.keys ?? item.keys
              return (
                <div
                  key={item.label}
                  className="flex items-center justify-between border-b border-border px-4 py-3 last:border-b-0"
                >
                  <span className="text-sm">{item.label}</span>
                  {recording === item.label ? (
                    <ShortcutRecorder
                      initialKeys={displayKeys}
                      onSave={(keys) => handleSaveBinding(item.label, keys)}
                      onCancel={() => setRecording(null)}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => setRecording(item.label)}
                      className="flex items-center gap-1 rounded px-1 py-0.5 transition-colors hover:bg-muted"
                      title="点击录制新快捷键"
                    >
                      {displayKeys.map((k, i) => (
                        <Keycap key={i} k={k} />
                      ))}
                    </button>
                  )}
                </div>
              )
            })}
          </SettingsCard>
        </div>
      ))}
    </div>
  )
}
