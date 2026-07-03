"use client"

import { useEffect, useState } from "react"
import { Check, Cpu, Plus, Pencil, Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { SectionHeader, Select } from "./primitives"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Modal } from "@/components/ui/modal"
import {
  type ModelConfig,
  type ModelProtocol,
  type ModelProvider,
  DEFAULT_MODELS,
  loadModels,
  saveModels,
  loadApiKey,
  saveApiKey,
  deleteApiKey,
  saveLastUsedModelId,
  resolveActiveModelId,
} from "@/lib/models"

const EMPTY_DRAFT: ModelConfig = {
  id: "",
  name: "",
  protocol: "openai",
  provider: "ollama",
  detail: "",
  endpoint: "",
  contextWindow: 32768,
  temperature: 0.2,
}

const PROTOCOL_LABEL: Record<ModelProtocol, string> = {
  openai: "OpenAI 兼容",
  anthropic: "Anthropic",
}

const PROVIDER_LABEL: Record<ModelProvider, string> = {
  ollama: "Ollama",
  openai: "OpenAI",
  anthropic: "Anthropic",
}

export function ModelSection() {
  const [models, setModels] = useState<ModelConfig[]>(DEFAULT_MODELS)
  const [selected, setSelected] = useState<string>(DEFAULT_MODELS[0]?.id ?? "")
  const [dialogOpen, setDialogOpen] = useState(false)
  const [draft, setDraft] = useState<ModelConfig>(EMPTY_DRAFT)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [apiKeyDraft, setApiKeyDraft] = useState("")

  // Load persisted models on mount
  useEffect(() => {
    const init = async () => {
      const saved = await loadModels()
      setModels(saved)
      if (saved.length > 0) {
        setSelected(await resolveActiveModelId(saved))
      }
    }
    init()
  }, [])

  const openAdd = () => {
    setDraft(EMPTY_DRAFT)
    setApiKeyDraft("")
    setEditingId(null)
    setDialogOpen(true)
  }

  const openEdit = async (m: ModelConfig) => {
    setDraft(m)
    setEditingId(m.id)
    setDialogOpen(true)
    // Load existing API key if any
    try {
      const key = await loadApiKey(m.id)
      setApiKeyDraft(key ?? "")
    } catch {
      setApiKeyDraft("")
    }
  }

  const saveModel = async () => {
    if (!draft.name.trim()) return
    const modelId = editingId ?? `custom-${Date.now()}`
    if (editingId) {
      setModels((prev) => {
        const updated = prev.map((m) => (m.id === editingId ? { ...draft, id: editingId } : m))
        saveModels(updated).catch(console.error)
        return updated
      })
    } else {
      setModels((prev) => {
        const updated = [...prev, { ...draft, id: modelId }]
        saveModels(updated).catch(console.error)
        return updated
      })
      setSelected(modelId)
      void saveLastUsedModelId(modelId)
    }
    // Persist API key separately (same modelId)
    if (apiKeyDraft.trim()) {
      await saveApiKey(modelId, apiKeyDraft.trim())
    } else if (editingId) {
      await deleteApiKey(editingId)
    }
    setDialogOpen(false)
  }

  const deleteModel = async (id: string) => {
    setModels((prev) => {
      const next = prev.filter((m) => m.id !== id)
      if (selected === id && next.length > 0) setSelected(next[0].id)
      saveModels(next).catch(console.error)
      return next
    })
    await deleteApiKey(id)
    setDialogOpen(false)
  }

  // Derive provider from protocol/endpoint
  const autoProvider = (protocol: ModelProtocol, endpoint: string | null): ModelProvider => {
    if (protocol === "anthropic") return "anthropic"
    // Local / self-hosted endpoints default to Ollama (OpenAI-compatible, no API key required)
    if (endpoint && (endpoint.includes("127.0.0.1") || endpoint.includes("localhost") || endpoint.includes(":11434"))) return "ollama"
    // Cloud OpenAI-compatible endpoints
    return "openai"
  }

  useEffect(() => {
    if (dialogOpen) {
      const derived = autoProvider(draft.protocol, draft.endpoint)
      if (derived !== draft.provider) {
        setDraft((d) => ({ ...d, provider: derived }))
      }
    }
  }, [draft.protocol, draft.endpoint, dialogOpen])

  return (
    <div className="space-y-6">
      <SectionHeader
        title="模型配置"
        desc="管理可用的模型。上下文窗口、采样温度、接口协议等参数均针对每个模型单独配置。"
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
                  onClick={() => {
                    setSelected(m.id)
                    void saveLastUsedModelId(m.id)
                  }}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <span
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary"
                  >
                    <Cpu className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-medium">{m.name}</span>
                      <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                        {PROVIDER_LABEL[m.provider]}
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
          当前已配置 {models.length} 个模型。使用本地服务（Ollama / llama.cpp）时需确保对应服务已启动。
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

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">接口协议</label>
              <div className="grid grid-cols-2 gap-2">
                {(["openai", "anthropic"] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() =>
                      setDraft((d) => ({
                        ...d,
                        protocol: p,
                        provider: autoProvider(p, d.endpoint),
                      }))
                    }
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
              <label className="text-xs font-medium text-muted-foreground">后端 Provider</label>
              <Select
                value={draft.provider}
                onChange={(v) => setDraft((d) => ({ ...d, provider: v as ModelProvider }))}
                options={[
                  { value: "ollama", label: "Ollama" },
                  { value: "openai", label: "OpenAI" },
                  { value: "anthropic", label: "Anthropic" },
                ]}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">API 端点</label>
            <Input
              value={draft.endpoint ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, endpoint: e.target.value }))}
              placeholder="http://localhost:11434 或 https://api.example.com"
            />
          </div>

          {/* API Key (optional) */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">API Key（选填）</label>
            <Input
              type="password"
              value={apiKeyDraft}
              onChange={(e) => setApiKeyDraft(e.target.value)}
              placeholder="sk-…"
            />
            <p className="text-[11px] text-muted-foreground">
              Key 将加密存储在本机，不会上传到任何云端服务。
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">上下文窗口</label>
              <Select
                value={String(draft.contextWindow)}
                onChange={(v) => setDraft((d) => ({ ...d, contextWindow: Number(v) }))}
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
