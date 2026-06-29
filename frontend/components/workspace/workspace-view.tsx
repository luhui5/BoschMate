"use client"

import { useEffect, useMemo, useRef, useState } from "react"
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
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useApp } from "@/components/app-provider"
import { LeftSidebar } from "@/components/workspace/left-sidebar"
import { RightSidebar } from "@/components/workspace/right-sidebar"
import { ChatMessageView } from "@/components/workspace/chat-message"
import { ChatInput } from "@/components/workspace/chat-input"
import {
  projects as allProjects,
  sessions as allSessions,
  memories as allMemories,
  notes as allNotes,
} from "@/lib/mock-data"
import type { AgentMode, ChatMessage, DiffHunk, Session } from "@/lib/types"
import { cn } from "@/lib/utils"
import { isTauri, listSessions, listMessages, createSession, sendMessage as tauriSendMessage } from "@/lib/tauri-api"

let idCounter = 1
const nextId = () => `gen-${idCounter++}`

export function WorkspaceView({ projectId }: { projectId: string }) {
  const router = useRouter()
  const { resolvedTheme, toggleTheme, runMode, setRunMode } = useApp()

  const project = allProjects.find((p) => p.id === projectId) ?? allProjects[0]
  const projectSessions = useMemo(
    () => allSessions.filter((s) => s.projectId === project.id),
    [project.id],
  )
  const projectMemories = allMemories.filter((m) => m.projectId === project.id)

  const [sessions, setSessions] = useState<Session[]>(() =>
    projectSessions.length ? projectSessions.map((s) => ({ ...s })) : [],
  )
  const [activeSessionId, setActiveSessionId] = useState<string>(
    projectSessions[0]?.id ?? "",
  )
  const [mode, setMode] = useState<AgentMode>(projectSessions[0]?.mode ?? "edit")
  const [leftOpen, setLeftOpen] = useState(true)
  const [rightOpen, setRightOpen] = useState(true)
  const [activeFile, setActiveFile] = useState<string | null>(null)
  const [thinking, setThinking] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const scrollRef = useRef<HTMLDivElement>(null)

  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null

  // Aggregate all diffs in the active session for the "changes" view
  const changes = useMemo(() => {
    if (!activeSession) return []
    const out: { messageId: string; index: number; diff: DiffHunk }[] = []
    activeSession.messages.forEach((m) => {
      m.diffs?.forEach((d, i) => out.push({ messageId: m.id, index: i, diff: d }))
    })
    return out
  }, [activeSession])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })
  }, [activeSession?.messages.length, thinking])

  // Sync sessions from Tauri backend when available
  useEffect(() => {
    if (!isTauri()) return
    const sync = async () => {
      try {
        const realSessions = await listSessions(project.id)
        if (realSessions.length > 0) {
          // Load messages for each session
          const sessionsWithMessages = await Promise.all(
            realSessions.map(async (rs) => {
              try {
                const msgs = await listMessages(rs.id)
                return { ...rs, messages: msgs }
              } catch {
                return { ...rs, messages: [] as ChatMessage[] }
              }
            })
          )
          setSessions(sessionsWithMessages)
          if (sessionsWithMessages.length > 0 && !activeSessionId) {
            setActiveSessionId(sessionsWithMessages[0].id)
          }
        }
      } catch {
        // Fallback to mock data (already loaded)
      }
    }
    sync()
  }, [project.id])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2500)
    return () => clearTimeout(t)
  }, [toast])

  const updateSession = (id: string, fn: (s: Session) => Session) =>
    setSessions((prev) => prev.map((s) => (s.id === id ? fn(s) : s)))

  const newSession = async () => {
    if (isTauri()) {
      try {
        const s = await createSession({ project_id: project.id, title: "新会话", mode })
        const session: Session = { ...s, messages: [] }
        setSessions((prev) => [session, ...prev])
        setActiveSessionId(s.id)
        return
      } catch { /* fallback to local */ }
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

  const send = (text: string) => {
    if (!activeSession) {
      // create one on the fly
      const id = nextId()
      const userMsg: ChatMessage = {
        id: nextId(),
        role: "user",
        content: text,
        createdAt: new Date().toISOString(),
      }
      const s: Session = {
        id,
        projectId: project.id,
        title: text.slice(0, 20),
        mode,
        status: "active",
        updatedAt: new Date().toISOString(),
        tokenCount: 0,
        messages: [userMsg],
      }
      setSessions((prev) => [s, ...prev])
      setActiveSessionId(id)
      simulateReply(id, text)
      return
    }

    const userMsg: ChatMessage = {
      id: nextId(),
      role: "user",
      content: text,
      createdAt: new Date().toISOString(),
    }
    updateSession(activeSession.id, (s) => ({
      ...s,
      title: s.messages.length === 0 ? text.slice(0, 20) : s.title,
      messages: [...s.messages, userMsg],
      updatedAt: new Date().toISOString(),
    }))
    simulateReply(activeSession.id, text)
  }

  const simulateReply = (sessionId: string, prompt: string) => {
    setThinking(true)
    const replyId = nextId()
    setTimeout(() => {
      setThinking(false)
      const content =
        mode === "plan"
          ? `## 计划\n\n1. 分析需求：${prompt.slice(0, 30)}\n2. 检索相关上下文与历史记忆\n3. 生成执行步骤并等待确认\n\n是否将此计划导出为 Plan 文档？`
          : mode === "ask"
            ? `根据当前项目上下文，我的理解是：${prompt.slice(0, 40)}…\n\n这是一个**只读**回答，不会修改任何文件。如需我执行修改，请切换到 *Ask before edits* 或 *Edit automation* 模式。`
            : `已理解需求并检索上下文。我准备进行如下修改，请审阅下方变更卡片后采纳。`

      const reply: ChatMessage = {
        id: replyId,
        role: "assistant",
        mode,
        content,
        createdAt: new Date().toISOString(),
        toolCalls:
          mode === "edit" || mode === "auto"
            ? [
                { tool: "Retriever", args: "query: " + prompt.slice(0, 16), status: "success", result: "命中 3 条" },
                { tool: "CodeEditor", args: "apply patch", status: "success", result: "1 个文件" },
              ]
            : undefined,
        diffs:
          mode === "edit" || mode === "auto"
            ? [
                {
                  filePath: "src/main.rs",
                  additions: 3,
                  deletions: 1,
                  language: "rust",
                  status: mode === "auto" ? "applied" : "pending",
                  lines: [
                    { type: "meta", text: "@@ -1,4 +1,6 @@" },
                    { type: "context", text: "fn main() {", oldNo: 1, newNo: 1 },
                    { type: "del", text: '    println!("hello");', oldNo: 2 },
                    { type: "add", text: '    // 根据需求调整', newNo: 2 },
                    { type: "add", text: '    println!("hello, bosch");', newNo: 3 },
                    { type: "context", text: "}", oldNo: 3, newNo: 4 },
                  ],
                },
              ]
            : undefined,
        fileRefs: mode === "edit" || mode === "auto" ? ["src/main.rs"] : undefined,
      }
      updateSession(sessionId, (s) => ({
        ...s,
        messages: [...s.messages, reply],
        tokenCount: s.tokenCount + 1200,
        updatedAt: new Date().toISOString(),
      }))
    }, 1100)
  }

  const onDiffAction = (
    messageId: string,
    diffIndex: number,
    action: "accept" | "reject" | "revert",
  ) => {
    if (!activeSession) return
    const statusMap = { accept: "applied", reject: "rejected", revert: "reverted" } as const
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

  return (
    <div className="flex h-dvh flex-col bg-background">
      {/* Top bar */}
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
          {/* Run mode selector */}
          <div className="flex items-center rounded-md border border-border p-0.5">
            {(["full", "degraded", "offline"] as const).map((m) => (
              <button
                key={m}
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

      {/* Body */}
      <div className="flex min-h-0 flex-1">
        {leftOpen && (
          <LeftSidebar
            project={project}
            projects={allProjects}
            sessions={sessions}
            memories={projectMemories}
            notes={allNotes}
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

        {/* Center chat */}
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
            onSend={send}
            onQuickAction={onQuickAction}
            disabled={runMode === "offline"}
          />
        </main>

        {rightOpen && (
          <RightSidebar
            project={project}
            changes={changes}
            activeFile={activeFile}
            onOpenFile={openFile}
            onDiffAction={onDiffAction}
          />
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-border bg-popover px-4 py-2 text-sm shadow-xl">
          {toast}
        </div>
      )}
    </div>
  )
}
