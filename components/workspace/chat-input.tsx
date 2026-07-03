"use client"

import { useRef, useState } from "react"
import {
  Plus,
  Send,
  Square,
  Slash,
  ImageIcon,
  ScanLine,
  ChevronDown,
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
import { ThinkingDepthSelect } from "@/components/thinking-depth-select"
import type { ThinkingDepth } from "@/lib/thinking-depth"
import { validateMessage, validateImageDataUrl } from "@/lib/input-validation"
import type { ModelConfig } from "@/lib/models"

const agentModes: { id: AgentMode; label: string; icon: typeof Bot; desc: string }[] = [
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
  models,
  selectedModelId,
  onModelChange,
  disabled,
  degraded,
  generating,
  onStop,
  onValidationError,
}: {
  mode: AgentMode
  onModeChange: (m: AgentMode) => void
  onSend: (text: string, imageDataUrl?: string) => void
  onQuickAction: (action: string) => void
  models: ModelConfig[]
  selectedModelId: string
  onModelChange: (id: string) => void
  disabled?: boolean
  degraded?: boolean
  generating?: boolean
  onStop?: () => void
  onValidationError?: (msg: string) => void
}) {
  const [value, setValue] = useState("")
  const [showModes, setShowModes] = useState(false)
  const [showModels, setShowModels] = useState(false)
  const [showSlash, setShowSlash] = useState(false)
  const [pastedImage, setPastedImage] = useState<string | null>(null)
  const [depth, setDepth] = useState<ThinkingDepth>("default")
  const taRef = useRef<HTMLTextAreaElement>(null)

  const activeMode = agentModes.find((m) => m.id === mode)!
  const currentModel = models.find((m) => m.id === selectedModelId)

  const submit = () => {
    if (!value.trim() && !pastedImage) return
    const text = pastedImage ? `[截图] ${value}`.trim() : value
    const msgCheck = validateMessage(text)
    if (!msgCheck.ok) {
      onValidationError?.(msgCheck.error ?? "输入无效")
      return
    }
    if (pastedImage) {
      const imgCheck = validateImageDataUrl(pastedImage)
      if (!imgCheck.ok) {
        onValidationError?.(imgCheck.error ?? "图片无效")
        return
      }
    }
    if (degraded && mode === "auto") {
      onValidationError?.("降级模式下无法使用 Edit automation，请切换为 Ask 或 Plan")
      return
    }
    onSend(text, pastedImage ?? undefined)
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
            {agentModes.map((m) => {
              const Icon = m.icon
              const modeDisabled = degraded && m.id === "auto"
              return (
                <button
                  key={m.id}
                  type="button"
                  disabled={modeDisabled}
                  onClick={() => {
                    if (modeDisabled) return
                    onModeChange(m.id)
                    setShowModes(false)
                  }}
                  className={cn(
                    "flex w-full items-start gap-2.5 px-3 py-2.5 text-left hover:bg-accent",
                    m.id === mode && "bg-accent",
                    modeDisabled && "cursor-not-allowed opacity-50",
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
            const item = Array.from(e.clipboardData.items).find((it) => it.type.startsWith("image/"))
            if (!item) return
            e.preventDefault()
            const file = item.getAsFile()
            if (!file) return
            const reader = new FileReader()
            reader.onload = () => {
              if (typeof reader.result === "string") setPastedImage(reader.result)
            }
            reader.readAsDataURL(file)
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
              e.preventDefault()
              submit()
            }
          }}
          rows={3}
          placeholder="描述需求，粘贴截图，或输入 / 使用命令…"
          className="border-0 bg-transparent shadow-none focus-visible:ring-0"
          disabled={disabled || generating}
        />

        <div className="flex items-center gap-1 px-2 pb-2">
          <Button variant="ghost" size="icon-sm" aria-label="上传文件" onClick={() => onQuickAction("upload")}>
            <Plus />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="粘贴图片" onClick={() => setPastedImage("pasted")}>
            <ImageIcon />
          </Button>

          {/* Model selector */}
          <div className="relative">
            <Button
              variant="outline"
              size="sm"
              className="max-w-[140px] gap-1.5"
              onClick={() => setShowModels((s) => !s)}
              aria-haspopup="listbox"
            >
              <span className="truncate">{currentModel?.name ?? "选择模型"}</span>
              <ChevronDown className="size-3.5 shrink-0" />
            </Button>
            {showModels && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowModels(false)} aria-hidden />
                <div className="absolute bottom-full left-0 z-20 mb-1 w-56 rounded-lg border border-border bg-popover p-1 shadow-lg">
                  {models.length === 0 ? (
                    <p className="px-2 py-1.5 text-xs text-muted-foreground">暂无模型，请前往设置添加</p>
                  ) : (
                    models.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => {
                          onModelChange(m.id)
                          setShowModels(false)
                        }}
                        className={cn(
                          "flex w-full rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent",
                          m.id === selectedModelId && "text-primary",
                        )}
                      >
                        {m.name}
                      </button>
                    ))
                  )}
                </div>
              </>
            )}
          </div>

          {/* Mode switch */}
          <Button variant="outline" size="sm" onClick={() => setShowModes((s) => !s)} aria-haspopup="menu">
            <activeMode.icon />
            {activeMode.label}
          </Button>

          {/* Thinking depth */}
          <ThinkingDepthSelect value={depth} onChange={setDepth} variant="outline" />

          <div className="ml-auto flex items-center gap-2">
            {generating ? (
              <Button
                type="button"
                size="icon-sm"
                onClick={onStop}
                aria-label="停止生成"
                className="size-8 rounded-full bg-foreground text-background hover:bg-foreground/90"
              >
                <Square className="size-3 fill-current" />
              </Button>
            ) : (
              <Button size="sm" onClick={submit} disabled={disabled || (!value.trim() && !pastedImage)}>
                <Send />
                发送
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
