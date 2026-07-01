"use client"

import { useState } from "react"
import { Check, Cpu, Cloud, HardDrive, Plus, Pencil, Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { SectionHeader, Select } from "./primitives"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Modal } from "@/components/ui/modal"

type Protocol = "openai" | "anthropic"

interface ModelItem {
  id: string
  name: string
  kind: "local" | "cloud"
  protocol: Protocol
  detail: string
  endpoint?: string
  contextWindow: string
  temperature: number
}

const INITIAL_MODELS: ModelItem[] = [
  {
    id: "local-qwen",
    name: "Qwen2.5-Coder 32B",
    kind: "local",
    protocol: "openai",
    detail: "本地 · Ollama · 4-bit 量化",
    endpoint: "http://localhost:11434",
    contextWindow: "32768",
    temperature: 0.2,
  },
  {
    id: "local-deepseek",
    name: "DeepSeek-Coder V2 16B",
    kind: "local",
    protocol: "openai",
    detail: "本地 · llama.cpp",
    endpoint: "http://localhost:8080",
    contextWindow: "32768",
    temperature: 0.3,
  },
  {
    id: "cloud-claude",
    name: "Claude Opus 4.6",
    kind: "cloud",
    protocol: "anthropic",
    detail: "云端 · 需 API Key",
    endpoint: "https://api.anthropic.com",
    contextWindow: "131072",
    temperature: 0.5,
  },
  {
    id: "cloud-gpt",
    name: "GPT-5",
    kind: "cloud",
    protocol: "openai",
    detail: "云端 · 需 API Key",
    endpoint: "https://api.openai.com",
    contextWindow: "131072",
    temperature: 0.7,
  },
]

const EMPTY_DRAFT: ModelItem = {
  id: "",
  name: "",
  kind: "local",
  protocol: "openai",
  detail: "",
  endpoint: "",
  contextWindow: "32768",
  temperature: 0.2,
}

const PROTOCOL_LABEL: Record<Protocol, string> = {
  openai: "OpenAI 兼容",
  anthropic: "Anthropic",
}

export function ModelSection() {
  const [models, setModels] = useState<ModelItem[]>(INITIAL_MODELS)
  const [selected, setSelected] = useState("local-qwen")

  const [dialogOpen, setDialogOpen] = useState(false)
  const [draft, setDraft] = useState<ModelItem>(EMPTY_DRAFT)
  const [editingId, setEditingId] = useState<string | null>(null)

  const openAdd = () => {
    setDraft(EMPTY_DRAFT)
    setEditingId(null)
    setDialogOpen(true)
  }

  const openEdit = (m: ModelItem) => {
    setDraft(m)
    setEditingId(m.id)
    setDialogOpen(true)
  }

  const saveModel = () => {
    if (!draft.name.trim()) return
    if (editingId) {
      setModels((prev) => prev.map((m) => (m.id === editingId ? { ...draft, id: editingId } : m)))
    } else {
      const id = `custom-${Date.now()}`
      setModels((prev) => [...prev, { ...draft, id }])
      setSelected(id)
    }
    setDialogOpen(false)
  }

  const deleteModel = (id: string) => {
    setModels((prev) => {
      const next = prev.filter((m) => m.id !== id)
      if (selected === id && next.length > 0) setSelected(next[0].id)
      return next
    })
    setDialogOpen(false)
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        title="模型配置"
        desc="管理可用的本地与云端模型。上下文窗口、采样温度、接口协议等参数均针对每个模型单独配置。"
      />

      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            模型列表
          </p>
          <Button variant="secondary" size="sm" onClick={openAdd}>
            <Plus className="size-4" />
            新增模型
          </Button>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {models.map((m) => {
            const Icon = m.kind === "local" ? HardDrive : Cloud
            const isActive = selected === m.id
            return (
              <div
                key={m.id}
                className={cn(
                  "group relative flex items-center gap-3 rounded-lg border px-3 py-3 transition-colors",
                  isActive ? "border-primary bg-primary/5" : "border-border hover:border-ring hover:bg-muted/40",
                )}
              >
                <button
                  onClick={() => setSelected(m.id)}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <span
                    className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
                      m.kind === "local" ? "bg-emerald-500/15 text-emerald-400" : "bg-sky-500/15 text-sky-400",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-medium">{m.name}</span>
                      <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                        {PROTOCOL_LABEL[m.protocol]}
                      </span>
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {m.detail} · {Number(m.contextWindow) / 1024}K · temp {m.temperature.toFixed(2)}
                    </span>
                  </span>
                  {isActive && <Check className="h-4 w-4 shrink-0 text-primary" />}
                </button>
                <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                  <Button variant="ghost" size="icon-sm" onClick={() => openEdit(m)} aria-label={`编辑 ${m.name}`}>
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => deleteModel(m.id)}
                    aria-label={`删除 ${m.name}`}
                    disabled={models.length <= 1}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
        <Cpu className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          当前硬件：Apple M3 Max · 48GB 统一内存 · 检测到 Metal 加速。本地模型预计吞吐 ~38 tok/s。
        </span>
      </div>

      {/* Add / Edit dialog */}
      <Modal
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title={editingId ? "编辑模型" : "新增模型"}
        description="每个模型独立配置连接信息与推理参数。"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setDialogOpen(false)}>
              取消
            </Button>
            <Button size="sm" onClick={saveModel} disabled={!draft.name.trim()}>
              {editingId ? "保存更改" : "添加"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">模型名称</label>
            <Input
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              placeholder="例如 Llama 3.1 70B"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">类型</label>
            <div className="grid grid-cols-2 gap-2">
              {(["local", "cloud"] as const).map((k) => (
                <button
                  key={k}
                  onClick={() =>
                    setDraft((d) => ({
                      ...d,
                      kind: k,
                      detail: k === "local" ? "本地 · 自定义端点" : "云端 · 需 API Key",
                    }))
                  }
                  className={cn(
                    "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors",
                    draft.kind === k ? "border-primary bg-primary/5" : "border-border hover:border-ring",
                  )}
                >
                  {k === "local" ? <HardDrive className="size-4" /> : <Cloud className="size-4" />}
                  {k === "local" ? "本地模型" : "云端模型"}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">接口协议</label>
            <div className="grid grid-cols-2 gap-2">
              {(["openai", "anthropic"] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => setDraft((d) => ({ ...d, protocol: p }))}
                  className={cn(
                    "flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors",
                    draft.protocol === p ? "border-primary bg-primary/5" : "border-border hover:border-ring",
                  )}
                >
                  {PROTOCOL_LABEL[p]}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              {draft.kind === "local" ? "本地端点" : "API 端点"}
            </label>
            <Input
              value={draft.endpoint ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, endpoint: e.target.value }))}
              placeholder={draft.kind === "local" ? "http://localhost:11434" : "https://api.example.com"}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">上下文窗口</label>
              <Select
                value={draft.contextWindow}
                onChange={(v) => setDraft((d) => ({ ...d, contextWindow: v }))}
                options={[
                  { value: "8192", label: "8K" },
                  { value: "16384", label: "16K" },
                  { value: "32768", label: "32K" },
                  { value: "65536", label: "64K" },
                  { value: "131072", label: "128K" },
                  { value: "204800", label: "200K" },
                ]}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                采样温度 · {draft.temperature.toFixed(2)}
              </label>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={draft.temperature}
                onChange={(e) => setDraft((d) => ({ ...d, temperature: Number(e.target.value) }))}
                className="mt-2 w-full accent-primary"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">说明</label>
            <Input
              value={draft.detail}
              onChange={(e) => setDraft((d) => ({ ...d, detail: e.target.value }))}
              placeholder="例如 本地 · Ollama · 4-bit 量化"
            />
          </div>
        </div>
      </Modal>
    </div>
  )
}
