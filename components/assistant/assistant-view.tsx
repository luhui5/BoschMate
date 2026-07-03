"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ArrowUp,
  Square,
  Paperclip,
  BookUp,
  ChevronDown,
  Plus,
  PenLine,
  FileText,
  Languages,
  BarChart3,
  ListTodo,
  Code2,
  Sparkles,
  Folder,
  FolderOpen,
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { BoschLogo } from "@/components/bosch-logo"
import { ThinkingDepthSelect } from "@/components/thinking-depth-select"
import type { ThinkingDepth } from "@/lib/thinking-depth"

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1 py-0.5">
      <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.3s]" />
      <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.15s]" />
      <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground" />
    </span>
  )
}
import { SessionSidebar } from "@/components/assistant/session-sidebar"
import { FolderPicker } from "@/components/assistant/folder-picker"
import {
  SEED_SESSIONS,
  createSession,
  createPersistedSession,
  loadPersistedSessions,
  deriveTitle,
  saveSessionFolder,
  type AssistantSession,
} from "@/lib/assistant-sessions"
import { buildAssistantSystemPrompt } from "@/lib/assistant-prompt"
import { ensureProjectForFolder } from "@/lib/assistant-project"
import {
  loadModels,
  findModel,
  loadApiKey,
  saveLastUsedModelId,
  recordModelUsage,
  resolveActiveModelId,
  type ModelConfig,
} from "@/lib/models"
import { streamChat, aiLoopChat, sendMessage as tauriSendMessage, deleteSession as tauriDeleteSession, cancelChat, isTauri, onChatToken, type AiChatRequest } from "@/lib/tauri-api"
import { isChatCancelled } from "@/lib/chat-cancel"
import { parseLlmError } from "@/lib/llm-error"
import { LlmErrorCard } from "@/components/llm-error-card"

interface Suggestion {
  icon: React.ComponentType<{ className?: string }>
  title: string
  prompt: string
  className: string
}

const SUGGESTIONS: Suggestion[] = [
  {
    icon: PenLine,
    title: "撰写内容",
    prompt: "帮我起草一封项目延期说明邮件，语气专业且简洁。",
    className: "bg-sky-500/15 text-sky-400",
  },
  {
    icon: FileText,
    title: "总结文档",
    prompt: "根据知识库中的《架构设计规范 v3》，总结核心要点。",
    className: "bg-red-500/15 text-red-400",
  },
  {
    icon: Languages,
    title: "翻译润色",
    prompt: "把这段中文技术说明翻译成地道的英文，并保持术语一致。",
    className: "bg-violet-500/15 text-violet-400",
  },
  {
    icon: BarChart3,
    title: "数据分析",
    prompt: "分析《接口成本核算》表格，找出成本最高的三个接口。",
    className: "bg-emerald-500/15 text-emerald-400",
  },
  {
    icon: ListTodo,
    title: "制定计划",
    prompt: "为下个季度的产品路线图拆解一个可执行的里程碑计划。",
    className: "bg-amber-500/15 text-amber-400",
  },
  {
    icon: Code2,
    title: "编写代码",
    prompt: "用 TypeScript 写一个带重试与超时的 fetch 封装函数。",
    className: "bg-teal-500/15 text-teal-400",
  },
]

export function AssistantView({
  knowledgeCount,
  onOpenKnowledge,
}: {
  knowledgeCount: number
  onOpenKnowledge: () => void
}) {
  const [sessions, setSessions] = useState<AssistantSession[]>(SEED_SESSIONS)
  const [activeId, setActiveId] = useState<string>("")
  const didInit = useRef(false)

  // One-time init: restore from DB or create a persisted session
  useEffect(() => {
    if (!didInit.current) {
      didInit.current = true
      void (async () => {
        if (isTauri()) {
          try {
            const saved = await loadPersistedSessions()
            if (saved.length > 0) {
              setSessions(saved)
              setActiveId(saved[0].id)
              return
            }
          } catch {
            /* fall through to new session */
          }
        }
        const fresh = await createPersistedSession()
        setSessions((prev) => [fresh, ...prev])
        setActiveId(fresh.id)
      })()
    }
  }, [])

  const [input, setInput] = useState("")
  const [thinking, setThinking] = useState(false)
  const generatingSessionRef = useRef<string | null>(null)
  const stopRequestedRef = useRef(false)
  const activeAssistantMsgRef = useRef<string | null>(null)
  const [llmError, setLlmError] = useState<ReturnType<typeof parseLlmError> | null>(null)
  const [modelOpen, setModelOpen] = useState(false)
  const [folderOpen, setFolderOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // ── Model list (shared source of truth) ──
  const [availableModels, setAvailableModels] = useState<ModelConfig[]>([])

  const refreshModels = useCallback(() => {
    loadModels().then(async (models) => {
      setAvailableModels(models)
      if (models.length === 0 || !activeId) return
      const preferred = await resolveActiveModelId(models)
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== activeId) return s
          const valid = models.some((m) => m.id === s.model)
          return valid ? s : { ...s, model: preferred }
        }),
      )
    }).catch(() => {})
  }, [activeId])

  useEffect(() => {
    refreshModels()
  }, [refreshModels])

  // Re-sync on window focus (user may have changed models in settings)
  useEffect(() => {
    window.addEventListener("focus", refreshModels)
    return () => window.removeEventListener("focus", refreshModels)
  }, [refreshModels])

  const active = useMemo(
    () => sessions.find((s) => s.id === activeId) ?? sessions[0],
    [sessions, activeId],
  )
  const messages = active?.messages ?? []
  const hasChat = messages.length > 0

  const patchActive = (patch: Partial<AssistantSession>) => {
    if (patch.model) {
      void saveLastUsedModelId(patch.model)
    }
    if ("folder" in patch && activeId) {
      void saveSessionFolder(activeId, patch.folder ?? null)
    }
    setSessions((prev) =>
      prev.map((s) =>
        s.id === activeId ? { ...s, ...patch, updatedAt: new Date().toISOString() } : s,
      ),
    )
  }

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })
  }, [messages, thinking])

  const newSession = () => {
    void (async () => {
      const fresh = await createPersistedSession({
        folder: active?.folder ?? null,
      })
      setSessions((prev) => [fresh, ...prev])
      setActiveId(fresh.id)
      setInput("")
    })()
  }

  const deleteSession = (id: string) => {
    const target = sessions.find((s) => s.id === id)
    if (!target) return
    if (!window.confirm(`确定删除对话「${target.title}」？此操作不可撤销。`)) return

    void (async () => {
      if (isTauri()) {
        try {
          await tauriDeleteSession(id)
        } catch {
          return
        }
      }
      setSessions((prev) => {
        const next = prev.filter((s) => s.id !== id)
        if (id === activeId) {
          if (next.length > 0) {
            setActiveId(next[0].id)
          } else {
            void createPersistedSession().then((fresh) => {
              setActiveId(fresh.id)
              setSessions([fresh])
            })
            return []
          }
        }
        return next
      })
    })()
  }

  // ── Real AI send ──
  const send = async (text: string) => {
    const content = text.trim()
    if (!content || thinking || !active) return

    const userMsg = { id: `u-${Date.now()}`, role: "user" as const, content }
    const isFirst = active.messages.length === 0

    setSessions((prev) =>
      prev.map((s) =>
        s.id === activeId
          ? {
              ...s,
              title: isFirst ? deriveTitle(content) : s.title,
              messages: [...s.messages, userMsg],
              updatedAt: new Date().toISOString(),
            }
          : s,
      ),
    )
    setInput("")
    setThinking(true)
    generatingSessionRef.current = activeId
    stopRequestedRef.current = false

    // Look up the model config
    const modelCfg = findModel(availableModels, active.model)
    if (!isTauri()) {
      // Web browser mode: show template reply since there's no backend
      setTimeout(() => {
        const fallback = `已收到你的请求：「${content.slice(0, 40)}${content.length > 40 ? "…" : ""}」。\n\n作为本地全能助手，我可以在不离开本机的前提下完成写作、文档总结、翻译、数据分析、计划制定与代码编写。请告诉我更多细节，或从知识库中选择相关文档，我会据此给出更精准的结果。${active.folder ? `\n\n（当前工作文件夹：${active.folder}，我会在该目录范围内读取与检索相关内容。）` : ""}`
        setSessions((prev) =>
          prev.map((s) =>
            s.id === activeId
              ? {
                  ...s,
                  messages: [
                    ...s.messages,
                    { id: `a-${Date.now()}`, role: "assistant" as const, content: fallback },
                  ],
                  updatedAt: new Date().toISOString(),
                }
              : s,
          ),
        )
        setThinking(false)
      }, 900)
      return
    }

    if (!modelCfg) {
      const noModelMsg = "未选择模型。请先在输入框左侧的模型下拉菜单中选择一个可用的模型，或前往 设置 → 模型配置 添加新模型。"
      setSessions((prev) =>
        prev.map((s) =>
          s.id === activeId
            ? {
                ...s,
                messages: [
                  ...s.messages,
                  { id: `a-${Date.now()}`, role: "assistant" as const, content: noModelMsg },
                ],
                updatedAt: new Date().toISOString(),
              }
            : s,
        ),
      )
      setThinking(false)
      return
    }

    const assistantMsgId = `a-${Date.now()}`
    activeAssistantMsgRef.current = assistantMsgId
    setLlmError(null)

    setSessions((prev) =>
      prev.map((s) =>
        s.id === activeId
          ? {
              ...s,
              messages: [...s.messages, { id: assistantMsgId, role: "assistant" as const, content: "" }],
            }
          : s,
      ),
    )

    const unlisten = onChatToken((e) => {
      if (e.session_id !== activeId) return
      setSessions((prev) =>
        prev.map((s) =>
          s.id === activeId
            ? {
                ...s,
                messages: s.messages.map((m) =>
                  m.id === assistantMsgId ? { ...m, content: e.content } : m,
                ),
              }
            : s,
        ),
      )
    })

    // Load API key if available
    const apiKey = (await loadApiKey(modelCfg.id)) ?? undefined

    // Build conversation history
    const history = active.messages.map((m) => ({
      role: m.role,
      content: m.content,
    }))

    const folder = active.folder
    const toolsEnabled = Boolean(folder && isTauri())
    const system = buildAssistantSystemPrompt({ folder, toolsEnabled })

    try {
      if (isTauri()) {
        await tauriSendMessage({
          session_id: activeId,
          content,
          mode: "ask",
        })
      }

      let response
      if (toolsEnabled && folder) {
        const projectId = await ensureProjectForFolder(folder)
        response = await aiLoopChat(
          {
            provider: modelCfg.provider,
            model: modelCfg.name,
            messages: [...history, { role: "user", content }],
            system_prompt: system,
            api_key: apiKey,
            base_url: modelCfg.endpoint ?? undefined,
            assistant_mode: true,
          },
          activeId,
          projectId,
        )
      } else {
        const request: AiChatRequest = {
          provider: modelCfg.provider,
          model: modelCfg.name,
          messages: [...history, { role: "user", content }],
          temperature: modelCfg.temperature,
          max_tokens: modelCfg.contextWindow >= 4096 ? 4096 : undefined,
          api_key: apiKey,
          base_url: modelCfg.endpoint ?? undefined,
          system,
        }
        response = await streamChat(request, activeId)
      }

      await recordModelUsage(modelCfg.id)
      if (stopRequestedRef.current) return
      setSessions((prev) =>
        prev.map((s) =>
          s.id === activeId
            ? {
                ...s,
                messages: s.messages.map((m) =>
                  m.id === assistantMsgId
                    ? { id: response.id, role: "assistant" as const, content: response.content }
                    : m,
                ),
                updatedAt: new Date().toISOString(),
              }
            : s,
        ),
      )
    } catch (err) {
      if (isChatCancelled(err)) {
        setSessions((prev) =>
          prev.map((s) =>
            s.id === activeId
              ? {
                  ...s,
                  messages: s.messages.map((m) =>
                    m.id === assistantMsgId
                      ? { ...m, content: m.content.trim() || "（已中止）" }
                      : m,
                  ),
                  updatedAt: new Date().toISOString(),
                }
              : s,
          ),
        )
        return
      }
      const parsed = parseLlmError(err)
      setLlmError(parsed)
      setSessions((prev) =>
        prev.map((s) =>
          s.id === activeId
            ? {
                ...s,
                messages: s.messages.filter((m) => m.id !== assistantMsgId),
                updatedAt: new Date().toISOString(),
              }
            : s,
        ),
      )
    } finally {
      unlisten()
      setThinking(false)
      generatingSessionRef.current = null
      activeAssistantMsgRef.current = null
    }
  }

  const stopGeneration = () => {
    const sessionId = generatingSessionRef.current
    if (!sessionId || !thinking) return
    stopRequestedRef.current = true
    if (isTauri()) void cancelChat(sessionId).catch(() => {})
    const msgId = activeAssistantMsgRef.current
    setSessions((prev) =>
      prev.map((s) =>
        s.id === sessionId
          ? {
              ...s,
              messages: s.messages.map((m) =>
                msgId && m.id === msgId
                  ? { ...m, content: m.content.trim() || "（已中止）" }
                  : m,
              ),
              updatedAt: new Date().toISOString(),
            }
          : s,
      ),
    )
    setThinking(false)
    generatingSessionRef.current = null
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
      e.preventDefault()
      send(input)
    }
  }

  // Resolve current model display name
  const currentModelName = useMemo(() => {
    const cfg = findModel(availableModels, active?.model ?? "")
    return cfg?.name ?? "选择模型"
  }, [availableModels, active?.model])

  return (
    <div className="flex h-[calc(100vh-34px)]">
      <SessionSidebar
        sessions={sessions}
        activeId={activeId}
        onSelect={setActiveId}
        onNew={newSession}
        onDelete={deleteSession}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <Sparkles className="size-5 shrink-0 text-primary" />
            <span className="truncate text-sm font-semibold">{active?.title ?? "Bosch Assistant"}</span>
            <span className="hidden shrink-0 rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-muted-foreground sm:inline">
              本地全能助手
            </span>
          </div>
          {/* Folder binding */}
          <Button
            variant={active?.folder ? "secondary" : "ghost"}
            size="sm"
            className="max-w-[240px] gap-1.5"
            onClick={async () => {
              // Windows / Tauri: when no folder is bound, directly open native picker
              if (!active?.folder && isTauri()) {
                const { pickFolder } = await import("@/lib/tauri-api")
                const selected = await pickFolder()
                if (selected) patchActive({ folder: selected })
                return
              }
              setFolderOpen(true)
            }}
          >
            {active?.folder ? <FolderOpen className="size-4" /> : <Folder className="size-4" />}
            <span className="truncate font-mono text-xs">
              {active?.folder ?? "指定文件夹"}
            </span>
            {active?.folder && (
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation()
                  patchActive({ folder: null })
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.stopPropagation()
                    patchActive({ folder: null })
                  }
                }}
                className="ml-0.5 rounded p-0.5 hover:bg-background/60"
                aria-label="解除文件夹绑定"
              >
                <X className="size-3" />
              </span>
            )}
          </Button>
        </header>

        {llmError && (
          <div className="border-b border-border px-5 py-2">
            <LlmErrorCard error={llmError} onRetry={() => { setLlmError(null); if (active?.messages.length) { const last = [...active.messages].reverse().find(m => m.role === 'user'); if (last) void send(last.content) } }} />
          </div>
        )}

        {/* Message area */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          {!hasChat ? (
            <div className="mx-auto flex min-h-full max-w-2xl flex-col items-center justify-center px-5 py-10">
              <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-foreground text-background">
                <BoschLogo className="size-7" />
              </div>
              <h1 className="text-balance text-center text-2xl font-semibold tracking-tight">
                我能帮你做什么？
              </h1>
              <p className="mt-2 text-pretty text-center text-sm text-muted-foreground">
                Bosch Assistant 是完全本地运行的全能助手，数据不出本机。选择下面的能力，或直接开始输入。
              </p>
              <div className="mt-6 grid w-full grid-cols-1 gap-2.5 sm:grid-cols-2">
                {SUGGESTIONS.map((s) => {
                  const Icon = s.icon
                  return (
                    <button
                      key={s.title}
                      onClick={() => send(s.prompt)}
                      className="flex items-start gap-3 rounded-xl border border-border bg-card p-3 text-left transition-colors hover:border-primary/40 hover:bg-accent/40"
                    >
                      <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-md", s.className)}>
                        <Icon className="size-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">{s.title}</span>
                        <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">
                          {s.prompt}
                        </span>
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-2xl space-y-5 px-5 py-6">
              {messages.map((m) => (
                <div key={m.id} className={cn("flex gap-3", m.role === "user" && "flex-row-reverse")}>
                  <span
                    className={cn(
                      "flex size-8 shrink-0 items-center justify-center rounded-md text-xs font-semibold",
                      m.role === "assistant"
                        ? "bg-foreground text-background"
                        : "bg-secondary text-secondary-foreground",
                    )}
                  >
                    {m.role === "assistant" ? <BoschLogo className="size-4" /> : "你"}
                  </span>
                  <div
                    className={cn(
                      "max-w-[80%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
                      m.role === "assistant"
                        ? "bg-card text-card-foreground"
                        : "bg-primary text-primary-foreground",
                    )}
                  >
                    {m.content ||
                      (m.role === "assistant" && thinking ? <TypingDots /> : null)}
                  </div>
                </div>
              ))}
              {thinking &&
                !messages.some((m) => m.role === "assistant" && !m.content.trim()) && (
                <div className="flex gap-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-foreground text-background">
                    <BoschLogo className="size-4" />
                  </span>
                  <div className="flex items-center gap-1 rounded-2xl bg-card px-4 py-3">
                    <TypingDots />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Composer */}
        <div className="border-t border-border px-5 py-3">
          <div className="mx-auto max-w-2xl">
            <div className="rounded-2xl border border-border bg-card p-2 focus-within:border-ring">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                rows={1}
                placeholder="给 Bosch Assistant 发送消息…（Enter 发送，Shift+Enter 换行）"
                className="max-h-40 w-full resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground"
              />
              <div className="flex items-center justify-between gap-2 px-1">
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon-sm" onClick={onOpenKnowledge} aria-label="附加文件">
                    <Paperclip className="size-4" />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={onOpenKnowledge} className="gap-1.5">
                    <BookUp className="size-4" />
                    知识库
                    <span className="rounded-full bg-secondary px-1.5 text-[11px] text-muted-foreground">
                      {knowledgeCount}
                    </span>
                  </Button>
                  {/* Model selector */}
                  <div className="relative">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => setModelOpen((o) => !o)}
                    >
                      {currentModelName}
                      <ChevronDown className="size-3.5" />
                    </Button>
                    {modelOpen && (
                      <>
                        <div className="fixed inset-0 z-10" onClick={() => setModelOpen(false)} aria-hidden />
                        <div className="absolute bottom-full left-0 z-20 mb-1 w-56 rounded-lg border border-border bg-popover p-1 shadow-lg">
                          {availableModels.length === 0 ? (
                            <p className="px-2 py-1.5 text-xs text-muted-foreground">
                              暂无模型，请前往设置添加
                            </p>
                          ) : (
                            availableModels.map((m) => (
                              <button
                                key={m.id}
                                onClick={() => {
                                  patchActive({ model: m.id })
                                  setModelOpen(false)
                                }}
                                className={cn(
                                  "flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent",
                                  m.id === active?.model && "text-primary",
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
                  <ThinkingDepthSelect
                    value={active?.depth ?? "default"}
                    onChange={(d: ThinkingDepth) => patchActive({ depth: d })}
                  />
                </div>
                {thinking ? (
                  <Button
                    type="button"
                    size="icon-sm"
                    onClick={stopGeneration}
                    aria-label="停止生成"
                    className="size-8 rounded-full bg-foreground text-background hover:bg-foreground/90"
                  >
                    <Square className="size-3 fill-current" />
                  </Button>
                ) : (
                  <Button
                    size="icon-sm"
                    disabled={!input.trim()}
                    onClick={() => send(input)}
                    aria-label="发送"
                  >
                    <ArrowUp className="size-4" />
                  </Button>
                )}
              </div>
            </div>
            <p className="mt-1.5 text-center text-[11px] text-muted-foreground">
              所有对话与文档均在本地处理，不会上传云端。
            </p>
          </div>
        </div>
      </div>

      <FolderPicker
        open={folderOpen}
        current={active?.folder ?? null}
        onClose={() => setFolderOpen(false)}
        onSelect={(folder) => patchActive({ folder })}
      />
    </div>
  )
}
