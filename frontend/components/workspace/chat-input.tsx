"use client"

import { useRef, useState } from "react"
import {
  Plus,
  Send,
  Slash,
  ImageIcon,
  TestTube2,
  Sparkles,
  ScanLine,
  MessageCircleQuestion,
  ListTodo,
  FilePen,
  Bot,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { slashCommands } from "@/lib/mock-data"
import type { AgentMode } from "@/lib/types"

const modes: { id: AgentMode; label: string; icon: typeof Bot; desc: string }[] = [
  { id: "ask", label: "Bosch Assistant", icon: MessageCircleQuestion, desc: "仅回答与解释，不修改代码" },
  { id: "plan", label: "Plan", icon: ListTodo, desc: "生成计划文档，不执行" },
  { id: "edit", label: "Ask before edits", icon: FilePen, desc: "修改前需你确认每个变更" },
  { id: "auto", label: "Edit automation", icon: Bot, desc: "自动应用变更并运行验证" },
]

export function ChatInput({
  mode,
  onModeChange,
  onSend,
  onQuickAction,
  disabled,
}: {
  mode: AgentMode
  onModeChange: (m: AgentMode) => void
  onSend: (text: string) => void
  onQuickAction: (action: string) => void
  disabled?: boolean
}) {
  const [value, setValue] = useState("")
  const [showModes, setShowModes] = useState(false)
  const [showSlash, setShowSlash] = useState(false)
  const [pastedImage, setPastedImage] = useState<string | null>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)

  const activeMode = modes.find((m) => m.id === mode)!

  const submit = () => {
    if (!value.trim() && !pastedImage) return
    onSend(pastedImage ? `[截图] ${value}`.trim() : value)
    setValue("")
    setPastedImage(null)
    setShowSlash(false)
  }

  const onChange = (v: string) => {
    setValue(v)
    setShowSlash(v.startsWith("/"))
  }

  const slashFiltered = slashCommands.filter((c) => c.cmd.startsWith(value.trim()))

  return (
    <div className="relative border-t border-border bg-background p-3">
      {/* Slash command popover */}
      {showSlash && slashFiltered.length > 0 && (
        <div className="absolute bottom-full left-3 mb-2 w-72 overflow-hidden rounded-lg border border-border bg-popover shadow-xl">
          {slashFiltered.map((c) => (
            <button
              key={c.cmd}
              onClick={() => {
                setValue(c.cmd + " ")
                setShowSlash(false)
                taRef.current?.focus()
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
            >
              <Slash className="size-3.5 text-muted-foreground" />
              <span className="font-mono">{c.cmd}</span>
              <span className="ml-auto text-xs text-muted-foreground">{c.desc}</span>
            </button>
          ))}
        </div>
      )}

      {/* Mode popover */}
      {showModes && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setShowModes(false)} aria-hidden />
          <div className="absolute bottom-full left-3 z-20 mb-2 w-80 overflow-hidden rounded-lg border border-border bg-popover shadow-xl">
            {modes.map((m) => {
              const Icon = m.icon
              return (
                <button
                  key={m.id}
                  onClick={() => {
                    onModeChange(m.id)
                    setShowModes(false)
                  }}
                  className={cn(
                    "flex w-full items-start gap-2.5 px-3 py-2.5 text-left hover:bg-accent",
                    m.id === mode && "bg-accent",
                  )}
                >
                  <Icon className="mt-0.5 size-4 shrink-0 text-primary" />
                  <span className="flex flex-col">
                    <span className="text-sm font-medium">{m.label}</span>
                    <span className="text-xs text-muted-foreground">{m.desc}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </>
      )}

      {pastedImage && (
        <div className="mb-2 flex items-center gap-2 rounded-md border border-border bg-card p-2">
          <ScanLine className="size-4 text-primary" />
          <span className="text-xs text-muted-foreground">已粘贴截图，将随消息一起分析</span>
          <Button variant="ghost" size="xs" className="ml-auto" onClick={() => setPastedImage(null)}>
            移除
          </Button>
        </div>
      )}

      <div className="rounded-lg border border-border bg-card focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30">
        <Textarea
          ref={taRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onPaste={(e) => {
            if (Array.from(e.clipboardData.items).some((it) => it.type.startsWith("image/"))) {
              setPastedImage("pasted")
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              submit()
            }
          }}
          rows={3}
          placeholder="描述需求，粘贴截图，或输入 / 使用命令…"
          className="border-0 bg-transparent shadow-none focus-visible:ring-0"
          disabled={disabled}
        />

        <div className="flex items-center gap-1 px-2 pb-2">
          <Button variant="ghost" size="icon-sm" aria-label="上传文件" onClick={() => onQuickAction("upload")}>
            <Plus />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="粘贴图片" onClick={() => setPastedImage("pasted")}>
            <ImageIcon />
          </Button>

          {/* Mode switch */}
          <Button variant="outline" size="sm" onClick={() => setShowModes((s) => !s)} aria-haspopup="menu">
            <activeMode.icon />
            {activeMode.label}
          </Button>

          <div className="mx-1 h-5 w-px bg-border" />

          {/* Quick actions */}
          <Button variant="ghost" size="sm" onClick={() => onQuickAction("/run-tests")}>
            <TestTube2 />
            <span className="hidden sm:inline">测试</span>
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onQuickAction("/format")}>
            <Sparkles />
            <span className="hidden sm:inline">格式化</span>
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onQuickAction("/lint")}>
            <ScanLine />
            <span className="hidden sm:inline">Lint</span>
          </Button>

          <div className="ml-auto flex items-center gap-2">
            <span className="hidden text-[10px] text-muted-foreground md:inline">⌘ + Enter 发送</span>
            <Button size="sm" onClick={submit} disabled={disabled || (!value.trim() && !pastedImage)}>
              <Send />
              发送
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
