"use client"

import { useEffect, useRef, useState } from "react"
import {
  ArrowUp,
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
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { BoschLogo } from "@/components/bosch-logo"
import { ThinkingDepthSelect } from "@/components/thinking-depth-select"
import type { ThinkingDepth } from "@/lib/thinking-depth"

interface Message {
  id: string
  role: "user" | "assistant"
  content: string
}

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

const MODELS = ["Qwen2.5-Coder 32B（本地）", "DeepSeek V2（本地）", "Claude Opus 4.6", "GPT-5"]

function assistantReply(prompt: string): string {
  return `已收到你的请求：「${prompt.slice(0, 40)}${prompt.length > 40 ? "…" : ""}」。\n\n作为本地全能助手，我可以在不离开本机的前提下完成写作、文档总结、翻译、数据分析、计划制定与代码编写。请告诉我更多细节，或从知识库中选择相关文档，我会据此给出更精准的结果。`
}

export function AssistantView({
  knowledgeCount,
  onOpenKnowledge,
}: {
  knowledgeCount: number
  onOpenKnowledge: () => void
}) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [thinking, setThinking] = useState(false)
  const [model, setModel] = useState(MODELS[0])
  const [modelOpen, setModelOpen] = useState(false)
  const [depth, setDepth] = useState<ThinkingDepth>("default")
  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const hasChat = messages.length > 0

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })
  }, [messages, thinking])

  const send = (text: string) => {
    const content = text.trim()
    if (!content || thinking) return
    const userMsg: Message = { id: `u-${Date.now()}`, role: "user", content }
    setMessages((prev) => [...prev, userMsg])
    setInput("")
    setThinking(true)
    setTimeout(() => {
      setMessages((prev) => [
        ...prev,
        { id: `a-${Date.now()}`, role: "assistant", content: assistantReply(content) },
      ])
      setThinking(false)
    }, 900)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      e.key === "Enter" &&
      !e.shiftKey &&
      !e.nativeEvent.isComposing &&
      e.keyCode !== 229
    ) {
      e.preventDefault()
      send(input)
    }
  }

  return (
    <div className="flex h-[calc(100vh-34px)] flex-col">
      {/* Header */}
      <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-2.5">
        <div className="flex items-center gap-2">
          <Sparkles className="size-5 text-primary" />
          <span className="text-sm font-semibold">Bosch Assistant</span>
          <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            本地全能助手
          </span>
        </div>
        {hasChat && (
          <Button variant="secondary" size="sm" onClick={() => setMessages([])}>
            <Plus className="size-4" />
            新对话
          </Button>
        )}
      </header>

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
                  {m.content}
                </div>
              </div>
            ))}
            {thinking && (
              <div className="flex gap-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-foreground text-background">
                  <BoschLogo className="size-4" />
                </span>
                <div className="flex items-center gap-1 rounded-2xl bg-card px-4 py-3">
                  <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.3s]" />
                  <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.15s]" />
                  <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground" />
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
                    {model}
                    <ChevronDown className="size-3.5" />
                  </Button>
                  {modelOpen && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setModelOpen(false)} aria-hidden />
                      <div className="absolute bottom-full left-0 z-20 mb-1 w-56 rounded-lg border border-border bg-popover p-1 shadow-lg">
                        {MODELS.map((m) => (
                          <button
                            key={m}
                            onClick={() => {
                              setModel(m)
                              setModelOpen(false)
                            }}
                            className={cn(
                              "flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent",
                              m === model && "text-primary",
                            )}
                          >
                            {m}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
                <ThinkingDepthSelect value={depth} onChange={setDepth} />
              </div>
              <Button
                size="icon-sm"
                disabled={!input.trim() || thinking}
                onClick={() => send(input)}
                aria-label="发送"
              >
                <ArrowUp className="size-4" />
              </Button>
            </div>
          </div>
          <p className="mt-1.5 text-center text-[11px] text-muted-foreground">
            所有对话与文档均在本地处理，不会上传云端。
          </p>
        </div>
      </div>
    </div>
  )
}
