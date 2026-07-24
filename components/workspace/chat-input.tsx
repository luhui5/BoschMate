"use client"

import { useMemo, useRef, useState, useEffect } from "react"
import type { LucideIcon } from "lucide-react"
import {
  Plus,
  Send,
  Square,
  Slash,
  ImageIcon,
  ScanLine,
  ChevronDown,
  ChevronRight,
  MessageCircleQuestion,
  ListTodo,
  FilePen,
  Bot,
  Check,
  Search,
  FileUp,
  BookOpen,
  Plug,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/input"
import { BoschGradientBorder } from "@/components/bosch-gradient-border"
import { cn } from "@/lib/utils"
import { getCommands } from "@/lib/slash-commands"
import type { AgentMode } from "@/lib/types"
import { THINKING_DEPTHS, getThinkingDepth, type ThinkingDepth } from "@/lib/thinking-depth"
import { validateMessage, validateImageDataUrl } from "@/lib/input-validation"
import { groupModelsByProvider, type ModelConfig, type ModelProviderConfig } from "@/lib/models"

const agentModes: { id: AgentMode; label: string; icon: typeof Bot; desc: string }[] = [
  { id: "ask", label: "Ask", icon: MessageCircleQuestion, desc: "仅回答与解释，只读查看代码；修改请切换 Auto" },
  { id: "plan", label: "Plan", icon: ListTodo, desc: "生成计划文档，不执行" },
  { id: "edit", label: "Ask before edits", icon: FilePen, desc: "逐步确认：每个文件 diff 需采纳；适合谨慎改动" },
  { id: "auto", label: "Auto", icon: Bot, desc: "自动应用变更并运行验证" },
]

function MenuBackdrop({ onClose }: { onClose: () => void }) {
  return <div className="fixed inset-0 z-10" onClick={onClose} aria-hidden />
}

export type ChatInputExtraMenuItem = {
  id: string
  label: string
  icon: LucideIcon
  onClick: () => void
  trailing?: React.ReactNode
}

export function ChatInput({
  mode,
  onModeChange,
  onSend,
  onQuickAction,
  models,
  providers,
  selectedModelId,
  onModelChange,
  disabled,
  degraded,
  generating,
  onStop,
  onValidationError,
  hideAgentModes,
  extraMenuItems,
  placeholder = "描述需求，粘贴截图，或输入 / 使用命令…",
  enableSlashCommands = true,
  knowledgeBases,
  selectedKbaseId,
  onKbaseChange,
  hideKnowledgeSelector,
  lockAgentMode,
  prefillText,
  onPrefillConsumed,
}: {
  mode: AgentMode
  onModeChange: (m: AgentMode) => void
  onSend: (text: string, imageDataUrl?: string) => void
  onQuickAction: (action: string) => void
  models: ModelConfig[]
  providers: ModelProviderConfig[]
  selectedModelId: string
  onModelChange: (id: string) => void
  disabled?: boolean
  degraded?: boolean
  generating?: boolean
  onStop?: () => void
  onValidationError?: (msg: string) => void
  hideAgentModes?: boolean
  extraMenuItems?: ChatInputExtraMenuItem[]
  placeholder?: string
  enableSlashCommands?: boolean
  knowledgeBases?: { id: string; name: string }[]
  selectedKbaseId?: string | null
  onKbaseChange?: (id: string | null) => void
  hideKnowledgeSelector?: boolean
  lockAgentMode?: boolean
  prefillText?: string | null
  onPrefillConsumed?: () => void
}) {
  const [value, setValue] = useState("")
  const [showAddMenu, setShowAddMenu] = useState(false)
  const [showAgentModes, setShowAgentModes] = useState(false)
  const [showKbaseMenu, setShowKbaseMenu] = useState(false)
  const [showModels, setShowModels] = useState(false)
  const [showSlash, setShowSlash] = useState(false)
  const [pastedImage, setPastedImage] = useState<string | null>(null)
  const [depth, setDepth] = useState<ThinkingDepth>("default")
  const [modelSearch, setModelSearch] = useState("")
  const taRef = useRef<HTMLTextAreaElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (prefillText) {
      setValue(prefillText)
      onPrefillConsumed?.()
      taRef.current?.focus()
    }
  }, [prefillText, onPrefillConsumed])

  const currentModel = models.find((m) => m.id === selectedModelId)
  const currentAgentMode = agentModes.find((m) => m.id === mode)
  const CurrentModeIcon = currentAgentMode?.icon
  const activeDepth = getThinkingDepth(depth)
  const kbaseList = knowledgeBases ?? []
  const selectedKbase = kbaseList.find((b) => b.id === selectedKbaseId) ?? null
  const kbaseSelectorDisabled = kbaseList.length === 0

  const groupedModels = useMemo(() => {
    const q = modelSearch.trim().toLowerCase()
    const groups = groupModelsByProvider(models, providers)
    if (!q) return groups
    return groups
      .map((group) => ({
        ...group,
        models: group.models.filter(
          (m) =>
            m.name.toLowerCase().includes(q) ||
            m.detail.toLowerCase().includes(q) ||
            group.provider.name.toLowerCase().includes(q),
        ),
      }))
      .filter((group) => group.models.length > 0)
  }, [models, providers, modelSearch])

  const loadImageFile = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === "string") setPastedImage(reader.result)
    }
    reader.readAsDataURL(file)
  }

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
      onValidationError?.("降级模式下无法使用 Auto 模式，请切换为 Ask 或 Plan")
      return
    }
    if (degraded && mode === "edit") {
      onValidationError?.("降级模式下 Shell/Git 写入可能不可用，建议使用 Ask 或 Plan")
    }
    onSend(text, pastedImage ?? undefined)
    setValue("")
    setPastedImage(null)
    setShowSlash(false)
  }

  const onChange = (v: string) => {
    setValue(v)
    setShowSlash(enableSlashCommands && v.startsWith("/"))
  }

  const slashFiltered = enableSlashCommands
    ? getCommands().filter((c) => `/${c.name}`.startsWith(value.trim()))
    : []
  const canSend = !disabled && !generating && (value.trim().length > 0 || pastedImage)

  return (
    <div
      className={cn(
        "relative border-t border-border bg-background p-3",
        (showAddMenu || showAgentModes || showModels || showSlash) && "z-30",
      )}
    >
      {showSlash && slashFiltered.length > 0 && (
        <div className="absolute bottom-full left-3 mb-2 w-72 overflow-hidden rounded-lg border border-border bg-popover shadow-xl">
          {slashFiltered.map((c) => (
            <button
              key={c.name}
              onClick={() => {
                setValue(`/${c.name}${c.takesArgs ? " " : ""}`)
                setShowSlash(false)
                taRef.current?.focus()
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
            >
              <Slash className="size-3.5 text-muted-foreground" />
              <span className="font-mono">/{c.name}</span>
              <span className="ml-auto text-xs text-muted-foreground">{c.description}</span>
            </button>
          ))}
        </div>
      )}

      {pastedImage && (
        <div className="mb-2 flex items-center gap-2 rounded-md border border-border bg-card p-2">
          <ScanLine className="size-4 text-primary" />
          <span className="text-xs text-muted-foreground">已添加图片，将随消息一起分析</span>
          <Button variant="ghost" size="xs" className="ml-auto" onClick={() => setPastedImage(null)}>
            移除
          </Button>
        </div>
      )}

      <BoschGradientBorder
        focusable
        spinOnInteract
        className="rounded-xl"
        innerClassName="rounded-[11px] bg-card"
      >
        <Textarea
          ref={taRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onPaste={(e) => {
            const item = Array.from(e.clipboardData.items).find((it) => it.type.startsWith("image/"))
            if (!item) return
            e.preventDefault()
            const file = item.getAsFile()
            if (file) loadImageFile(file)
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
              e.preventDefault()
              submit()
            }
          }}
          rows={2}
          placeholder={placeholder}
          className="min-h-[52px] resize-none border-0 bg-transparent px-3 py-2.5 shadow-none focus-visible:ring-0"
          disabled={disabled || generating}
        />

        <div className="flex items-center justify-between gap-2 px-2 pb-2">
          <div className="flex min-w-0 flex-1 items-center gap-1">
            {/* + menu: attachments & tools */}
            <div className="relative shrink-0">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="添加附件或工具"
              aria-expanded={showAddMenu}
              className="size-8 rounded-full border border-border/60"
              onClick={() => {
                setShowAddMenu((s) => !s)
                setShowAgentModes(false)
                setShowModels(false)
              }}
            >
              <Plus className="size-4" />
            </Button>

            {showAddMenu && (
              <>
                <MenuBackdrop onClose={() => setShowAddMenu(false)} />
                <div className="absolute bottom-full left-0 z-20 mb-2 w-[280px] overflow-hidden rounded-xl border border-border bg-popover shadow-xl">
                  <p className="px-3 pb-1 pt-3 text-xs text-muted-foreground">
                    添加上下文与工具…
                  </p>

                  <div className="p-1">
                    <button
                      type="button"
                      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-accent"
                      onClick={() => {
                        imageInputRef.current?.click()
                        setShowAddMenu(false)
                      }}
                    >
                      <ImageIcon className="size-4 text-foreground/80" />
                      <span>Image</span>
                    </button>
                    <button
                      type="button"
                      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-accent"
                      onClick={() => {
                        onQuickAction("upload")
                        setShowAddMenu(false)
                      }}
                    >
                      <FileUp className="size-4 text-foreground/80" />
                      <span>File</span>
                    </button>
                    {extraMenuItems?.map((item) => {
                      const Icon = item.icon
                      return (
                        <button
                          key={item.id}
                          type="button"
                          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-accent"
                          onClick={() => {
                            item.onClick()
                            setShowAddMenu(false)
                          }}
                        >
                          <Icon className="size-4 text-foreground/80" />
                          <span className="flex-1">{item.label}</span>
                          {item.trailing}
                        </button>
                      )
                    })}
                    <button
                      type="button"
                      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-accent"
                      onClick={() => onValidationError?.("Skills 即将推出")}
                    >
                      <BookOpen className="size-4" />
                      <span className="flex-1">Skills</span>
                      <ChevronRight className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-accent"
                      onClick={() => onValidationError?.("MCP Servers 即将推出")}
                    >
                      <Plug className="size-4" />
                      <span className="flex-1">MCP Servers</span>
                      <ChevronRight className="size-3.5" />
                    </button>
                  </div>
                </div>
              </>
            )}
            </div>

            {!hideAgentModes && (
              <div className="relative min-w-0">
                <button
                  type="button"
                  aria-haspopup="listbox"
                  aria-expanded={showAgentModes}
                  title={lockAgentMode ? "已选知识库，锁定 Ask 模式" : undefined}
                  disabled={lockAgentMode}
                  onClick={() => {
                    if (lockAgentMode) return
                    setShowAgentModes((s) => !s)
                    setShowAddMenu(false)
                    setShowModels(false)
                    setShowKbaseMenu(false)
                  }}
                  className={cn(
                    "flex max-w-[200px] items-center gap-1 rounded-full border border-border bg-muted/30 px-2.5 py-1 text-xs font-medium transition-colors hover:bg-muted/50",
                    lockAgentMode && "cursor-not-allowed opacity-70",
                  )}
                >
                  {CurrentModeIcon && (
                    <CurrentModeIcon className="size-3.5 shrink-0 text-foreground/80" />
                  )}
                  <span className="truncate">{currentAgentMode?.label ?? "选择模式"}</span>
                  <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
                </button>

                {showAgentModes && (
                  <>
                    <MenuBackdrop onClose={() => setShowAgentModes(false)} />
                    <div className="absolute bottom-full left-0 z-20 mb-2 w-[240px] overflow-hidden rounded-xl border border-border bg-popover shadow-xl">
                      <div className="p-1">
                        {agentModes.map((m) => {
                          const Icon = m.icon
                          const modeDisabled = degraded && m.id === "auto"
                          return (
                            <button
                              key={m.id}
                              type="button"
                              title={m.desc}
                              disabled={modeDisabled}
                              onClick={() => {
                                if (modeDisabled) return
                                onModeChange(m.id)
                                setShowAgentModes(false)
                              }}
                              className={cn(
                                "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-accent",
                                m.id === mode && "bg-accent",
                                modeDisabled && "cursor-not-allowed opacity-50",
                              )}
                            >
                              <Icon className="size-4 shrink-0 text-foreground/80" />
                              <span className="flex-1 font-medium">{m.label}</span>
                              {m.id === mode && (
                                <Check className="size-3.5 shrink-0 text-primary" />
                              )}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {!hideKnowledgeSelector && onKbaseChange && (
              <div className="relative min-w-0">
                <button
                  type="button"
                  aria-haspopup="listbox"
                  aria-expanded={showKbaseMenu}
                  title={
                    kbaseSelectorDisabled
                      ? "请先在知识库面板创建知识库"
                      : selectedKbase
                        ? `已选知识库：${selectedKbase.name}`
                        : "选择知识库（可选）"
                  }
                  disabled={kbaseSelectorDisabled}
                  onClick={() => {
                    if (kbaseSelectorDisabled) return
                    setShowKbaseMenu((s) => !s)
                    setShowAddMenu(false)
                    setShowModels(false)
                    setShowAgentModes(false)
                  }}
                  className={cn(
                    "flex max-w-[160px] items-center gap-1 rounded-full border border-border bg-muted/30 px-2.5 py-1 text-xs font-medium transition-colors hover:bg-muted/50",
                    kbaseSelectorDisabled && "cursor-not-allowed opacity-50",
                    selectedKbase && "border-primary/40",
                  )}
                >
                  <BookOpen className="size-3.5 shrink-0 text-foreground/80" />
                  <span className="truncate">
                    {selectedKbase ? selectedKbase.name : "知识库"}
                  </span>
                  <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
                </button>

                {showKbaseMenu && (
                  <>
                    <MenuBackdrop onClose={() => setShowKbaseMenu(false)} />
                    <div className="absolute bottom-full left-0 z-20 mb-2 w-[220px] overflow-hidden rounded-xl border border-border bg-popover shadow-xl">
                      <div className="p-1">
                        <button
                          type="button"
                          onClick={() => {
                            onKbaseChange(null)
                            setShowKbaseMenu(false)
                          }}
                          className={cn(
                            "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-accent",
                            !selectedKbaseId && "bg-accent",
                          )}
                        >
                          <span className="flex-1 text-muted-foreground">不启用</span>
                          {!selectedKbaseId && (
                            <Check className="size-3.5 shrink-0 text-primary" />
                          )}
                        </button>
                        {kbaseList.map((base) => (
                          <button
                            key={base.id}
                            type="button"
                            onClick={() => {
                              onKbaseChange(base.id)
                              setShowKbaseMenu(false)
                            }}
                            className={cn(
                              "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-accent",
                              base.id === selectedKbaseId && "bg-accent",
                            )}
                          >
                            <span className="flex-1 truncate font-medium">{base.name}</span>
                            {base.id === selectedKbaseId && (
                              <Check className="size-3.5 shrink-0 text-primary" />
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Model + send */}
          <div className="flex shrink-0 items-center gap-1.5">
            <div className="relative">
              <button
                type="button"
                aria-haspopup="listbox"
                aria-expanded={showModels}
                onClick={() => {
                  setShowModels((s) => !s)
                  setShowAddMenu(false)
                  setShowAgentModes(false)
                  setShowKbaseMenu(false)
                }}
                className="flex max-w-[180px] items-center gap-1 rounded-full border border-border bg-muted/30 px-2.5 py-1 text-xs font-medium transition-colors hover:bg-muted/50"
              >
                <span className="truncate">{currentModel?.name ?? "选择模型"}</span>
                <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
              </button>

              {showModels && (
                <>
                  <MenuBackdrop
                    onClose={() => {
                      setShowModels(false)
                      setModelSearch("")
                    }}
                  />
                  <div className="absolute bottom-full right-0 z-20 mb-2 w-[300px] overflow-hidden rounded-xl border border-border bg-popover shadow-xl">
                    <div className="border-b border-border p-2">
                      <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-1.5">
                        <Search className="size-3.5 text-muted-foreground" />
                        <input
                          value={modelSearch}
                          onChange={(e) => setModelSearch(e.target.value)}
                          placeholder="Search models"
                          className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                          autoFocus
                        />
                      </div>
                    </div>

                    <div className="max-h-52 overflow-y-auto p-1">
                      {groupedModels.length === 0 ? (
                        <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                          暂无模型，请前往设置添加
                        </p>
                      ) : (
                        groupedModels.map((group) => (
                          <div key={group.provider.id} className="mb-1 last:mb-0">
                            <p className="px-2.5 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                              {group.provider.name}
                            </p>
                            {group.models.map((m) => (
                              <button
                                key={m.id}
                                type="button"
                                onClick={() => {
                                  onModelChange(m.id)
                                  setShowModels(false)
                                  setModelSearch("")
                                }}
                                className={cn(
                                  "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-accent",
                                  m.id === selectedModelId && "bg-accent",
                                )}
                              >
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-sm font-medium">{m.name}</span>
                                  {m.detail && (
                                    <span className="block truncate text-xs text-muted-foreground">
                                      {m.detail}
                                    </span>
                                  )}
                                </span>
                                {m.id === selectedModelId && (
                                  <Check className="size-3.5 shrink-0 text-primary" />
                                )}
                              </button>
                            ))}
                          </div>
                        ))
                      )}
                    </div>

                    <div className="border-t border-border p-2">
                      <p className="mb-1.5 px-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        Options
                      </p>
                      <p className="mb-1 px-1 text-xs text-muted-foreground">思考深度 · {activeDepth.label}</p>
                      <div className="flex flex-wrap gap-1 px-1">
                        {THINKING_DEPTHS.slice(0, 5).map((d) => (
                          <button
                            key={d.id}
                            type="button"
                            onClick={() => setDepth(d.id)}
                            className={cn(
                              "rounded-full border px-2 py-0.5 text-[11px] transition-colors",
                              d.id === depth
                                ? "border-primary/40 bg-primary/10 text-primary"
                                : "border-border text-muted-foreground hover:bg-accent",
                            )}
                          >
                            {d.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>

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
              <Button
                type="button"
                size="icon-sm"
                onClick={submit}
                disabled={!canSend}
                aria-label="发送"
                className="size-8 rounded-full"
              >
                <Send className="size-3.5" />
              </Button>
            )}
          </div>
        </div>
      </BoschGradientBorder>

      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) loadImageFile(file)
          e.target.value = ""
        }}
      />
    </div>
  )
}
