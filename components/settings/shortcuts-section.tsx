"use client"

import { SectionHeader, SettingsCard } from "./primitives"

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

function Keycap({ k }: { k: string }) {
  return (
    <kbd className="inline-flex h-6 min-w-6 items-center justify-center rounded-md border border-border bg-muted px-1.5 font-mono text-xs text-foreground">
      {k}
    </kbd>
  )
}

export function ShortcutsSection() {
  return (
    <div className="space-y-6">
      <SectionHeader title="快捷键" desc="键盘绑定遵循 macOS 习惯，Windows / Linux 上 ⌘ 对应 Ctrl。" />
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
