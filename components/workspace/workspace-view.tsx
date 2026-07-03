"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
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
import { ChatMessageView } from "@/components/workspace/chat-message"
import { ChatInput } from "@/components/workspace/chat-input"
import {
  projects as mockProjects,
  sessions as mockSessions,
  memories as mockMemories,
  notes as mockNotes,
} from "@/lib/mock-data"
import type { AgentMode, ChatMessage, DiffHunk, FileNode, GitFile, Project, Session } from "@/lib/types"
import { cn } from "@/lib/utils"
import {
  isTauri,
  listProjects,
  openProject,
  listSessions,
  listMessages,
  createSession,
  sendMessage as tauriSendMessage,
  streamChat,
  aiLoopChat,
  listDirectoryTree,
  gitStatus,
  listMemories,
  listNotes,
  applyChange,
  rejectChange,
  saveRecoverySnapshot,
  watchProjectDir,
  type AiChatRequest,
} from "@/lib/tauri-api"
import { loadModels, findModel, loadApiKey, resolveActiveModelId, recordModelUsage } from "@/lib/models"
import { parseCommand, executeCommand } from "@/lib/slash-commands"

let idCounter = 1
const nextId = () => `gen-${idCounter++}`

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

export function WorkspaceView({ projectId }: { projectId: string }) {
  const router = useRouter()
  const { resolvedTheme, toggleTheme, runMode, setRunMode } = useApp()

  const [project, setProject] = useState<Project | null>(null)
  const [allProjectsList, setAllProjectsList] = useState<Project[]>([])
  const [projectLoading, setProjectLoading] = useState(true)
  const [sessions, setSessions] = useState<Session[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string>("")
  const [mode, setMode] = useState<AgentMode>("edit")
  const [leftOpen, setLeftOpen] = useState(true)
  const [rightOpen, setRightOpen] = useState(true)
  const [activeFile, setActiveFile] = useState<string | null>(null)
  const [thinking, setThinking] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [fileTree, setFileTree] = useState<FileNode[]>([])
  const [fileTreeLoading, setFileTreeLoading] = useState(false)
  const [gitFiles, setGitFiles] = useState<GitFile[]>([])
  const [gitBranch, setGitBranch] = useState("main")
  const [projectMemories, setProjectMemories] = useState(mockMemories)
  const [projectNotes, setProjectNotes] = useState(mockNotes)

  const scrollRef = useRef<HTMLDivElement>(null)

  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null

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

  // Load project + project list
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setProjectLoading(true)
      if (isTauri()) {
        try {
          const [opened, all] = await Promise.all([
            openProject(projectId),
            listProjects(),
          ])
          if (cancelled) return
          setProject(opened)
          setAllProjectsList(all)
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
            setAllProjectsList(mockProjects as Project[])
          }
        } finally {
          if (!cancelled) setProjectLoading(false)
        }
        return
      }
      const fallback = mockProjects.find((p) => p.id === projectId) ?? mockProjects[0]
      if (!cancelled) {
        setProject(fallback ?? null)
        setAllProjectsList(mockProjects as Project[])
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
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })
  }, [activeSession?.messages.length, thinking])

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

  const requestAiReply = async (sessionId: string, history: ChatMessage[], userText: string) => {
    if (!project) return

    if (!isTauri()) {
      simulateReply(sessionId, userText)
      return
    }

    const models = await loadModels()
    const preferredId = await resolveActiveModelId(models)
    const modelCfg = findModel(models, preferredId) ?? models[0]
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
    const system = modeSystemPrompt(mode)

    try {
      let reply: ChatMessage
      if (mode === "edit" || mode === "auto") {
        reply = await aiLoopChat(
          {
            provider: modelCfg.provider,
            model: modelCfg.name,
            messages: convo,
            system_prompt: system,
            api_key: apiKey,
            base_url: modelCfg.endpoint ?? undefined,
            max_iterations: mode === "auto" ? 15 : 8,
            edit_dry_run: mode === "edit",
            agent_mode: mode,
          },
          sessionId,
          project.id,
        )
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
      updateSession(sessionId, (s) => ({
        ...s,
        messages: [...s.messages, reply],
        updatedAt: new Date().toISOString(),
      }))
      if (modelCfg) await recordModelUsage(modelCfg.id)
      await refreshGit()
      await refreshFileTree()
    } catch (err) {
      const reason = typeof err === "string" ? err : err instanceof Error ? err.message : "未知错误"
      updateSession(sessionId, (s) => ({
        ...s,
        messages: [
          ...s.messages,
          {
            id: nextId(),
            role: "assistant",
            content: `请求失败：${reason}\n\n请检查模型配置与 Ollama/API 是否可访问。`,
            createdAt: new Date().toISOString(),
            mode,
          },
        ],
        updatedAt: new Date().toISOString(),
      }))
    }
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

  const send = async (text: string) => {
    if (!project) return

    const slash = parseCommand(text.trim())
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
          id: nextId(), role: "user", content: text, createdAt: new Date().toISOString(), mode,
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
          title: text.slice(0, 20),
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
        title: text.slice(0, 20),
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

    setThinking(true)
    try {
      const { id: sessionId, messages: prior } = await ensureSession()

      let userMsg: ChatMessage
      if (isTauri()) {
        userMsg = await tauriSendMessage({
          session_id: sessionId,
          content: text,
          mode,
        })
      } else {
        userMsg = {
          id: nextId(),
          role: "user",
          content: text,
          createdAt: new Date().toISOString(),
          mode,
        }
      }

      const nextMessages = [...prior, userMsg]
      updateSession(sessionId, (s) => ({
        ...s,
        title: s.messages.length === 0 ? text.slice(0, 20) : s.title,
        messages: nextMessages,
        updatedAt: new Date().toISOString(),
      }))

      await requestAiReply(sessionId, nextMessages, text)
    } finally {
      setThinking(false)
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
      setToast("已打开文件选择器")
      return
    }
    send(action)
  }

  const openFile = (path: string) => {
    setActiveFile(path)
    setRightOpen(true)
    setToast(`已打开 ${path}`)
  }

  if (projectLoading) {
    return (
      <div className="flex h-dvh items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
        加载项目…
      </div>
    )
  }

  if (!project) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-4">
        <p className="text-sm text-muted-foreground">项目不存在或无法加载</p>
        <Button nativeButton={false} render={<Link href="/">返回主页</Link>}>
          返回主页
        </Button>
      </div>
    )
  }

  return (
    <div className="flex h-dvh flex-col bg-background">
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
          <div className="flex items-center rounded-md border border-border p-0.5">
            {(["full", "degraded", "offline"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setRunMode(m)}
                className={cn(
                  "flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors",
                  runMode === m
                    ? m === "full"
                      ? "bg-success/15 text-success"
                      : m === "degraded"
                        ? "bg-warning/15 text-warning"
                        : "bg-destructive/15 text-destructive"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {m === "full" ? <Wifi className="size-3" /> : m === "degraded" ? <TriangleAlert className="size-3" /> : <WifiOff className="size-3" />}
                {m === "full" ? "Full" : m === "degraded" ? "降级" : "离线"}
              </button>
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
            project={project}
            projects={allProjectsList.length ? allProjectsList : mockProjects}
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
            onSwitchProject={(id) => router.push(`/project/${id}`)}
          />
        )}

        <main className="flex min-w-0 flex-1 flex-col">
          {activeFile && (
            <div className="flex items-center gap-2 border-b border-border bg-card px-3 py-1.5">
              <FileCode2 className="size-3.5 text-muted-foreground" />
              <span className="font-mono text-xs">{activeFile}</span>
              <span className="text-[10px] text-muted-foreground">（预览）</span>
              <Button variant="ghost" size="icon-xs" className="ml-auto" onClick={() => setActiveFile(null)} aria-label="关闭预览">
                <X />
              </Button>
            </div>
          )}

          <div ref={scrollRef} className="flex-1 overflow-auto scrollbar-thin">
            {!activeSession || activeSession.messages.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
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
              <div className="mx-auto flex max-w-3xl flex-col gap-6 p-4">
                {activeSession.messages.map((m) => (
                  <ChatMessageView
                    key={m.id}
                    message={m}
                    onDiffAction={onDiffAction}
                    onOpenFile={openFile}
                  />
                ))}
                {thinking && (
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

          <ChatInput
            mode={mode}
            onModeChange={setMode}
            onSend={(t) => { void send(t) }}
            onQuickAction={onQuickAction}
            disabled={runMode === "offline"}
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
            onOpenFile={openFile}
            onDiffAction={onDiffAction}
            onGitRefresh={refreshGit}
          />
        )}
      </div>

      {toast && (
        <div className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-border bg-popover px-4 py-2 text-sm shadow-xl">
          {toast}
        </div>
      )}
    </div>
  )
}
