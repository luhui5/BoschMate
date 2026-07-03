"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import {
  PanelLeft,
  PanelRight,
  Settings,
  Sun,
  Moon,
  Wifi,
  WifiOff,
  TriangleAlert,
  FileCode2,
  X,
  Loader2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useApp } from "@/components/app-provider"
import { LeftSidebar } from "@/components/workspace/left-sidebar"
import { RightSidebar } from "@/components/workspace/right-sidebar"
import { ChatMessageView, getReplyLayoutState } from "@/components/workspace/chat-message"
import { useFloatingUserMessage } from "@/components/workspace/use-floating-user-message"
import { ChatInput } from "@/components/workspace/chat-input"
import { FilePreviewPanel } from "@/components/file-preview-panel"
import { BulkWriteDialog } from "@/components/bulk-write-dialog"
import { LlmErrorCard } from "@/components/llm-error-card"
import {
  projects as mockProjects,
  sessions as mockSessions,
  memories as mockMemories,
  notes as mockNotes,
} from "@/lib/mock-data"
import type { AgentMode, ActivityStep, ChatMessage, DiffHunk, FileNode, GitFile, Project, Session } from "@/lib/types"
import { cn } from "@/lib/utils"
import {
  isTauri,
  openProject,
  listSessions,
  listMessages,
  createSession,
  deleteSession as tauriDeleteSession,
  cancelChat,
  clearRecoverySnapshot,
  sendMessage as tauriSendMessage,
  streamChat,
  aiLoopChat,
  listDirectoryTree,
  gitStatus,
  listMemories,
  listNotes,
  applyChange,
  rejectChange,
  revertChange,
  saveRecoverySnapshot,
  watchProjectDir,
  revealInExplorer,
  onChatToken,
  retrieveMemories,
  onLoopActivity,
  mapActivityStep,
  type AiChatRequest,
  type AiLoopRequest,
} from "@/lib/tauri-api"
import { loadModels, findModel, loadApiKey, resolveActiveModelId, recordModelUsage, saveLastUsedModelId, type ModelConfig } from "@/lib/models"
import { parseCommand, executeCommand } from "@/lib/slash-commands"
import { parseLlmError, type ParsedLlmError } from "@/lib/llm-error"
import { isChatCancelled } from "@/lib/chat-cancel"

let idCounter = 1
const nextId = () => `gen-${idCounter++}`

function upsertActivityStep(steps: ActivityStep[], step: ActivityStep): ActivityStep[] {
  const idx = steps.findIndex((s) => s.id === step.id)
  if (idx >= 0) {
    const next = [...steps]
    next[idx] = step
    return next
  }
  return [...steps, step]
}

function modeSystemPrompt(mode: AgentMode): string {
  switch (mode) {
    case "ask":
      return "You are BoschCode assistant. Answer questions about the project. Do not modify files."
    case "plan":
      return "You are BoschCode planner. Produce a structured Markdown plan. Do not modify files or run commands."
    case "edit":
      return "You are BoschCode editor. Propose changes using tools. Wait for user confirmation before applying destructive edits when possible."
    case "auto":
      return "You are BoschCode automation agent. Use tools to read, edit, test and verify changes in the project."
    default:
      return ""
  }
}

function finalizeCancelledMessage(m: ChatMessage): ChatMessage {
  return {
    ...m,
    streaming: false,
    content: m.content.trim() || "（已中止）",
    activitySteps: m.activitySteps?.map((s) =>
      s.status === "running" ? { ...s, status: "error" as const, result: "已中止" } : s,
    ),
  }
}

export function WorkspaceView({ projectId }: { projectId: string }) {
  const { resolvedTheme, toggleTheme, runMode } = useApp()

  const [project, setProject] = useState<Project | null>(null)
  const [projectLoading, setProjectLoading] = useState(true)
  const [sessions, setSessions] = useState<Session[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string>("")
  const [mode, setMode] = useState<AgentMode>("ask")
  const [availableModels, setAvailableModels] = useState<ModelConfig[]>([])
  const [selectedModelId, setSelectedModelId] = useState("")
  const [leftOpen, setLeftOpen] = useState(true)
  const [rightOpen, setRightOpen] = useState(true)
  const [activeFile, setActiveFile] = useState<string | null>(null)
  const [thinking, setThinking] = useState(false)
  const [generating, setGenerating] = useState(false)
  const generatingSessionRef = useRef<string | null>(null)
  const stopRequestedRef = useRef(false)
  const [toast, setToast] = useState<string | null>(null)
  const [llmError, setLlmError] = useState<ParsedLlmError | null>(null)
  const [bulkWriteOpen, setBulkWriteOpen] = useState(false)
  const [pendingBulkRetry, setPendingBulkRetry] = useState<{
    sessionId: string
    history: ChatMessage[]
    userText: string
  } | null>(null)
  const [fileTree, setFileTree] = useState<FileNode[]>([])
  const [sessionPrefsTick, setSessionPrefsTick] = useState(0)
  const [fileTreeLoading, setFileTreeLoading] = useState(false)
  const [gitFiles, setGitFiles] = useState<GitFile[]>([])
  const [gitBranch, setGitBranch] = useState("main")
  const [projectMemories, setProjectMemories] = useState(mockMemories)
  const [projectNotes, setProjectNotes] = useState(mockNotes)

  const scrollRef = useRef<HTMLDivElement>(null)
  const userScrolledUpRef = useRef(false)
  const prevPinnedRef = useRef(false)
  const prevMsgCountRef = useRef(0)

  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null

  const chatLayout = useMemo(() => {
    const empty = {
      usePinned: false,
      pinnedUser: null as ChatMessage | null,
      history: [] as ChatMessage[],
      currentTurn: [] as ChatMessage[],
      allMessages: [] as ChatMessage[],
    }
    if (!activeSession) return empty
    const msgs = activeSession.messages
    const { lastUserIdx, awaitingReply, afterUser } = getReplyLayoutState(
      msgs,
      thinking,
      generating,
    )
    const usePinned = awaitingReply && lastUserIdx >= 0
    return {
      usePinned,
      pinnedUser: usePinned ? msgs[lastUserIdx] : null,
      history: usePinned ? msgs.slice(0, lastUserIdx) : [],
      currentTurn: usePinned ? afterUser : [],
      allMessages: msgs,
    }
  }, [activeSession, thinking, generating])

  const scrollMessages = useMemo(() => {
    if (!activeSession) return [] as ChatMessage[]
    if (chatLayout.usePinned && chatLayout.pinnedUser) {
      return [...chatLayout.history, chatLayout.pinnedUser, ...chatLayout.currentTurn]
    }
    return chatLayout.allMessages
  }, [activeSession, chatLayout])

  const { floatingMessage, registerUserMessageRef } = useFloatingUserMessage(
    scrollRef,
    scrollMessages,
  )

  const refreshModels = useCallback(() => {
    loadModels()
      .then(async (models) => {
        setAvailableModels(models)
        const preferred = await resolveActiveModelId(models)
        setSelectedModelId((prev) =>
          prev && models.some((m) => m.id === prev) ? prev : preferred,
        )
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    refreshModels()
    window.addEventListener("focus", refreshModels)
    return () => window.removeEventListener("focus", refreshModels)
  }, [refreshModels])

  const changes = useMemo(() => {
    if (!activeSession) return []
    const out: { messageId: string; index: number; diff: DiffHunk }[] = []
    activeSession.messages.forEach((m) => {
      m.diffs?.forEach((d, i) => out.push({ messageId: m.id, index: i, diff: d }))
    })
    return out
  }, [activeSession])

  const refreshGit = useCallback(async () => {
    if (!isTauri() || !project) return
    try {
      const status = await gitStatus(project.id)
      setGitFiles(status.files)
      setGitBranch(status.branch)
    } catch {
      setGitFiles([])
    }
  }, [project])

  const refreshFileTree = useCallback(async () => {
    if (!isTauri() || !project) return
    setFileTreeLoading(true)
    try {
      const nodes = await listDirectoryTree(project.id, project.localPath)
      setFileTree(nodes)
    } catch {
      setFileTree([])
    } finally {
      setFileTreeLoading(false)
    }
  }, [project])

  // Load project
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setProjectLoading(true)
      if (isTauri()) {
        try {
          const opened = await openProject(projectId)
          if (cancelled) return
          setProject(opened)
          setGitBranch(opened.gitBranch)
          const [mems, notes] = await Promise.all([
            listMemories(projectId).catch(() => []),
            listNotes(projectId).catch(() => []),
          ])
          if (!cancelled) {
            setProjectMemories(mems.length ? mems : mockMemories.filter((m) => m.projectId === projectId))
            setProjectNotes(notes.length ? notes.map((n) => ({ id: n.id, title: n.title, body: n.body, updatedAt: n.updatedAt })) : mockNotes)
          }
        } catch {
          if (!cancelled) {
            const fallback = mockProjects.find((p) => p.id === projectId) ?? mockProjects[0]
            setProject(fallback ?? null)
          }
        } finally {
          if (!cancelled) setProjectLoading(false)
        }
        return
      }
      const fallback = mockProjects.find((p) => p.id === projectId) ?? mockProjects[0]
      if (!cancelled) {
        setProject(fallback ?? null)
        setProjectLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [projectId])

  // Load sessions
  useEffect(() => {
    if (!project) return
    let cancelled = false
    const sync = async () => {
      if (isTauri()) {
        try {
          const realSessions = await listSessions(project.id)
          const sessionsWithMessages = await Promise.all(
            realSessions.map(async (rs) => {
              try {
                const msgs = await listMessages(rs.id)
                return { ...rs, messages: msgs }
              } catch {
                return { ...rs, messages: [] as ChatMessage[] }
              }
            }),
          )
          if (cancelled) return
          setSessions(sessionsWithMessages)
          if (sessionsWithMessages.length > 0) {
            setActiveSessionId((prev) => prev || sessionsWithMessages[0].id)
            setMode(sessionsWithMessages[0].mode)
          }
          return
        } catch { /* fallback */ }
      }
      const mock = mockSessions.filter((s) => s.projectId === project.id)
      if (!cancelled) {
        setSessions(mock.length ? mock.map((s) => ({ ...s })) : [])
        if (mock[0]) {
          setActiveSessionId(mock[0].id)
          setMode(mock[0].mode)
        }
      }
    }
    sync()
    return () => { cancelled = true }
  }, [project])

  // File tree + git
  useEffect(() => {
    if (!project) return
    refreshFileTree()
    refreshGit()
  }, [project, refreshFileTree, refreshGit])

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
    if (!container || !activeSession) return

    const justPinned = chatLayout.usePinned && !prevPinnedRef.current
    const msgCount = activeSession.messages.length
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
  }, [activeSession?.messages, thinking, generating, chatLayout.usePinned])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2500)
    return () => clearTimeout(t)
  }, [toast])

  // File watcher + crash recovery autosave
  useEffect(() => {
    if (!project || !isTauri()) return
    watchProjectDir(project.id).catch(() => {})
    const onFileChanged = async () => {
      await refreshFileTree()
      await refreshGit()
    }
    let unlisten: (() => void) | undefined
    import("@tauri-apps/api/event").then(({ listen }) => {
      listen<{ project_id: string }>("file-changed", (e) => {
        if (e.payload.project_id === project.id) void onFileChanged()
      }).then((fn) => { unlisten = fn })
    })
    return () => { unlisten?.() }
  }, [project, refreshFileTree, refreshGit])

  useEffect(() => {
    if (!activeSession || !project || !isTauri()) return
    const timer = setInterval(() => {
      void saveRecoverySnapshot({
        session_id: activeSession.id,
        project_id: project.id,
        draft_content: "",
        messages_json: JSON.stringify(activeSession.messages),
        saved_at: new Date().toISOString(),
      })
    }, 30_000)
    return () => clearInterval(timer)
  }, [activeSession, project])

  const updateSession = (id: string, fn: (s: Session) => Session) =>
    setSessions((prev) => prev.map((s) => (s.id === id ? fn(s) : s)))

  const newSession = async () => {
    if (!project) return
    if (isTauri()) {
      try {
        const s = await createSession({ project_id: project.id, title: "新会话", mode })
        const session: Session = { ...s, messages: [] }
        setSessions((prev) => [session, ...prev])
        setActiveSessionId(s.id)
        return
      } catch { /* fallback */ }
    }
    const id = nextId()
    const s: Session = {
      id,
      projectId: project.id,
      title: "新会话",
      mode,
      status: "active",
      updatedAt: new Date().toISOString(),
      tokenCount: 0,
      messages: [],
    }
    setSessions((prev) => [s, ...prev])
    setActiveSessionId(id)
  }

  const removeSession = async (id: string) => {
    const target = sessions.find((s) => s.id === id)
    if (!target) return
    if (!window.confirm(`确定删除会话「${target.title}」？此操作不可撤销。`)) return

    if (isTauri()) {
      try {
        await tauriDeleteSession(id)
        await clearRecoverySnapshot(id).catch(() => {})
      } catch (err) {
        setToast(`删除失败：${String(err)}`)
        return
      }
    }

    const remaining = sessions.filter((s) => s.id !== id)
    setSessions(remaining)

    if (id === activeSessionId) {
      if (remaining.length > 0) {
        setActiveSessionId(remaining[0].id)
        setMode(remaining[0].mode)
      } else {
        await newSession()
      }
    }
  }

  const loadTreeChildren = useCallback(
    async (dirPath: string) => {
      if (!project) return []
      return listDirectoryTree(project.id, project.localPath, dirPath)
    },
    [project],
  )

  const requestAiReply = async (
    sessionId: string,
    history: ChatMessage[],
    userText: string,
    opts?: { bulkWriteConfirmed?: boolean },
  ) => {
    if (!project) return

    if (!isTauri()) {
      simulateReply(sessionId, userText)
      return
    }

    const models = availableModels.length ? availableModels : await loadModels()
    const modelCfg =
      findModel(models, selectedModelId) ??
      findModel(models, await resolveActiveModelId(models)) ??
      models[0]
    if (!modelCfg) {
      const errMsg: ChatMessage = {
        id: nextId(),
        role: "assistant",
        content: "未配置模型。请前往 设置 → 模型配置 添加 Ollama 或云端 API 模型。",
        createdAt: new Date().toISOString(),
        mode,
      }
      updateSession(sessionId, (s) => ({
        ...s,
        messages: [...s.messages, errMsg],
        updatedAt: new Date().toISOString(),
      }))
      return
    }

    const apiKey = (await loadApiKey(modelCfg.id)) ?? undefined
    const convo = history.map((m) => ({ role: m.role, content: m.content }))
    let system = modeSystemPrompt(mode)
    if (isTauri() && userText.trim()) {
      try {
        const { context } = await retrieveMemories(project.id, userText, 8)
        if (context) system = `${system}\n\n${context}`
      } catch {
        // degraded — keyword fallback handled server-side
      }
    }
    setLlmError(null)

    generatingSessionRef.current = sessionId
    stopRequestedRef.current = false
    setGenerating(true)

    const streamId = nextId()
    const useLoop = mode === "edit" || mode === "auto"
    if (useLoop) {
      updateSession(sessionId, (s) => ({
        ...s,
        messages: [
          ...s.messages,
          {
            id: streamId,
            role: "assistant",
            content: "",
            streaming: true,
            createdAt: new Date().toISOString(),
            mode,
          },
        ],
      }))
    }

    const unlisten = useLoop
      ? onChatToken((e) => {
          if (e.session_id !== sessionId) return
          updateSession(sessionId, (s) => ({
            ...s,
            messages: s.messages.map((m) =>
              m.id === streamId ? { ...m, content: e.content, streaming: true } : m,
            ),
          }))
        })
      : () => {}

    const unlistenActivity = useLoop
      ? onLoopActivity((e) => {
          if (e.session_id !== sessionId) return
          const step = mapActivityStep(e.step)
          updateSession(sessionId, (s) => ({
            ...s,
            messages: s.messages.map((m) =>
              m.id === streamId
                ? {
                    ...m,
                    activitySteps: upsertActivityStep(m.activitySteps ?? [], step),
                  }
                : m,
            ),
          }))
        })
      : () => {}

    try {
      let reply: ChatMessage
      if (useLoop) {
        const loopInput: AiLoopRequest = {
          provider: modelCfg.provider,
          model: modelCfg.name,
          messages: convo,
          system_prompt: system,
          api_key: apiKey,
          base_url: modelCfg.endpoint ?? undefined,
          edit_dry_run: mode === "edit",
          agent_mode: mode,
          bulk_write_confirmed: opts?.bulkWriteConfirmed,
        }
        reply = await aiLoopChat(loopInput, sessionId, project.id)
      } else {
        const request: AiChatRequest = {
          provider: modelCfg.provider,
          model: modelCfg.name,
          messages: convo,
          temperature: modelCfg.temperature,
          max_tokens: 4096,
          api_key: apiKey,
          base_url: modelCfg.endpoint ?? undefined,
          system,
        }
        reply = await streamChat(request, sessionId)
      }
      reply.mode = mode
      if (stopRequestedRef.current) return
      updateSession(sessionId, (s) => ({
        ...s,
        messages: useLoop
          ? s.messages.map((m) => {
              if (m.id !== streamId) return m
              const activitySteps =
                reply.activitySteps?.length
                  ? reply.activitySteps
                  : m.activitySteps?.length
                    ? m.activitySteps
                    : reply.activitySteps
              return {
                ...reply,
                streaming: false,
                activitySteps,
                content: reply.content || m.content,
              }
            })
          : [...s.messages, reply],
        updatedAt: new Date().toISOString(),
      }))
      if (modelCfg) await recordModelUsage(modelCfg.id)
      await refreshGit()
      await refreshFileTree()
    } catch (err) {
      if (isChatCancelled(err)) {
        updateSession(sessionId, (s) => ({
          ...s,
          messages: useLoop
            ? s.messages.map((m) => (m.id === streamId ? finalizeCancelledMessage(m) : m))
            : s.messages,
          updatedAt: new Date().toISOString(),
        }))
        return
      }
      const parsed = parseLlmError(err)
      if (parsed.kind === "bulk_write") {
        setPendingBulkRetry({ sessionId, history, userText })
        setBulkWriteOpen(true)
        updateSession(sessionId, (s) => ({
          ...s,
          messages: s.messages.filter((m) => m.id !== streamId),
        }))
        return
      }
      setLlmError(parsed)
      updateSession(sessionId, (s) => ({
        ...s,
        messages: useLoop
          ? s.messages.filter((m) => m.id !== streamId)
          : s.messages,
      }))
      updateSession(sessionId, (s) => ({
        ...s,
        messages: [
          ...s.messages,
          {
            id: nextId(),
            role: "assistant",
            content: parsed.message,
            createdAt: new Date().toISOString(),
            mode,
          },
        ],
        updatedAt: new Date().toISOString(),
      }))
    } finally {
      unlisten()
      unlistenActivity()
      if (generatingSessionRef.current === sessionId) {
        generatingSessionRef.current = null
        setGenerating(false)
      }
    }
  }

  const stopGeneration = () => {
    const sessionId = generatingSessionRef.current
    if (!sessionId) return
    stopRequestedRef.current = true
    if (isTauri()) void cancelChat(sessionId).catch(() => {})
    updateSession(sessionId, (s) => ({
      ...s,
      messages: s.messages.map((m) => (m.streaming ? finalizeCancelledMessage(m) : m)),
      updatedAt: new Date().toISOString(),
    }))
    setThinking(false)
    setGenerating(false)
    generatingSessionRef.current = null
  }

  const simulateReply = (sessionId: string, prompt: string) => {
    setThinking(true)
    setTimeout(() => {
      setThinking(false)
      const content =
        mode === "plan"
          ? `## 计划\n\n1. 分析需求：${prompt.slice(0, 30)}\n2. 检索相关上下文\n3. 生成执行步骤\n\n（浏览器预览模式，请使用桌面应用获得完整 Agent 能力）`
          : mode === "ask"
            ? `根据项目上下文：${prompt.slice(0, 40)}…\n\n（浏览器预览模式）`
            : `已理解需求。（浏览器预览模式，桌面版将执行真实代码修改）`
      updateSession(sessionId, (s) => ({
        ...s,
        messages: [
          ...s.messages,
          {
            id: nextId(),
            role: "assistant",
            mode,
            content,
            createdAt: new Date().toISOString(),
          },
        ],
        updatedAt: new Date().toISOString(),
      }))
    }, 900)
  }

  const send = async (text: string, imageDataUrl?: string) => {
    if (!project) return

    let payload = text.trim()
    if (imageDataUrl) {
      const kb = Math.round((imageDataUrl.length * 3) / 4 / 1024)
      payload = `${payload}\n\n[附带截图 ~${kb}KB — 请结合文字分析界面/代码问题]`
    }
    if (!payload) return

    const slash = parseCommand(payload.trim())
    if (slash) {
      setThinking(true)
      try {
        const result = await executeCommand(slash.command, { projectId: project.id }, slash.args)
        const { id: sessionId, messages: prior } = activeSession
          ? { id: activeSession.id, messages: activeSession.messages }
          : await (async () => {
              if (isTauri()) {
                const s = await createSession({ project_id: project.id, title: `/${slash.command}`, mode })
                const session: Session = { ...s, messages: [] }
                setSessions((prev) => [session, ...prev])
                setActiveSessionId(s.id)
                return { id: s.id, messages: [] as ChatMessage[] }
              }
              const id = nextId()
              const s: Session = {
                id, projectId: project.id, title: `/${slash.command}`, mode,
                status: "active", updatedAt: new Date().toISOString(), tokenCount: 0, messages: [],
              }
              setSessions((prev) => [s, ...prev])
              setActiveSessionId(id)
              return { id, messages: [] as ChatMessage[] }
            })()

        const userMsg: ChatMessage = {
          id: nextId(), role: "user", content: payload, createdAt: new Date().toISOString(), mode,
        }
        const assistantMsg: ChatMessage = {
          id: nextId(), role: "assistant", content: result, createdAt: new Date().toISOString(), mode,
        }
        updateSession(sessionId, (s) => ({
          ...s,
          messages: [...prior, userMsg, assistantMsg],
          updatedAt: new Date().toISOString(),
        }))
      } finally {
        setThinking(false)
      }
      return
    }

    const ensureSession = async (): Promise<{ id: string; messages: ChatMessage[] }> => {
      if (activeSession) return { id: activeSession.id, messages: activeSession.messages }
      if (isTauri()) {
        const s = await createSession({
          project_id: project.id,
          title: payload.slice(0, 20),
          mode,
        })
        const session: Session = { ...s, messages: [] }
        setSessions((prev) => [session, ...prev])
        setActiveSessionId(s.id)
        return { id: s.id, messages: [] }
      }
      const id = nextId()
      const s: Session = {
        id,
        projectId: project.id,
        title: payload.slice(0, 20),
        mode,
        status: "active",
        updatedAt: new Date().toISOString(),
        tokenCount: 0,
        messages: [],
      }
      setSessions((prev) => [s, ...prev])
      setActiveSessionId(id)
      return { id, messages: [] }
    }

    const willUseLoop = mode === "edit" || mode === "auto"
    if (!willUseLoop) setThinking(true)
    try {
      const { id: sessionId, messages: prior } = await ensureSession()

      let userMsg: ChatMessage
      if (isTauri()) {
        userMsg = await tauriSendMessage({
          session_id: sessionId,
          content: payload,
          mode,
        })
      } else {
        userMsg = {
          id: nextId(),
          role: "user",
          content: payload,
          createdAt: new Date().toISOString(),
          mode,
        }
      }

      const nextMessages = [...prior, userMsg]
      updateSession(sessionId, (s) => ({
        ...s,
        title: s.messages.length === 0 ? payload.slice(0, 20) : s.title,
        messages: nextMessages,
        updatedAt: new Date().toISOString(),
      }))

      await requestAiReply(sessionId, nextMessages, payload)
    } finally {
      if (!willUseLoop) setThinking(false)
    }
  }

  const onDiffAction = async (
    messageId: string,
    diffIndex: number,
    action: "accept" | "reject" | "revert",
  ) => {
    if (!activeSession || !project) return
    const msg = activeSession.messages.find((m) => m.id === messageId)
    const diff = msg?.diffs?.[diffIndex]
    if (!diff) return

    const statusMap = { accept: "applied", reject: "rejected", revert: "reverted" } as const

    try {
      if (action === "accept" && diff.editMeta && diff.changeId && isTauri()) {
        await applyChange(project.id, {
          change_id: diff.changeId,
          path: diff.editMeta.path ?? diff.filePath,
          old_string: diff.editMeta.old_string ?? "",
          new_string: diff.editMeta.new_string ?? "",
          replace_all: diff.editMeta.replace_all,
        })
        await refreshFileTree()
        await refreshGit()
      } else if (action === "reject" && diff.changeId && isTauri()) {
        await rejectChange(diff.changeId)
      } else if (action === "revert" && diff.changeId && isTauri()) {
        await revertChange(project.id, diff.changeId)
        await refreshFileTree()
        await refreshGit()
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      setToast(`操作失败：${reason}`)
      return
    }

    updateSession(activeSession.id, (s) => ({
      ...s,
      messages: s.messages.map((m) =>
        m.id === messageId
          ? {
              ...m,
              diffs: m.diffs?.map((d, i) =>
                i === diffIndex ? { ...d, status: statusMap[action] } : d,
              ),
            }
          : m,
      ),
    }))
    setToast(action === "accept" ? "已采纳变更" : action === "reject" ? "已拒绝变更" : "已回滚变更")
  }

  const onQuickAction = (action: string) => {
    if (action === "upload") {
      setToast("请使用 + 或粘贴图片到输入框")
      return
    }
    void send(action)
  }

  const openFile = (path: string) => {
    setActiveFile(path)
    setRightOpen(true)
  }

  const mergeSession = (sourceId: string, targetId: string) => {
    const source = sessions.find((s) => s.id === sourceId)
    if (!source) return
    updateSession(targetId, (s) => ({
      ...s,
      messages: [...s.messages, ...source.messages].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      ),
      updatedAt: new Date().toISOString(),
    }))
    setToast(`已合并「${source.title}」到当前会话`)
  }

  if (projectLoading) {
    return (
      <div className="flex h-[calc(100dvh-34px)] items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
        加载项目…
      </div>
    )
  }

  if (!project) {
    return (
      <div className="flex h-[calc(100dvh-34px)] flex-col items-center justify-center gap-4">
        <p className="text-sm text-muted-foreground">项目不存在或无法加载</p>
        <Button nativeButton={false} render={<Link href="/">返回主页</Link>}>
          返回主页
        </Button>
      </div>
    )
  }

  return (
    <div className="flex h-[calc(100dvh-34px)] flex-col bg-background">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
        <Button
          variant="ghost"
          size="icon-sm"
          nativeButton={false}
          render={<Link href="/" aria-label="返回主页" />}
        >
          <span className="font-mono text-sm font-bold text-primary">{"</>"}</span>
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setLeftOpen((o) => !o)}
          aria-label="切换左栏"
          className={leftOpen ? "text-foreground" : "text-muted-foreground"}
        >
          <PanelLeft />
        </Button>
        <div className="flex items-center gap-1.5 text-sm">
          <span className="font-medium">{project.name}</span>
          <span className="text-muted-foreground">/</span>
          <span className="text-muted-foreground">{activeSession?.title ?? "无会话"}</span>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <div className="flex items-center rounded-md border border-border p-0.5" title="由健康探测自动更新">
            {(["full", "degraded", "offline"] as const).map((m) => (
              <span
                key={m}
                className={cn(
                  "flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium",
                  runMode === m
                    ? m === "full"
                      ? "bg-success/15 text-success"
                      : m === "degraded"
                        ? "bg-warning/15 text-warning"
                        : "bg-destructive/15 text-destructive"
                    : "text-muted-foreground/40",
                )}
              >
                {m === "full" ? <Wifi className="size-3" /> : m === "degraded" ? <TriangleAlert className="size-3" /> : <WifiOff className="size-3" />}
                {m === "full" ? "Full" : m === "degraded" ? "降级" : "离线"}
              </span>
            ))}
          </div>
          {activeSession && (
            <Badge variant="outline">{(activeSession.tokenCount / 1000).toFixed(1)}k tokens</Badge>
          )}
          <Button variant="ghost" size="icon-sm" onClick={toggleTheme} aria-label="切换主题">
            {resolvedTheme === "dark" ? <Sun /> : <Moon />}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            nativeButton={false}
            render={<Link href="/settings" aria-label="设置" />}
          >
            <Settings />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setRightOpen((o) => !o)}
            aria-label="切换右栏"
            className={rightOpen ? "text-foreground" : "text-muted-foreground"}
          >
            <PanelRight />
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {leftOpen && (
          <LeftSidebar
            key={sessionPrefsTick}
            project={project}
            sessions={sessions}
            memories={projectMemories}
            notes={projectNotes}
            activeSessionId={activeSessionId}
            onSelectSession={(id) => {
              setActiveSessionId(id)
              const s = sessions.find((x) => x.id === id)
              if (s) setMode(s.mode)
            }}
            onNewSession={newSession}
            onMergeSession={mergeSession}
            onDeleteSession={removeSession}
            onSessionsChange={() => setSessionPrefsTick((t) => t + 1)}
          />
        )}

        <main className="flex min-w-0 flex-1 flex-col">
          {activeFile && (
            <div className="flex items-center gap-2 border-b border-border bg-card px-3 py-1.5">
              <FileCode2 className="size-3.5 text-muted-foreground" />
              <span className="font-mono text-xs">{activeFile}</span>
              <Button variant="ghost" size="icon-xs" className="ml-auto" onClick={() => setActiveFile(null)} aria-label="关闭预览">
                <X />
              </Button>
            </div>
          )}
          {activeFile && project && <FilePreviewPanel projectId={project.id} path={activeFile} />}

          {llmError && (
            <div className="border-b border-border px-4 py-2">
              <LlmErrorCard
                error={llmError}
                onRetry={() => {
                  setLlmError(null)
                  if (activeSession) {
                    const lastUser = [...activeSession.messages].reverse().find((m) => m.role === "user")
                    if (lastUser) {
                      void requestAiReply(activeSession.id, activeSession.messages.slice(0, -1), lastUser.content)
                    }
                  }
                }}
              />
            </div>
          )}

          <div className="relative flex min-h-0 flex-1 flex-col">
            {floatingMessage && activeSession && activeSession.messages.length > 0 && (
              <div className="pointer-events-none absolute inset-x-0 top-0 z-20 border-b border-border bg-background/95 px-4 py-2 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-background/85">
                <div className="pointer-events-auto w-full">
                  <ChatMessageView
                    message={floatingMessage}
                    variant="float"
                    onDiffAction={onDiffAction}
                    onOpenFile={openFile}
                  />
                </div>
              </div>
            )}

            <div ref={scrollRef} className="flex-1 overflow-y-auto scrollbar-thin">
              {!activeSession || activeSession.messages.length === 0 ? (
                <div className="flex h-full flex-col items-start justify-center gap-4 px-6 text-left">
                  <span className="flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground font-mono text-lg font-bold">
                    {"</>"}
                  </span>
                  <div>
                    <p className="text-sm font-medium">开始与 BoschCode 协作</p>
                    <p className="mt-1 max-w-sm text-xs text-muted-foreground">
                      描述你的需求，Agent 会检索项目上下文与长期记忆，按当前模式理解、计划、执行并验证。
                    </p>
                  </div>
                  <div className="flex flex-wrap justify-center gap-2">
                    {["解释这个项目的架构", "修复登录的会话过期问题", "为压缩器补充单元测试"].map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => send(s)}
                        className="rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                      >
                        {s}
                      </button>
                    ))}
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
                        onOpenFile={openFile}
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
                  {thinking &&
                    !scrollMessages.some((m) => m.role === "assistant" && m.streaming) && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground font-mono text-xs font-bold">
                          {"</>"}
                        </span>
                        <span className="flex gap-1">
                          <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.3s]" />
                          <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.15s]" />
                          <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground" />
                        </span>
                      </div>
                    )}
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
            selectedModelId={selectedModelId}
            onModelChange={(id) => {
              setSelectedModelId(id)
              void saveLastUsedModelId(id)
            }}
            onValidationError={setToast}
            disabled={runMode === "offline"}
            degraded={runMode === "degraded"}
            generating={generating}
            onStop={stopGeneration}
          />
        </main>

        {rightOpen && (
          <RightSidebar
            projectId={project.id}
            gitBranch={gitBranch}
            gitRemote={project.gitRemote}
            fileTree={fileTree}
            gitFiles={gitFiles}
            fileTreeLoading={fileTreeLoading}
            changes={changes}
            activeFile={activeFile}
            activeSessionId={activeSessionId}
            onOpenFile={openFile}
            onDiffAction={onDiffAction}
            onGitRefresh={() => { void refreshGit(); void refreshFileTree() }}
            onLoadChildren={loadTreeChildren}
            onFileTreeChange={setFileTree}
            onCopyPath={(p) => setToast(`已复制路径：${p}`)}
            onRevealInExplorer={(p) => {
              if (isTauri()) void revealInExplorer(project.id, p).catch((e) => setToast(String(e)))
            }}
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
            void requestAiReply(pending.sessionId, pending.history, pending.userText, {
              bulkWriteConfirmed: true,
            })
          }
        }}
      />

      {toast && (
        <div className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-border bg-popover px-4 py-2 text-sm shadow-xl">
          {toast}
        </div>
      )}
    </div>
  )
}
