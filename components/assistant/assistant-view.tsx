"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  BookUp,
  ChevronDown,
  Code2,
  FileText,
  Folder,
  FolderOpen,
  Languages,
  ListTodo,
  PenLine,
  Sparkles,
  BarChart3,
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { BoschLogo } from "@/components/bosch-logo"
import { SessionSidebar } from "@/components/assistant/session-sidebar"
import { FolderPicker } from "@/components/assistant/folder-picker"
import {
  SEED_SESSIONS,
  createPersistedSession,
  loadPersistedSessions,
  deriveTitle,
  saveSessionFolder,
  type AssistantSession,
  type AssistantMessage,
} from "@/lib/assistant-sessions"
import { buildAssistantSystemPrompt } from "@/lib/assistant-prompt"
import { ensureProjectForFolder } from "@/lib/assistant-project"
import {
  resolveAssistantFolder,
  resolveDefaultAssistantWorkspace,
  shortFolderLabel,
} from "@/lib/assistant-workspace"
import {
  loadModels,
  findModel,
  loadApiKey,
  saveLastUsedModelId,
  recordModelUsage,
  resolveActiveModelId,
  type ModelConfig,
} from "@/lib/models"
import {
  streamChat,
  aiLoopChat,
  sendMessage as tauriSendMessage,
  deleteSession as tauriDeleteSession,
  cancelChat,
  applyChange,
  rejectChange,
  revertChange,
  isTauri,
  onChatToken,
  onLoopActivity,
  mapActivityStep,
  type AiChatRequest,
} from "@/lib/tauri-api"
import { isChatCancelled } from "@/lib/chat-cancel"
import { parseLlmError } from "@/lib/llm-error"
import { LlmErrorCard } from "@/components/llm-error-card"
import { ChatInput } from "@/components/workspace/chat-input"
import { ChatMessageView, getReplyLayoutState } from "@/components/workspace/chat-message"
import { useFloatingUserMessage } from "@/components/workspace/use-floating-user-message"
import type { ActivityStep, AgentMode, ChatMessage } from "@/lib/types"

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

function upsertActivityStep(steps: ActivityStep[], step: ActivityStep): ActivityStep[] {
  const i = steps.findIndex((s) => s.id === step.id)
  if (i >= 0) {
    const next = [...steps]
    next[i] = step
    return next
  }
  return [...steps, step]
}

function toChatMessage(m: AssistantMessage): ChatMessage {
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    createdAt: m.createdAt ?? new Date().toISOString(),
    mode: m.mode ?? "auto",
    streaming: m.streaming,
    activitySteps: m.activitySteps,
    diffs: m.diffs,
  }
}

function finalizeCancelledMessage(m: AssistantMessage): AssistantMessage {
  return {
    ...m,
    streaming: false,
    content: m.content.trim() || "（已中止）",
    activitySteps: m.activitySteps?.map((s) =>
      s.status === "running" ? { ...s, status: "error" as const, result: "已中止" } : s,
    ),
  }
}

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
            /* fall through */
          }
        }
        const fresh = await createPersistedSession()
        setSessions((prev) => [fresh, ...prev])
        setActiveId(fresh.id)
      })()
    }
  }, [])

  const [generating, setGenerating] = useState(false)
  const generatingSessionRef = useRef<string | null>(null)
  const stopRequestedRef = useRef(false)
  const activeAssistantMsgRef = useRef<string | null>(null)
  const [llmError, setLlmError] = useState<ReturnType<typeof parseLlmError> | null>(null)
  const [mode, setMode] = useState<AgentMode>("auto")
  const [folderOpen, setFolderOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const userScrolledUpRef = useRef(false)
  const prevPinnedRef = useRef(false)
  const prevMsgCountRef = useRef(0)

  const [availableModels, setAvailableModels] = useState<ModelConfig[]>([])

  const refreshModels = useCallback(() => {
    loadModels()
      .then(async (models) => {
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
      })
      .catch(() => {})
  }, [activeId])

  useEffect(() => {
    refreshModels()
    window.addEventListener("focus", refreshModels)
    return () => window.removeEventListener("focus", refreshModels)
  }, [refreshModels])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2500)
    return () => clearTimeout(t)
  }, [toast])

  const active = useMemo(
    () => sessions.find((s) => s.id === activeId) ?? sessions[0],
    [sessions, activeId],
  )
  const chatMessages = useMemo(
    () => (active?.messages ?? []).map(toChatMessage),
    [active?.messages],
  )
  const hasChat = chatMessages.length > 0

  const chatLayout = useMemo(() => {
    const msgs = chatMessages
    const { lastUserIdx, awaitingReply, afterUser } = getReplyLayoutState(msgs, false, generating)
    const usePinned = awaitingReply && lastUserIdx >= 0
    return {
      usePinned,
      pinnedUser: usePinned ? msgs[lastUserIdx] : null,
      history: usePinned ? msgs.slice(0, lastUserIdx) : [],
      currentTurn: usePinned ? afterUser : [],
      allMessages: msgs,
    }
  }, [chatMessages, generating])

  const scrollMessages = useMemo(() => {
    if (chatLayout.usePinned && chatLayout.pinnedUser) {
      return [...chatLayout.history, chatLayout.pinnedUser, ...chatLayout.currentTurn]
    }
    return chatLayout.allMessages
  }, [chatLayout])

  const { floatingMessage, registerUserMessageRef } = useFloatingUserMessage(
    scrollRef,
    scrollMessages,
  )

  const patchActive = (patch: Partial<AssistantSession>) => {
    if (patch.model) void saveLastUsedModelId(patch.model)
    if ("folder" in patch && activeId) {
      void saveSessionFolder(activeId, patch.folder ?? null)
    }
    setSessions((prev) =>
      prev.map((s) =>
        s.id === activeId ? { ...s, ...patch, updatedAt: new Date().toISOString() } : s,
      ),
    )
  }

  const updateActiveMessages = (fn: (msgs: AssistantMessage[]) => AssistantMessage[]) => {
    setSessions((prev) =>
      prev.map((s) =>
        s.id === activeId
          ? { ...s, messages: fn(s.messages), updatedAt: new Date().toISOString() }
          : s,
      ),
    )
  }

  useEffect(() => {
    const container = scrollRef.current
    if (!container) return
    const onScroll = () => {
      const distanceFromBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight
      userScrolledUpRef.current = distanceFromBottom > 96
    }
    container.addEventListener("scroll", onScroll, { passive: true })
    return () => container.removeEventListener("scroll", onScroll)
  }, [])

  useEffect(() => {
    const container = scrollRef.current
    if (!container || !active) return

    const justPinned = chatLayout.usePinned && !prevPinnedRef.current
    const msgCount = active.messages.length
    const newTurn = msgCount > prevMsgCountRef.current
    prevPinnedRef.current = chatLayout.usePinned
    prevMsgCountRef.current = msgCount

    if (justPinned || (newTurn && chatLayout.usePinned)) {
      userScrolledUpRef.current = false
    }

    requestAnimationFrame(() => {
      if (userScrolledUpRef.current && !justPinned) return
      container.scrollTo({
        top: container.scrollHeight,
        behavior: justPinned ? "instant" : "smooth",
      })
    })
  }, [active?.messages, generating, chatLayout.usePinned, active])

  const newSession = () => {
    void (async () => {
      const defaultFolder = await resolveDefaultAssistantWorkspace()
      const fresh = await createPersistedSession({
        folder: active?.folder ?? defaultFolder,
      })
      setSessions((prev) => [fresh, ...prev])
      setActiveId(fresh.id)
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

  const send = async (text: string, _imageDataUrl?: string) => {
    const content = text.trim()
    if (!content || generating || !active) return

    const userMsg: AssistantMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      content,
      mode,
      createdAt: new Date().toISOString(),
    }
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

    setGenerating(true)
    generatingSessionRef.current = activeId
    stopRequestedRef.current = false

    const modelCfg = findModel(availableModels, active.model)

    if (!isTauri()) {
      setTimeout(() => {
        const fallback = `已收到你的请求：「${content.slice(0, 40)}${content.length > 40 ? "…" : ""}」。\n\n（浏览器预览模式，请使用桌面应用获得完整 Assistant 能力）`
        updateActiveMessages((msgs) => [
          ...msgs,
          {
            id: `a-${Date.now()}`,
            role: "assistant",
            content: fallback,
            createdAt: new Date().toISOString(),
          },
        ])
        setGenerating(false)
        generatingSessionRef.current = null
      }, 900)
      return
    }

    if (!modelCfg) {
      updateActiveMessages((msgs) => [
        ...msgs,
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          content: "未选择模型。请点击发送栏旁的模型选择，或前往 设置 → 模型配置 添加模型。",
          createdAt: new Date().toISOString(),
        },
      ])
      setGenerating(false)
      generatingSessionRef.current = null
      return
    }

    const assistantMsgId = `a-${Date.now()}`
    activeAssistantMsgRef.current = assistantMsgId
    setLlmError(null)

    const folder = await resolveAssistantFolder(active.folder)
    const toolsEnabled = Boolean(folder)

    updateActiveMessages((msgs) => [
      ...msgs,
      {
        id: assistantMsgId,
        role: "assistant",
        content: "",
        streaming: true,
        createdAt: new Date().toISOString(),
      },
    ])

    const unlistenToken = onChatToken((e) => {
      if (e.session_id !== activeId) return
      updateActiveMessages((msgs) =>
        msgs.map((m) =>
          m.id === assistantMsgId ? { ...m, content: e.content, streaming: true } : m,
        ),
      )
    })

    const unlistenActivity = toolsEnabled
      ? onLoopActivity((e) => {
          if (e.session_id !== activeId) return
          const step = mapActivityStep(e.step)
          updateActiveMessages((msgs) =>
            msgs.map((m) =>
              m.id === assistantMsgId
                ? {
                    ...m,
                    activitySteps: upsertActivityStep(m.activitySteps ?? [], step),
                  }
                : m,
            ),
          )
        })
      : () => {}

    const apiKey = (await loadApiKey(modelCfg.id)) ?? undefined
    const history = active.messages.map((m) => ({ role: m.role, content: m.content }))
    const system = buildAssistantSystemPrompt({ folder, toolsEnabled, mode })

    try {
      await tauriSendMessage({
        session_id: activeId,
        content,
        mode,
      })

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
            agent_mode: mode,
            edit_dry_run: mode === "edit",
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

      updateActiveMessages((msgs) =>
        msgs.map((m) => {
          if (m.id !== assistantMsgId) return m
          return {
            id: response.id,
            role: "assistant" as const,
            content: response.content || m.content,
            streaming: false,
            mode: response.mode ?? mode,
            diffs: response.diffs,
            activitySteps:
              response.activitySteps?.length
                ? response.activitySteps
                : m.activitySteps?.length
                  ? m.activitySteps
                  : response.activitySteps,
            createdAt: m.createdAt,
          }
        }),
      )
    } catch (err) {
      if (isChatCancelled(err)) {
        updateActiveMessages((msgs) =>
          msgs.map((m) => (m.id === assistantMsgId ? finalizeCancelledMessage(m) : m)),
        )
        return
      }
      const parsed = parseLlmError(err)
      setLlmError(parsed)
      updateActiveMessages((msgs) => msgs.filter((m) => m.id !== assistantMsgId))
    } finally {
      unlistenToken()
      unlistenActivity()
      setGenerating(false)
      generatingSessionRef.current = null
      activeAssistantMsgRef.current = null
    }
  }

  const stopGeneration = () => {
    const sessionId = generatingSessionRef.current
    if (!sessionId || !generating) return
    stopRequestedRef.current = true
    if (isTauri()) void cancelChat(sessionId).catch(() => {})
    const msgId = activeAssistantMsgRef.current
    updateActiveMessages((msgs) =>
      msgs.map((m) => (msgId && m.id === msgId ? finalizeCancelledMessage(m) : m)),
    )
    setGenerating(false)
    generatingSessionRef.current = null
  }

  const onQuickAction = (action: string) => {
    if (action === "upload") {
      setToast("请使用 + 菜单中的 Image，或粘贴图片到输入框")
      return
    }
    if (action === "knowledge") {
      onOpenKnowledge()
    }
  }

  const onDiffAction = async (
    messageId: string,
    diffIndex: number,
    action: "accept" | "reject" | "revert",
  ) => {
    if (!active) return
    const msg = active.messages.find((m) => m.id === messageId)
    const diff = msg?.diffs?.[diffIndex]
    if (!diff) return

    const folder = await resolveAssistantFolder(active.folder)
    if (!folder) return

    const statusMap = { accept: "applied", reject: "rejected", revert: "reverted" } as const

    try {
      const projectId = await ensureProjectForFolder(folder)
      if (action === "accept" && diff.editMeta && diff.changeId && isTauri()) {
        await applyChange(projectId, {
          change_id: diff.changeId,
          path: diff.editMeta.path ?? diff.filePath,
          old_string: diff.editMeta.old_string ?? "",
          new_string: diff.editMeta.new_string ?? "",
          replace_all: diff.editMeta.replace_all,
        })
      } else if (action === "reject" && diff.changeId && isTauri()) {
        await rejectChange(diff.changeId)
      } else if (action === "revert" && diff.changeId && isTauri()) {
        await revertChange(projectId, diff.changeId)
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      setToast(`操作失败：${reason}`)
      return
    }

    updateActiveMessages((msgs) =>
      msgs.map((m) =>
        m.id === messageId
          ? {
              ...m,
              diffs: m.diffs?.map((d, i) =>
                i === diffIndex ? { ...d, status: statusMap[action] } : d,
              ),
            }
          : m,
      ),
    )
    setToast(action === "accept" ? "已采纳变更" : action === "reject" ? "已拒绝变更" : "已回滚变更")
  }

  const noopOpenFile = (_path: string) => {}

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
        <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <Sparkles className="size-5 shrink-0 text-primary" />
            <span className="truncate text-sm font-semibold">{active?.title ?? "Bosch Assistant"}</span>
            <span className="hidden shrink-0 rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-muted-foreground sm:inline">
              本地全能助手
            </span>
          </div>
          <Button
            variant={active?.folder ? "secondary" : "ghost"}
            size="sm"
            className="max-w-[280px] gap-1.5"
            onClick={() => setFolderOpen(true)}
            title={active?.folder ?? undefined}
          >
            {active?.folder ? <FolderOpen className="size-4 shrink-0" /> : <Folder className="size-4 shrink-0" />}
            <span className="truncate font-mono text-xs">
              {shortFolderLabel(active?.folder)}
            </span>
            {active?.folder && (
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation()
                  void (async () => {
                    const fallback = await resolveDefaultAssistantWorkspace()
                    patchActive({ folder: fallback })
                  })()
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.stopPropagation()
                    void resolveDefaultAssistantWorkspace().then((fallback) =>
                      patchActive({ folder: fallback }),
                    )
                  }
                }}
                className="ml-0.5 rounded p-0.5 hover:bg-background/60"
                aria-label="恢复默认工作区"
              >
                <X className="size-3" />
              </span>
            )}
          </Button>
        </header>

        {llmError && (
          <div className="border-b border-border px-5 py-2">
            <LlmErrorCard
              error={llmError}
              onRetry={() => {
                setLlmError(null)
                const last = [...(active?.messages ?? [])].reverse().find((m) => m.role === "user")
                if (last) void send(last.content)
              }}
            />
          </div>
        )}

        {toast && (
          <div className="border-b border-border px-5 py-2 text-center text-xs text-muted-foreground">
            {toast}
          </div>
        )}

        <div className="relative flex min-h-0 flex-1 flex-col">
          {floatingMessage && hasChat && (
            <div className="pointer-events-none absolute inset-x-0 top-0 z-20 border-b border-border bg-background/95 px-4 py-2 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-background/85">
              <div className="pointer-events-auto w-full">
                <ChatMessageView
                  message={floatingMessage}
                  variant="float"
                  onDiffAction={onDiffAction}
                  onOpenFile={noopOpenFile}
                />
              </div>
            </div>
          )}

          <div ref={scrollRef} className="flex-1 overflow-y-auto scrollbar-thin">
            {!hasChat ? (
              <div className="mx-auto flex min-h-full max-w-2xl flex-col items-start justify-center px-5 py-10">
                <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-foreground text-background">
                  <BoschLogo className="size-7" />
                </div>
                <h1 className="text-balance text-left text-2xl font-semibold tracking-tight">
                  我能帮你做什么？
                </h1>
                <p className="mt-2 text-pretty text-left text-sm text-muted-foreground">
                  Bosch Assistant 是完全本地运行的智能体，可读写文件、执行命令、调用工具。选择下面的能力，或直接开始输入。
                </p>
                <div className="mt-6 grid w-full grid-cols-1 gap-2.5 sm:grid-cols-2">
                  {SUGGESTIONS.map((s) => {
                    const Icon = s.icon
                    return (
                      <button
                        key={s.title}
                        type="button"
                        onClick={() => void send(s.prompt)}
                        className="flex items-start gap-3 rounded-xl border border-border bg-card p-3 text-left transition-colors hover:border-primary/40 hover:bg-accent/40"
                      >
                        <span
                          className={cn(
                            "flex size-8 shrink-0 items-center justify-center rounded-md",
                            s.className,
                          )}
                        >
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
              <div className="flex w-full flex-col gap-6 px-4 pb-8 pt-4 text-left">
                {scrollMessages.map((m) => {
                  const view = (
                    <ChatMessageView
                      message={m}
                      variant={m.role === "user" ? "user-query" : "default"}
                      onDiffAction={onDiffAction}
                      onOpenFile={noopOpenFile}
                    />
                  )
                  if (m.role === "user") {
                    return (
                      <div
                        key={m.id}
                        ref={(el) => registerUserMessageRef(m.id, el)}
                        className="scroll-mt-2"
                      >
                        {view}
                      </div>
                    )
                  }
                  return <div key={m.id}>{view}</div>
                })}
              </div>
            )}
          </div>
        </div>

        <ChatInput
          mode={mode}
          onModeChange={setMode}
          onSend={(t, img) => { void send(t, img) }}
          onQuickAction={onQuickAction}
          models={availableModels}
          selectedModelId={active?.model ?? ""}
          onModelChange={(id) => patchActive({ model: id })}
          generating={generating}
          onStop={stopGeneration}
          onValidationError={setToast}
          enableSlashCommands={false}
          placeholder="给 Bosch Assistant 发送消息…"
          extraMenuItems={[
            {
              id: "knowledge",
              label: "知识库",
              icon: BookUp,
              onClick: onOpenKnowledge,
              trailing: (
                <span className="rounded-full bg-secondary px-1.5 text-[10px] text-muted-foreground">
                  {knowledgeCount}
                </span>
              ),
            },
            {
              id: "folder",
              label: "工作文件夹",
              icon: FolderOpen,
              onClick: () => setFolderOpen(true),
              trailing: <ChevronDown className="size-3.5 rotate-[-90deg] text-muted-foreground" />,
            },
          ]}
        />
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
