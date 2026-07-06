"use client"

import { startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import {
  BookUp,
  Code2,
  FileText,
  Languages,
  ListTodo,
  PenLine,
  Sparkles,
  BarChart3,
  PanelRight,
  FileCode2,
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Modal } from "@/components/ui/modal"
import { BoschLogo } from "@/components/bosch-logo"
import { WorkspaceSidebar } from "@/components/assistant/workspace-sidebar"
import {
  SEED_SESSIONS,
  createPersistedSession,
  loadPersistedSessions,
  deriveTitle,
  groupSessionsByWorkspace,
  type AssistantSession,
  type AssistantMessage,
} from "@/lib/assistant-sessions"
import { buildAssistantSystemPrompt } from "@/lib/assistant-prompt"
import { buildLlmMessages } from "@/lib/chat-history"
import {
  EXECUTE_PLAN_MESSAGE,
  findLatestExecutablePlanMessageId,
} from "@/lib/plan-execute"
import { isAssistantSessionProcessing } from "@/lib/session-processing"
import { DEFAULT_AGENT_MODE } from "@/lib/constants"
import { debounce } from "@/lib/debounce"
import {
  addLocalWorkspace,
  addSshWorkspace,
  listAssistantWorkspaces,
  removeWorkspace,
  resolveWorkspaceFolder,
  type AssistantWorkspace,
} from "@/lib/assistant-workspaces"
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
  aiLoopChat,
  continueAiLoop,
  sendMessage as tauriSendMessage,
  updateSessionTitle,
  deleteSession as tauriDeleteSession,
  cancelChat,
  applyChange,
  rejectChange,
  revertChange,
  openProject,
  revealInExplorer,
  watchProjectDir,
  saveRecoverySnapshot,
  retrieveMemories,
  listKnowledgeBases,
  isTauri,
  onChatToken,
  onChatToolDelta,
  onLoopActivity,
  mapActivityStep,
  onAssistantPrefillQuery,
} from "@/lib/tauri-api"
import { isChatCancelled } from "@/lib/chat-cancel"
import { sidebarFeatures } from "@/lib/ui-features"
import { parseLlmError } from "@/lib/llm-error"
import { LlmErrorCard } from "@/components/llm-error-card"
import { ChatInput } from "@/components/workspace/chat-input"
import { ChatMessageView, getReplyLayoutState } from "@/components/workspace/chat-message"
import { ScrollToBottomButton } from "@/components/workspace/scroll-to-bottom-button"
import { useFloatingUserMessage } from "@/components/workspace/use-floating-user-message"
import { isNearBottom, scrollContainerToBottom } from "@/lib/scroll-to-bottom"
import { useProjectWorkspace } from "@/components/workspace/use-project-workspace"
import { RightSidebar } from "@/components/workspace/right-sidebar"
import { FilePreviewPanel } from "@/components/file-preview-panel"
import { BulkWriteDialog } from "@/components/bulk-write-dialog"
import { saveSelectedKbaseId, loadSelectedKbaseId } from "@/lib/knowledge"
import type { ActivityStep, AgentMode, ChatMessage, DiffHunk, QuestionAnswer } from "@/lib/types"

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
    mode: m.mode ?? "edit",
    streaming: m.streaming,
    activitySteps: m.activitySteps,
    diffs: m.diffs,
    pendingQuestions: m.pendingQuestions,
  }
}

function chatMessageVisualEqual(a: ChatMessage, b: ChatMessage): boolean {
  return (
    a.content === b.content &&
    a.streaming === b.streaming &&
    a.mode === b.mode &&
    a.role === b.role &&
    a.activitySteps === b.activitySteps &&
    a.diffs === b.diffs &&
    a.pendingQuestions === b.pendingQuestions
  )
}

function stableChatMessages(
  raw: AssistantMessage[],
  cache: Map<string, ChatMessage>,
): { messages: ChatMessage[]; reused: number } {
  const usedIds = new Set<string>()
  let reused = 0
  const result = raw.map((m) => {
    const next = toChatMessage(m)
    usedIds.add(m.id)
    const prev = cache.get(m.id)
    if (prev && !next.streaming && chatMessageVisualEqual(prev, next)) {
      reused += 1
      return prev
    }
    cache.set(m.id, next)
    return next
  })
  for (const id of cache.keys()) {
    if (!usedIds.has(id)) cache.delete(id)
  }
  return { messages: result, reused }
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

function isMessageProcessing(m: AssistantMessage): boolean {
  return (
    m.role === "assistant" &&
    (Boolean(m.streaming) ||
      (m.activitySteps?.some((s) => s.status === "running") ?? false))
  )
}

function finalizeProcessingMessages(msgs: AssistantMessage[]): AssistantMessage[] {
  return msgs.map((m) => (isMessageProcessing(m) ? finalizeCancelledMessage(m) : m))
}

export function AssistantView({
  knowledgeCount,
  onOpenKnowledge,
}: {
  knowledgeCount: number
  onOpenKnowledge: () => void
}) {
  const searchParams = useSearchParams()
  const workspaceQuery = searchParams.get("workspace")

  const [sessions, setSessions] = useState<AssistantSession[]>(SEED_SESSIONS)
  const [workspaces, setWorkspaces] = useState<AssistantWorkspace[]>([])
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string>("")
  const [activeId, setActiveId] = useState<string>("")
  const didInit = useRef(false)
  const [selectedKbaseId, setSelectedKbaseId] = useState<string | null>(null)
  const [kbaseOptions, setKbaseOptions] = useState<{ id: string; name: string }[]>([])
  const [prefillText, setPrefillText] = useState<string | null>(null)
  const [mode, setMode] = useState<AgentMode>(DEFAULT_AGENT_MODE)
  const modeBeforeKbaseRef = useRef<AgentMode | null>(null)
  const [isDesktopApp, setIsDesktopApp] = useState(false)

  const refreshWorkspaces = useCallback(async () => {
    const list = await listAssistantWorkspaces()
    setWorkspaces(list)
    setActiveWorkspaceId((prev) => {
      if (prev && list.some((w) => w.projectId === prev)) return prev
      return list[0]?.projectId ?? ""
    })
    return list
  }, [])

  useEffect(() => {
    if (!didInit.current) {
      didInit.current = true
      void (async () => {
        const list = await refreshWorkspaces()
        const homeId = list[0]?.projectId
        if (isTauri()) {
          try {
            const saved = await loadPersistedSessions()
            if (saved.length > 0) {
              setSessions(saved)
              setActiveId(saved[0].id)
              setActiveWorkspaceId(saved[0].projectId || homeId || "")
              return
            }
          } catch {
            /* fall through */
          }
        }
        const fresh = await createPersistedSession({
          projectId: homeId,
          folder: list[0]?.localPath ?? null,
        })
        setSessions((prev) => [fresh, ...prev])
        setActiveId(fresh.id)
        if (homeId) setActiveWorkspaceId(homeId)
      })()
    }
  }, [refreshWorkspaces])

  useEffect(() => {
    if (!isTauri()) return
    setIsDesktopApp(true)
    void loadSelectedKbaseId().then((saved) => {
      if (saved) {
        setSelectedKbaseId(saved)
        setMode("ask")
      }
    })
  }, [])

  useEffect(() => {
    if (!isTauri()) return
    return onAssistantPrefillQuery(({ text, kbaseId: kbId }) => {
      if (kbId) {
        setSelectedKbaseId(kbId)
        void saveSelectedKbaseId(kbId)
        setMode("ask")
      }
      setPrefillText(text)
    })
  }, [])

  const handleKbaseChange = useCallback((id: string | null) => {
    if (id) {
      if (!selectedKbaseId) modeBeforeKbaseRef.current = mode
      setMode("ask")
    } else if (modeBeforeKbaseRef.current) {
      setMode(modeBeforeKbaseRef.current)
      modeBeforeKbaseRef.current = null
    }
    setSelectedKbaseId(id)
    void saveSelectedKbaseId(id)
  }, [mode, selectedKbaseId])

  const refreshKbaseOptions = useCallback(async () => {
    if (!isTauri()) return
    const bases = await listKnowledgeBases()
    setKbaseOptions(bases.map((b) => ({ id: b.id, name: b.name })))
    setSelectedKbaseId((prev) => {
      if (prev && !bases.some((b) => b.id === prev)) {
        void saveSelectedKbaseId(null)
        if (modeBeforeKbaseRef.current) {
          setMode(modeBeforeKbaseRef.current)
          modeBeforeKbaseRef.current = null
        }
        return null
      }
      return prev
    })
  }, [])

  useEffect(() => {
    void refreshKbaseOptions()
  }, [refreshKbaseOptions, knowledgeCount])

  const [generating, setGenerating] = useState(false)
  const generatingSessionRef = useRef<string | null>(null)
  const sendInFlightRef = useRef(false)
  const stopRequestedRef = useRef(false)
  const activeAssistantMsgRef = useRef<string | null>(null)
  const [llmError, setLlmError] = useState<ReturnType<typeof parseLlmError> | null>(null)
  const prevModeRef = useRef<AgentMode>(mode)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [rightOpen, setRightOpen] = useState(true)
  const [activeFile, setActiveFile] = useState<string | null>(null)
  const [gitRemote, setGitRemote] = useState<string | undefined>(undefined)
  const [bulkWriteOpen, setBulkWriteOpen] = useState(false)
  const [pendingBulkRetry, setPendingBulkRetry] = useState<{ userText: string } | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [workspaceToRemove, setWorkspaceToRemove] = useState<AssistantWorkspace | null>(null)
  const [sessionToDeleteId, setSessionToDeleteId] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const scrollContentRef = useRef<HTMLDivElement>(null)
  const userScrolledUpRef = useRef(false)
  const prevPinnedRef = useRef(false)
  const prevMsgCountRef = useRef(0)
  const followScrollRafRef = useRef<number | null>(null)
  const tokenFlushTimerRef = useRef<number | null>(null)
  const pendingTokenRef = useRef<{ messageId: string; content: string } | null>(null)
  const thoughtFlushTimerRef = useRef<number | null>(null)
  const pendingThoughtDetailRef = useRef<{
    messageId: string
    thoughtId: string
    detail: string
  } | null>(null)
  const activeThoughtIdRef = useRef<string | null>(null)
  const roundHasToolDeltaRef = useRef(false)
  const hasCompletedToolStepsRef = useRef(false)
  const latestStreamContentRef = useRef("")
  const streamContentBufferRef = useRef("")
  const activityFlushTimerRef = useRef<number | null>(null)
  const pendingActivityStepsRef = useRef<ActivityStep[]>([])
  const chatMessagesCacheRef = useRef(new Map<string, ChatMessage>())
  const streamingActiveRef = useRef(false)

  const scheduleFollowScroll = useCallback(() => {
    const container = scrollRef.current
    if (!container || userScrolledUpRef.current) return
    if (followScrollRafRef.current != null) return
    followScrollRafRef.current = requestAnimationFrame(() => {
      followScrollRafRef.current = null
      scrollContainerToBottom(container, "instant")
    })
  }, [])

  const [showJumpToBottom, setShowJumpToBottom] = useState(false)

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

  useEffect(() => {
    const prev = prevModeRef.current
    if (prev === "plan" && mode === "auto") {
      setToast("建议发送：按上述计划执行")
    }
    prevModeRef.current = mode
  }, [mode])

  const active = useMemo(
    () => sessions.find((s) => s.id === activeId) ?? sessions[0],
    [sessions, activeId],
  )

  const activeWorkspace = useMemo(
    () => workspaces.find((w) => w.projectId === activeWorkspaceId) ?? workspaces[0] ?? null,
    [workspaces, activeWorkspaceId],
  )
  const workspaceProjectId = activeWorkspace?.projectId ?? null
  const workspaceLocalPath = activeWorkspace?.localPath ?? null
  const sessionsByWorkspace = useMemo(
    () => groupSessionsByWorkspace(workspaces, sessions),
    [workspaces, sessions],
  )

  const processingSessionIds = useMemo(() => {
    const ids = new Set<string>()
    for (const s of sessions) {
      if (isAssistantSessionProcessing(s)) ids.add(s.id)
    }
    if (generating && generatingSessionRef.current) {
      ids.add(generatingSessionRef.current)
    }
    return ids
  }, [sessions, generating])

  const handleSelectSession = useCallback((sessionId: string) => {
    setActiveId(sessionId)
    const session = sessions.find((s) => s.id === sessionId)
    if (session?.projectId) setActiveWorkspaceId(session.projectId)
  }, [sessions])

  const handleSelectWorkspace = useCallback((workspaceId: string) => {
    setActiveWorkspaceId(workspaceId)
    const list = sessionsByWorkspace.get(workspaceId) ?? []
    if (list.some((s) => s.id === activeId)) return
    if (list.length > 0) {
      setActiveId(list[0].id)
      return
    }
    void (async () => {
      const ws = workspaces.find((w) => w.projectId === workspaceId)
      const fresh = await createPersistedSession({
        projectId: workspaceId,
        folder: ws?.localPath ?? null,
      })
      setSessions((prev) => [fresh, ...prev])
      setActiveId(fresh.id)
    })()
  }, [sessionsByWorkspace, activeId, workspaces])

  useEffect(() => {
    if (!workspaceQuery || workspaces.length === 0) return
    if (workspaces.some((w) => w.projectId === workspaceQuery)) {
      handleSelectWorkspace(workspaceQuery)
    }
  }, [workspaceQuery, workspaces, handleSelectWorkspace])

  const {
    fileTree,
    setFileTree,
    fileTreeLoading,
    gitFiles,
    gitBranch,
    gitError,
    refreshGit,
    refreshFileTree,
    loadTreeChildren,
  } = useProjectWorkspace(workspaceProjectId, workspaceLocalPath)

  useEffect(() => {
    if (!sidebarFeatures.git || !workspaceProjectId || !isTauri()) {
      setGitRemote(undefined)
      return
    }
    let cancelled = false
    void openProject(workspaceProjectId)
      .then((proj) => {
        if (!cancelled) setGitRemote(proj.gitRemote)
      })
      .catch(() => {
        if (!cancelled) setGitRemote(undefined)
      })
    return () => {
      cancelled = true
    }
  }, [workspaceProjectId])

  useEffect(() => {
    if (!workspaceProjectId || !isTauri()) return

    const debouncedRefresh = debounce(() => {
      void refreshFileTree()
      if (sidebarFeatures.git) void refreshGit()
    }, 400)

    watchProjectDir(workspaceProjectId).catch(() => {})
    let unlisten: (() => void) | undefined
    void import("@tauri-apps/api/event").then(({ listen }) => {
      void listen<{ project_id: string }>("file-changed", (e) => {
        if (e.payload.project_id === workspaceProjectId) debouncedRefresh()
      }).then((fn) => {
        unlisten = fn
      })
    })
    return () => {
      debouncedRefresh.cancel()
      unlisten?.()
    }
  }, [workspaceProjectId, refreshFileTree, refreshGit])

  useEffect(() => {
    if (!active || !workspaceProjectId || !isTauri() || generating) return
    const timer = setInterval(() => {
      void saveRecoverySnapshot({
        session_id: active.id,
        project_id: workspaceProjectId,
        draft_content: "",
        messages_json: JSON.stringify(active.messages),
        saved_at: new Date().toISOString(),
      })
    }, 30_000)
    return () => clearInterval(timer)
  }, [active, workspaceProjectId, generating])

  const changes = useMemo(() => {
    if (!active) return []
    const out: { messageId: string; index: number; diff: DiffHunk }[] = []
    active.messages.forEach((m) => {
      m.diffs?.forEach((d, i) => out.push({ messageId: m.id, index: i, diff: d }))
    })
    return out
  }, [active])

  const openFile = useCallback((path: string) => {
    setActiveFile(path)
    setRightOpen(true)
  }, [])
  const chatMessages = useMemo(() => {
    const { messages } = stableChatMessages(
      active?.messages ?? [],
      chatMessagesCacheRef.current,
    )
    return messages
  }, [active?.messages])
  const hasChat = chatMessages.length > 0

  const hasPendingQuestions = useMemo(
    () =>
      (active?.messages ?? []).some(
        (m) => m.pendingQuestions?.status === "pending",
      ),
    [active?.messages],
  )

  const latestExecutablePlanId = useMemo(() => {
    if (!active || generating || hasPendingQuestions) return null
    return findLatestExecutablePlanMessageId(active.messages)
  }, [active, generating, hasPendingQuestions])

  const chatLayout = useMemo(() => {
    const msgs = chatMessages
    const { lastUserIdx, awaitingReply } = getReplyLayoutState(msgs, false, generating)
    const usePinned = awaitingReply && lastUserIdx >= 0
    return {
      usePinned,
      pinnedUser: usePinned ? msgs[lastUserIdx] : null,
      history: usePinned ? msgs.slice(0, lastUserIdx) : [],
      currentTurn: usePinned ? msgs.slice(lastUserIdx + 1) : [],
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

  const patchGeneratingMessage = useCallback(
    (messageId: string, patch: Partial<AssistantMessage>) => {
      const sessionId = generatingSessionRef.current
      if (!sessionId) return
      startTransition(() => {
        setSessions((prev) =>
          prev.map((s) =>
            s.id === sessionId
              ? {
                  ...s,
                  messages: s.messages.map((m) =>
                    m.id === messageId ? { ...m, ...patch } : m,
                  ),
                  updatedAt: new Date().toISOString(),
                }
              : s,
          ),
        )
      })
    },
    [],
  )

  const flushPendingActivity = useCallback(() => {
    activityFlushTimerRef.current = null
    const steps = pendingActivityStepsRef.current
    if (steps.length === 0) return
    pendingActivityStepsRef.current = []
    const messageId = activeAssistantMsgRef.current
    const sessionId = generatingSessionRef.current
    if (!messageId || !sessionId) return
    startTransition(() => {
      setSessions((prev) =>
        prev.map((s) =>
          s.id === sessionId
            ? {
                ...s,
                messages: s.messages.map((m) => {
                  if (m.id !== messageId) return m
                  let activitySteps = m.activitySteps ?? []
                  for (const step of steps) {
                    activitySteps = upsertActivityStep(activitySteps, step)
                  }
                  return { ...m, activitySteps }
                }),
                updatedAt: new Date().toISOString(),
              }
            : s,
        ),
      )
    })
  }, [])

  const queueActivityUpdate = useCallback(
    (step: ActivityStep) => {
      pendingActivityStepsRef.current.push(step)
      if (activityFlushTimerRef.current != null) return
      activityFlushTimerRef.current = window.setTimeout(flushPendingActivity, 150)
    },
    [flushPendingActivity],
  )

  const flushPendingActivitySync = useCallback(() => {
    if (activityFlushTimerRef.current != null) {
      window.clearTimeout(activityFlushTimerRef.current)
      activityFlushTimerRef.current = null
    }
    flushPendingActivity()
  }, [flushPendingActivity])

  const flushPendingToken = useCallback(() => {
    tokenFlushTimerRef.current = null
    const pending = pendingTokenRef.current
    if (!pending) return
    pendingTokenRef.current = null
    patchGeneratingMessage(pending.messageId, {
      content: pending.content,
      streaming: true,
    })
    scheduleFollowScroll()
  }, [patchGeneratingMessage, scheduleFollowScroll])

  const queueStreamingToken = useCallback(
    (messageId: string, content: string) => {
      pendingTokenRef.current = { messageId, content }
      if (tokenFlushTimerRef.current != null) return
      tokenFlushTimerRef.current = window.setTimeout(flushPendingToken, 150)
    },
    [flushPendingToken],
  )

  const flushPendingThoughtDetail = useCallback(() => {
    thoughtFlushTimerRef.current = null
    const pending = pendingThoughtDetailRef.current
    if (!pending) return
    pendingThoughtDetailRef.current = null
    const sessionId = generatingSessionRef.current
    if (!sessionId) return
    startTransition(() => {
      setSessions((prev) =>
        prev.map((s) =>
          s.id === sessionId
            ? {
                ...s,
                messages: s.messages.map((m) => {
                  if (m.id !== pending.messageId) return m
                  const activitySteps = (m.activitySteps ?? []).map((step) =>
                    step.id === pending.thoughtId
                      ? { ...step, detail: pending.detail }
                      : step,
                  )
                  return { ...m, activitySteps }
                }),
                updatedAt: new Date().toISOString(),
              }
            : s,
        ),
      )
    })
    scheduleFollowScroll()
  }, [scheduleFollowScroll])

  const queueThoughtDetail = useCallback(
    (messageId: string, thoughtId: string, detail: string) => {
      pendingThoughtDetailRef.current = { messageId, thoughtId, detail }
      if (thoughtFlushTimerRef.current != null) return
      thoughtFlushTimerRef.current = window.setTimeout(flushPendingThoughtDetail, 150)
    },
    [flushPendingThoughtDetail],
  )

  const flushPendingThoughtDetailSync = useCallback(() => {
    if (thoughtFlushTimerRef.current != null) {
      window.clearTimeout(thoughtFlushTimerRef.current)
      thoughtFlushTimerRef.current = null
    }
    flushPendingThoughtDetail()
  }, [flushPendingThoughtDetail])

  const flushStreamingTokenSync = useCallback(() => {
    if (tokenFlushTimerRef.current != null) {
      window.clearTimeout(tokenFlushTimerRef.current)
      tokenFlushTimerRef.current = null
    }
    const pending = pendingTokenRef.current
    if (!pending) return
    pendingTokenRef.current = null
    patchGeneratingMessage(pending.messageId, {
      content: pending.content,
      streaming: true,
    })
  }, [patchGeneratingMessage])

  const migrateStreamContentToThought = useCallback(
    (messageId: string, thoughtId: string, streamContent: string) => {
      if (!streamContent.trim()) return
      flushStreamingTokenSync()
      flushPendingThoughtDetailSync()
      const sessionId = generatingSessionRef.current
      if (!sessionId) return
      startTransition(() => {
        setSessions((prev) =>
          prev.map((s) =>
            s.id === sessionId
              ? {
                  ...s,
                  messages: s.messages.map((m) => {
                    if (m.id !== messageId) return m
                    const activitySteps = (m.activitySteps ?? []).map((step) =>
                      step.id === thoughtId
                        ? { ...step, detail: streamContent }
                        : step,
                    )
                    return { ...m, content: "", activitySteps }
                  }),
                  updatedAt: new Date().toISOString(),
                }
              : s,
          ),
        )
      })
      pendingTokenRef.current = null
    },
    [flushPendingThoughtDetailSync, flushStreamingTokenSync],
  )

  const handleLoopActivity = useCallback(
    (step: ActivityStep) => {
      if (step.kind === "thought") {
        if (step.status === "running") {
          activeThoughtIdRef.current = step.id
          roundHasToolDeltaRef.current = false
          streamContentBufferRef.current = ""
        } else if (
          activeThoughtIdRef.current === step.id &&
          (step.status === "success" || step.status === "error")
        ) {
          flushPendingThoughtDetailSync()
          activeThoughtIdRef.current = null
          if (
            step.status === "success" &&
            !roundHasToolDeltaRef.current &&
            hasCompletedToolStepsRef.current
          ) {
            step = { ...step, detail: undefined }
          }
        }
      }
      if (step.kind === "tool" && step.status === "success") {
        hasCompletedToolStepsRef.current = true
      }
      queueActivityUpdate(step)
    },
    [queueActivityUpdate, flushPendingThoughtDetailSync],
  )

  const routeChatToken = useCallback(
    (messageId: string, content: string) => {
      latestStreamContentRef.current = content
      const thoughtId = activeThoughtIdRef.current
      if (!thoughtId) {
        queueStreamingToken(messageId, content)
        return
      }
      if (roundHasToolDeltaRef.current || !hasCompletedToolStepsRef.current) {
        queueThoughtDetail(messageId, thoughtId, content)
        return
      }
      queueStreamingToken(messageId, content)
    },
    [queueThoughtDetail, queueStreamingToken],
  )

  const handleChatToolDelta = useCallback(
    (messageId: string) => {
      if (!activeThoughtIdRef.current) return
      if (roundHasToolDeltaRef.current) return
      roundHasToolDeltaRef.current = true
      migrateStreamContentToThought(
        messageId,
        activeThoughtIdRef.current,
        latestStreamContentRef.current,
      )
    },
    [migrateStreamContentToThought],
  )

  const lastAssistant = useMemo(() => {
    for (let i = chatMessages.length - 1; i >= 0; i--) {
      if (chatMessages[i].role === "assistant") return chatMessages[i]
    }
    return undefined
  }, [chatMessages])

  streamingActiveRef.current = generating || Boolean(lastAssistant?.streaming)


  const jumpToBottom = useCallback(() => {
    const c = scrollRef.current
    if (!c) return
    userScrolledUpRef.current = false
    scrollContainerToBottom(c, "instant")
    setShowJumpToBottom(false)
  }, [])

  const syncScrollFollowState = useCallback(() => {
    const container = scrollRef.current
    if (!container) return
    const nearBottom = isNearBottom(container, 96)
    userScrolledUpRef.current = !nearBottom
    setShowJumpToBottom(hasChat && !nearBottom)
  }, [hasChat])

  useEffect(() => {
    const container = scrollRef.current
    if (!container) return
    const onScroll = () => syncScrollFollowState()
    container.addEventListener("scroll", onScroll, { passive: true })
    return () => container.removeEventListener("scroll", onScroll)
  }, [syncScrollFollowState])

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
      setShowJumpToBottom(false)
    }

    const isStreaming =
      generating || Boolean(lastAssistant?.streaming)

    if (isStreaming) return

    const scrollOnce = () => {
      if (userScrolledUpRef.current && !justPinned) return
      scrollContainerToBottom(
        container,
        justPinned ? "instant" : "smooth",
      )
    }

    requestAnimationFrame(() => {
      scrollOnce()
      requestAnimationFrame(scrollOnce)
    })
  }, [
    active?.messages.length,
    generating,
    chatLayout.usePinned,
    active?.id,
    lastAssistant?.streaming,
  ])

  useLayoutEffect(() => {
    const container = scrollRef.current
    const content = scrollContentRef.current
    if (!container || !content) return

    const ro = new ResizeObserver(() => {
      if (streamingActiveRef.current) return
      if (userScrolledUpRef.current) {
        syncScrollFollowState()
        return
      }
      scheduleFollowScroll()
    })
    ro.observe(content)
    return () => ro.disconnect()
  }, [syncScrollFollowState, hasChat, scrollMessages.length, scheduleFollowScroll])

  const newSessionInWorkspace = (workspaceId: string) => {
    void (async () => {
      const ws = workspaces.find((w) => w.projectId === workspaceId)
      const fresh = await createPersistedSession({
        projectId: workspaceId,
        folder: ws?.localPath ?? null,
      })
      setSessions((prev) => [fresh, ...prev])
      setActiveId(fresh.id)
      setActiveWorkspaceId(workspaceId)
    })()
  }

  const handleAddLocalWorkspace = async () => {
    const ws = await addLocalWorkspace()
    if (ws) {
      await refreshWorkspaces()
      handleSelectWorkspace(ws.projectId)
    }
  }

  const handleAddSshWorkspace = async (input: {
    name: string
    host: string
    remotePath: string
  }) => {
    const ws = await addSshWorkspace(input)
    await refreshWorkspaces()
    handleSelectWorkspace(ws.projectId)
  }

  const executeRemoveWorkspace = async (workspace: AssistantWorkspace) => {
    try {
      await removeWorkspace(workspace)
      const list = await refreshWorkspaces()
      const reloaded = await loadPersistedSessions()
      if (reloaded.length > 0) {
        setSessions(reloaded)
        setActiveId((prev) => (reloaded.some((s) => s.id === prev) ? prev : reloaded[0].id))
      } else {
        const home = list[0]
        const fresh = await createPersistedSession({
          projectId: home?.projectId,
          folder: home?.localPath ?? null,
        })
        setSessions([fresh])
        setActiveId(fresh.id)
        if (home) setActiveWorkspaceId(home.projectId)
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      setToast(reason)
    }
  }

  const handleRemoveWorkspace = (workspace: AssistantWorkspace) => {
    setWorkspaceToRemove(workspace)
  }

  const deleteSession = (id: string) => {
    if (!sessions.some((s) => s.id === id)) return
    setSessionToDeleteId(id)
  }

  const executeDeleteSession = (id: string) => {
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
            if (next[0].projectId) setActiveWorkspaceId(next[0].projectId)
          } else {
            void createPersistedSession({
              projectId: activeWorkspace?.projectId,
              folder: activeWorkspace?.localPath ?? null,
            }).then((fresh) => {
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

  const send = async (
    text: string,
    _imageDataUrl?: string,
    opts?: {
      bulkWriteConfirmed?: boolean
      skipUserMessage?: boolean
      agentMode?: AgentMode
    },
  ) => {
    const content = text.trim()
    if (!content || generating || sendInFlightRef.current || !active) return

    const agentMode = opts?.agentMode ?? mode
    if (opts?.agentMode) setMode(opts.agentMode)

    sendInFlightRef.current = true
    setGenerating(true)
    generatingSessionRef.current = activeId
    stopRequestedRef.current = false
    activeThoughtIdRef.current = null
    roundHasToolDeltaRef.current = false
    hasCompletedToolStepsRef.current = false
    latestStreamContentRef.current = ""

    const isFirst = active.messages.length === 0
    const derivedTitle = isFirst ? deriveTitle(content) : active.title

    if (!opts?.skipUserMessage) {
      const userMsg: AssistantMessage = {
        id: `u-${Date.now()}`,
        role: "user",
        content,
        mode: agentMode,
        createdAt: new Date().toISOString(),
      }

      setSessions((prev) =>
        prev.map((s) =>
          s.id === activeId
            ? {
                ...s,
                title: isFirst ? derivedTitle : s.title,
                messages: [...s.messages, userMsg],
                updatedAt: new Date().toISOString(),
              }
            : s,
        ),
      )
      if (isFirst && isTauri()) {
        void updateSessionTitle(activeId, derivedTitle).catch(() => {})
      }
    }

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
        sendInFlightRef.current = false
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
      sendInFlightRef.current = false
      return
    }

    const assistantMsgId = `a-${Date.now()}`
    activeAssistantMsgRef.current = assistantMsgId
    setLlmError(null)

    const folder = await resolveWorkspaceFolder(activeWorkspace)
    let kbaseId = selectedKbaseId
    let selectedKbaseName = kbaseOptions.find((b) => b.id === kbaseId)?.name
    if (kbaseId && !selectedKbaseName) {
      handleKbaseChange(null)
      setToast("所选知识库已不存在，已自动取消选择")
      kbaseId = null
      selectedKbaseName = undefined
    }
    const hasKnowledge = Boolean(kbaseId)
    const sessionAgentMode: AgentMode = hasKnowledge ? "ask" : agentMode

    updateActiveMessages((msgs) => [
      ...finalizeProcessingMessages(msgs),
      {
        id: assistantMsgId,
        role: "assistant",
        content: "",
        streaming: true,
        mode: sessionAgentMode,
        createdAt: new Date().toISOString(),
      },
    ])

    streamContentBufferRef.current = ""
    const unlistenToken = onChatToken((e) => {
      if (e.session_id !== activeId || e.message_id !== assistantMsgId) return
      if (stopRequestedRef.current) return
      streamContentBufferRef.current += e.delta
      routeChatToken(assistantMsgId, streamContentBufferRef.current)
    })

    const unlistenToolDelta = onChatToolDelta((e) => {
      if (e.session_id !== activeId || e.message_id !== assistantMsgId) return
      if (stopRequestedRef.current) return
      handleChatToolDelta(assistantMsgId)
    })

    const unlistenActivity = onLoopActivity((e) => {
          if (e.session_id !== activeId || e.message_id !== assistantMsgId) return
          if (stopRequestedRef.current) return
          handleLoopActivity(mapActivityStep(e.step))
        })

    const apiKey = (await loadApiKey(modelCfg.id)) ?? undefined

    let memoryContext = ""
    if (!hasKnowledge && workspaceProjectId && isTauri()) {
      try {
        const { context } = await retrieveMemories(workspaceProjectId, content, 5)
        memoryContext = context
      } catch {
        /* degrade silently */
      }
    }

    const llmMessages = buildLlmMessages(active.messages, content)
    const system = buildAssistantSystemPrompt({
      folder,
      toolsEnabled: true,
      mode: sessionAgentMode,
      memoryContext,
      knowledgeSession: hasKnowledge,
      selectedKbaseName,
    })

    try {
      await tauriSendMessage({
        session_id: activeId,
        content,
        mode: sessionAgentMode,
      })

      const response = await aiLoopChat(
        {
          provider: modelCfg.provider,
          model: modelCfg.name,
          messages: llmMessages,
          system_prompt: system,
          api_key: apiKey,
          base_url: modelCfg.endpoint ?? undefined,
          assistant_mode: true,
          agent_mode: sessionAgentMode,
          edit_dry_run: hasKnowledge ? false : agentMode === "edit",
          bulk_write_confirmed: opts?.bulkWriteConfirmed,
          enabled_kbase_ids: kbaseId ? [kbaseId] : undefined,
        },
        activeId,
        workspaceProjectId!,
        assistantMsgId,
      )

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
            mode: response.mode ?? agentMode,
            diffs: response.diffs,
            pendingQuestions: response.pendingQuestions,
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
      void refreshGit()
      void refreshFileTree()
    } catch (err) {
      if (isChatCancelled(err)) {
        updateActiveMessages((msgs) =>
          msgs.map((m) => (m.id === assistantMsgId ? finalizeCancelledMessage(m) : m)),
        )
        return
      }
      const parsed = parseLlmError(err)
      if (parsed.kind === "bulk_write") {
        setPendingBulkRetry({ userText: content })
        setBulkWriteOpen(true)
        updateActiveMessages((msgs) => msgs.filter((m) => m.id !== assistantMsgId))
        return
      }
      setLlmError(parsed)
      updateActiveMessages((msgs) => msgs.filter((m) => m.id !== assistantMsgId))
    } finally {
      flushPendingActivitySync()
      flushPendingThoughtDetailSync()
      flushStreamingTokenSync()
      unlistenToken()
      unlistenToolDelta()
      unlistenActivity()
      activeThoughtIdRef.current = null
      roundHasToolDeltaRef.current = false
      hasCompletedToolStepsRef.current = false
      latestStreamContentRef.current = ""
      setGenerating(false)
      generatingSessionRef.current = null
      activeAssistantMsgRef.current = null
      sendInFlightRef.current = false
    }
  }

  const stopGeneration = () => {
    const sessionId = generatingSessionRef.current
    if (!sessionId || !generating) return
    stopRequestedRef.current = true
    if (isTauri()) void cancelChat(sessionId).catch(() => {})
    setSessions((prev) =>
      prev.map((s) =>
        s.id === sessionId
          ? {
              ...s,
              messages: finalizeProcessingMessages(s.messages),
              updatedAt: new Date().toISOString(),
            }
          : s,
      ),
    )
    setGenerating(false)
    generatingSessionRef.current = null
  }

  const executePlan = () => {
    if (!latestExecutablePlanId || generating || hasPendingQuestions) return
    if (!workspaceLocalPath) {
      setToast("请先绑定本地工作区目录后再执行计划")
      return
    }
    void send(EXECUTE_PLAN_MESSAGE, undefined, { agentMode: "auto" })
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

  const onQuestionSubmit = async (messageId: string, answers: QuestionAnswer[]) => {
    if (generating || !active || !activeId || !isTauri()) return

    setGenerating(true)
    generatingSessionRef.current = activeId
    stopRequestedRef.current = false
    activeThoughtIdRef.current = null
    roundHasToolDeltaRef.current = false
    latestStreamContentRef.current = ""
    activeAssistantMsgRef.current = messageId
    setLlmError(null)

    updateActiveMessages((msgs) =>
      msgs.map((m) =>
        m.id === messageId
          ? {
              ...m,
              streaming: true,
              content: "",
              pendingQuestions: m.pendingQuestions
                ? { ...m.pendingQuestions, status: "answered" as const, answers }
                : undefined,
            }
          : m,
      ),
    )

    streamContentBufferRef.current = ""
    const unlistenToken = onChatToken((e) => {
      if (e.session_id !== activeId || e.message_id !== messageId) return
      if (stopRequestedRef.current) return
      streamContentBufferRef.current += e.delta
      routeChatToken(messageId, streamContentBufferRef.current)
    })

    const unlistenToolDelta = onChatToolDelta((e) => {
      if (e.session_id !== activeId || e.message_id !== messageId) return
      if (stopRequestedRef.current) return
      handleChatToolDelta(messageId)
    })

    const unlistenActivity = workspaceProjectId
      ? onLoopActivity((e) => {
          if (e.session_id !== activeId || e.message_id !== messageId) return
          if (stopRequestedRef.current) return
          handleLoopActivity(mapActivityStep(e.step))
        })
      : () => {}

    try {
      const response = await continueAiLoop(activeId, messageId, answers)
      if (stopRequestedRef.current) return

      updateActiveMessages((msgs) =>
        msgs.map((m) => {
          if (m.id !== messageId) return m
          return {
            ...m,
            content: response.content || m.content,
            streaming: false,
            mode: response.mode ?? m.mode,
            diffs: response.diffs,
            pendingQuestions:
              response.pendingQuestions?.status === "pending"
                ? response.pendingQuestions
                : m.pendingQuestions
                  ? {
                      ...m.pendingQuestions,
                      status: "answered" as const,
                      answers: m.pendingQuestions.answers ?? answers,
                    }
                  : response.pendingQuestions,
            activitySteps:
              response.activitySteps?.length
                ? response.activitySteps
                : m.activitySteps?.length
                  ? m.activitySteps
                  : response.activitySteps,
          }
        }),
      )
      void refreshGit()
      void refreshFileTree()
    } catch (err) {
      if (isChatCancelled(err)) {
        updateActiveMessages((msgs) =>
          msgs.map((m) => (m.id === messageId ? finalizeCancelledMessage(m) : m)),
        )
        return
      }
      const parsed = parseLlmError(err)
      setLlmError(parsed)
      setToast(parsed.message)
      updateActiveMessages((msgs) =>
        msgs.map((m) =>
          m.id === messageId
            ? { ...m, streaming: false, pendingQuestions: m.pendingQuestions }
            : m,
        ),
      )
    } finally {
      flushPendingActivitySync()
      flushPendingThoughtDetailSync()
      flushStreamingTokenSync()
      unlistenToken()
      unlistenToolDelta()
      unlistenActivity()
      activeThoughtIdRef.current = null
      roundHasToolDeltaRef.current = false
      latestStreamContentRef.current = ""
      setGenerating(false)
      generatingSessionRef.current = null
      activeAssistantMsgRef.current = null
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

    if (!workspaceProjectId) return

    const statusMap = { accept: "applied", reject: "rejected", revert: "reverted" } as const

    try {
      if (action === "accept" && diff.editMeta && diff.changeId && isTauri()) {
        await applyChange(workspaceProjectId, {
          change_id: diff.changeId,
          path: diff.editMeta.path ?? diff.filePath,
          old_string: diff.editMeta.old_string ?? "",
          new_string: diff.editMeta.new_string ?? "",
          replace_all: diff.editMeta.replace_all,
          kind: diff.editMeta.kind,
        })
      } else if (action === "reject" && diff.changeId && isTauri()) {
        await rejectChange(diff.changeId)
      } else if (action === "revert" && diff.changeId && isTauri()) {
        await revertChange(workspaceProjectId, diff.changeId)
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
    void refreshGit()
    void refreshFileTree()
    setToast(action === "accept" ? "已采纳变更" : action === "reject" ? "已拒绝变更" : "已回滚变更")
  }

  return (
    <div className="flex h-[calc(100vh-34px)]">
      <WorkspaceSidebar
        workspaces={workspaces}
        sessionsByWorkspace={sessionsByWorkspace}
        activeWorkspaceId={activeWorkspaceId}
        activeSessionId={activeId}
        processingSessionIds={processingSessionIds}
        onSelectWorkspace={handleSelectWorkspace}
        onSelectSession={handleSelectSession}
        onNewSession={newSessionInWorkspace}
        onDeleteSession={deleteSession}
        onAddLocalWorkspace={handleAddLocalWorkspace}
        onAddSshWorkspace={handleAddSshWorkspace}
        onRemoveWorkspace={handleRemoveWorkspace}
        onOpenKnowledge={onOpenKnowledge}
        knowledgeCount={knowledgeCount}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
      />

      <div className="flex min-h-0 min-w-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <Sparkles className="size-5 shrink-0 text-primary" />
            <span className="truncate text-sm font-semibold">{active?.title ?? "Bosch Assistant"}</span>
            {activeWorkspace && (
              <span className="hidden truncate text-xs text-muted-foreground sm:inline">
                · {activeWorkspace.name}
              </span>
            )}
          </div>
          {!rightOpen && (
            <div className="flex shrink-0 items-center gap-1.5">
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setRightOpen(true)}
                aria-label="切换右栏"
                className="text-muted-foreground"
              >
                <PanelRight />
              </Button>
            </div>
          )}
        </header>

          <main className="flex min-h-0 flex-1 flex-col">

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

            {activeFile && workspaceProjectId && (
              <>
                <div className="flex items-center gap-2 border-b border-border bg-card px-3 py-1.5">
                  <FileCode2 className="size-3.5 text-muted-foreground" />
                  <span className="font-mono text-xs">{activeFile}</span>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="ml-auto"
                    onClick={() => setActiveFile(null)}
                    aria-label="关闭预览"
                  >
                    <X />
                  </Button>
                </div>
                <FilePreviewPanel projectId={workspaceProjectId} path={activeFile} />
              </>
            )}

        <div className="relative flex min-h-0 flex-1 flex-col">
          {floatingMessage && hasChat && (
            <div className="pointer-events-none absolute inset-x-0 top-0 z-20 border-b border-border bg-background/95 px-4 py-2 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-background/85">
              <div className="pointer-events-auto w-full">
                <ChatMessageView
                  message={floatingMessage}
                  variant="float"
                  onDiffAction={onDiffAction}
                  onQuestionSubmit={onQuestionSubmit}
                  onOpenFile={openFile}
                />
              </div>
            </div>
          )}

          <ScrollToBottomButton visible={showJumpToBottom} onClick={jumpToBottom} />

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
              <div
                ref={scrollContentRef}
                className="flex w-full flex-col gap-6 px-4 pb-8 pt-4 text-left"
              >
                {scrollMessages.map((m) => {
                  const view = (
                    <ChatMessageView
                      message={m}
                      variant={m.role === "user" ? "user-query" : "default"}
                      onDiffAction={onDiffAction}
                      onQuestionSubmit={onQuestionSubmit}
                      onOpenFile={openFile}
                      showPlanExecute={m.id === latestExecutablePlanId}
                      onExecutePlan={executePlan}
                      planExecuteDisabled={generating || hasPendingQuestions || !workspaceLocalPath}
                      planExecuteDisabledReason={
                        !workspaceLocalPath
                          ? "需要绑定本地工作区"
                          : generating
                            ? "任务进行中"
                            : hasPendingQuestions
                              ? "请先回答上方问题"
                              : undefined
                      }
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
          disabled={hasPendingQuestions}
          onStop={stopGeneration}
          onValidationError={setToast}
          enableSlashCommands={false}
          knowledgeBases={kbaseOptions}
          selectedKbaseId={selectedKbaseId}
          onKbaseChange={handleKbaseChange}
          lockAgentMode={Boolean(selectedKbaseId)}
          hideKnowledgeSelector={!isDesktopApp}
          prefillText={prefillText}
          onPrefillConsumed={() => setPrefillText(null)}
          placeholder={
            hasPendingQuestions
              ? "请先回答上方问题…"
              : "给 Bosch Assistant 发送消息…"
          }
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
          ]}
        />
          </main>
        </div>

          {rightOpen && workspaceProjectId && (
            <RightSidebar
              projectId={workspaceProjectId}
              workspaceName={activeWorkspace?.name}
              gitBranch={gitBranch}
              gitRemote={gitRemote}
              gitError={gitError}
              fileTree={fileTree}
              gitFiles={gitFiles}
              fileTreeLoading={fileTreeLoading}
              changes={changes}
              activeFile={activeFile}
              activeSessionId={activeId}
              onOpenFile={openFile}
              onDiffAction={onDiffAction}
              onGitRefresh={() => {
                void refreshGit()
                void refreshFileTree()
              }}
              onLoadChildren={loadTreeChildren}
              onFileTreeChange={setFileTree}
              onCopyPath={(p) => setToast(`已复制路径：${p}`)}
              onRevealInExplorer={(p) => {
                if (isTauri() && workspaceProjectId) {
                  void revealInExplorer(workspaceProjectId, p).catch((e) => setToast(String(e)))
                }
              }}
              onToggleRight={() => setRightOpen(false)}
            />
          )}
      </div>

      <BulkWriteDialog
        open={bulkWriteOpen}
        onCancel={() => {
          setBulkWriteOpen(false)
          setPendingBulkRetry(null)
        }}
        onConfirm={() => {
          setBulkWriteOpen(false)
          const pending = pendingBulkRetry
          setPendingBulkRetry(null)
          if (pending) {
            void send(pending.userText, undefined, {
              bulkWriteConfirmed: true,
              skipUserMessage: true,
            })
          }
        }}
      />

      <Modal
        open={workspaceToRemove !== null}
        onClose={() => setWorkspaceToRemove(null)}
        title="移除工作区？"
        description={
          workspaceToRemove
            ? `确定从侧栏移除工作区「${workspaceToRemove.name}」？关联会话记录也会被删除。`
            : undefined
        }
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setWorkspaceToRemove(null)}>
              取消
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                const ws = workspaceToRemove
                setWorkspaceToRemove(null)
                if (ws) void executeRemoveWorkspace(ws)
              }}
            >
              移除
            </Button>
          </>
        }
      />

      <Modal
        open={sessionToDeleteId !== null}
        onClose={() => setSessionToDeleteId(null)}
        title="删除对话？"
        description={
          sessionToDeleteId
            ? `确定删除对话「${sessions.find((s) => s.id === sessionToDeleteId)?.title ?? "未命名"}」？此操作不可撤销。`
            : undefined
        }
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setSessionToDeleteId(null)}>
              取消
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                const id = sessionToDeleteId
                setSessionToDeleteId(null)
                if (id) executeDeleteSession(id)
              }}
            >
              删除
            </Button>
          </>
        }
      />
    </div>
  )
}
