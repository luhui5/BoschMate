"use client"

import { useEffect, useMemo, useState } from "react"
import { Building2, Check, Cpu, Plus, Pencil, Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { SectionHeader, Select } from "./primitives"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Modal } from "@/components/ui/modal"
import {
  type ModelBackend,
  type ModelConfig,
  type ModelProtocol,
  type ModelProviderConfig,
  BACKEND_LABEL,
  BUILTIN_PROVIDER_IDS,
  DEFAULT_MODELS,
  DEFAULT_PROVIDERS,
  groupModelsByProvider,
  inferBackend,
  isHttpsEndpoint,
  loadApiKey,
  loadModels,
  loadProviders,
  saveApiKey,
  saveLastUsedModelId,
  saveModels,
  saveProviders,
  deleteApiKey,
  resolveActiveModelId,
} from "@/lib/models"

function createEmptyDraft(providers: ModelProviderConfig[]): ModelConfig {
  return {
    id: "",
    name: "",
    protocol: "openai",
    backend: "openai",
    providerId: providers[0]?.id ?? "",
    detail: "",
    endpoint: "",
    skipTlsVerify: false,
    contextWindow: 32768,
    temperature: 0.2,
  }
}

const EMPTY_PROVIDER_DRAFT: ModelProviderConfig = {
  id: "",
  name: "",
  description: "",
}

const PROTOCOL_LABEL: Record<ModelProtocol, string> = {
  openai: "OpenAI 兼容",
  anthropic: "Anthropic",
}

export function ModelSection() {
  const [providers, setProviders] = useState<ModelProviderConfig[]>(DEFAULT_PROVIDERS)
  const [models, setModels] = useState<ModelConfig[]>(DEFAULT_MODELS)
  const [selected, setSelected] = useState<string>(DEFAULT_MODELS[0]?.id ?? "")
  const [modelDialogOpen, setModelDialogOpen] = useState(false)
  const [providerDialogOpen, setProviderDialogOpen] = useState(false)
  const [draft, setDraft] = useState<ModelConfig>(createEmptyDraft(DEFAULT_PROVIDERS))
  const [providerDraft, setProviderDraft] = useState<ModelProviderConfig>(EMPTY_PROVIDER_DRAFT)
  const [editingModelId, setEditingModelId] = useState<string | null>(null)
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null)
  const [apiKeyDraft, setApiKeyDraft] = useState("")
  const [providerError, setProviderError] = useState<string | null>(null)

  useEffect(() => {
    const init = async () => {
      const [savedProviders, savedModels] = await Promise.all([loadProviders(), loadModels()])
      setProviders(savedProviders)
      setModels(savedModels)
      if (savedModels.length > 0) {
        setSelected(await resolveActiveModelId(savedModels))
      }
    }
    init()
  }, [])

  const groupedModels = useMemo(
    () => groupModelsByProvider(models, providers),
    [models, providers],
  )

  const modelCountByProvider = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const m of models) counts[m.providerId] = (counts[m.providerId] ?? 0) + 1
    return counts
  }, [models])

  const openAddModel = () => {
    setDraft(createEmptyDraft(providers))
    setApiKeyDraft("")
    setEditingModelId(null)
    setModelDialogOpen(true)
  }

  const openEditModel = async (m: ModelConfig) => {
    setDraft(m)
    setEditingModelId(m.id)
    setModelDialogOpen(true)
    try {
      const key = await loadApiKey(m.id)
      setApiKeyDraft(key ?? "")
    } catch {
      setApiKeyDraft("")
    }
  }

  const saveModel = async () => {
    if (!draft.name.trim() || !draft.providerId) return
    const modelId = editingModelId ?? `custom-${Date.now()}`
    if (editingModelId) {
      setModels((prev) => {
        const updated = prev.map((m) => (m.id === editingModelId ? { ...draft, id: editingModelId } : m))
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
    if (apiKeyDraft.trim()) {
      await saveApiKey(modelId, apiKeyDraft.trim())
    } else if (editingModelId) {
      await deleteApiKey(editingModelId)
    }
    setModelDialogOpen(false)
  }

  const deleteModel = async (id: string) => {
    setModels((prev) => {
      const next = prev.filter((m) => m.id !== id)
      if (selected === id && next.length > 0) setSelected(next[0].id)
      saveModels(next).catch(console.error)
      return next
    })
    await deleteApiKey(id)
    setModelDialogOpen(false)
  }

  const openAddProvider = () => {
    setProviderDraft(EMPTY_PROVIDER_DRAFT)
    setEditingProviderId(null)
    setProviderError(null)
    setProviderDialogOpen(true)
  }

  const openEditProvider = (p: ModelProviderConfig) => {
    setProviderDraft(p)
    setEditingProviderId(p.id)
    setProviderError(null)
    setProviderDialogOpen(true)
  }

  const saveProvider = async () => {
    if (!providerDraft.name.trim()) return
    const providerId = editingProviderId ?? `provider-custom-${Date.now()}`
    if (editingProviderId) {
      setProviders((prev) => {
        const updated = prev.map((p) =>
          p.id === editingProviderId ? { ...providerDraft, id: editingProviderId } : p,
        )
        saveProviders(updated).catch(console.error)
        return updated
      })
    } else {
      setProviders((prev) => {
        const updated = [...prev, { ...providerDraft, id: providerId }]
        saveProviders(updated).catch(console.error)
        return updated
      })
    }
    setProviderDialogOpen(false)
  }

  const deleteProvider = (id: string) => {
    if (BUILTIN_PROVIDER_IDS.has(id)) {
      setProviderError("内置提供商不可删除")
      return
    }
    const linked = models.filter((m) => m.providerId === id)
    if (linked.length > 0) {
      setProviderError(`该提供商下仍有 ${linked.length} 个模型，请先移除或迁移模型`)
      return
    }
    setProviders((prev) => {
      const next = prev.filter((p) => p.id !== id)
      saveProviders(next).catch(console.error)
      return next
    })
    setProviderDialogOpen(false)
    setProviderError(null)
  }

  useEffect(() => {
    if (modelDialogOpen) {
      const derived = inferBackend(draft.protocol, draft.endpoint)
      if (derived !== draft.backend) {
        setDraft((d) => ({ ...d, backend: derived }))
      }
    }
  }, [draft.protocol, draft.endpoint, modelDialogOpen, draft.backend])

  const renderModelCard = (m: ModelConfig) => {
    const isActive = selected === m.id
    return (
      <div
        key={m.id}
        className={cn(
          "group relative flex items-center gap-3 rounded-lg border px-3 py-3 transition-all duration-200",
          isActive
            ? "border-primary/60 bg-gradient-to-r from-primary/10 to-primary/5 ring-1 ring-primary/20"
            : "border-border hover:border-ring/60 hover:bg-muted/30",
        )}
      >
        <button
          onClick={() => {
            setSelected(m.id)
            void saveLastUsedModelId(m.id)
          }}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <span className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors",
            isActive ? "bg-primary/20 text-primary" : "bg-secondary text-muted-foreground",
          )}>
            <Cpu className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className="truncate text-sm font-semibold">{m.name}</span>
              <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                {BACKEND_LABEL[m.backend]}
              </span>
            </span>
            <span className="mt-0.5 block truncate text-xs leading-relaxed text-muted-foreground">
              {m.detail} · {Number(m.contextWindow) / 1024}K · temp {m.temperature.toFixed(2)}
            </span>
          </span>
          {isActive && (
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <Check className="h-3 w-3" />
            </span>
          )}
        </button>
        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          <Button variant="ghost" size="icon-sm" onClick={() => openEditModel(m)} aria-label={`编辑 ${m.name}`}>
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
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        title="模型配置"
        desc="按提供商组织模型。上下文窗口、采样温度、接口协议等参数均针对每个模型单独配置。"
      />

      {/* Provider management */}
      <div className="rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            模型提供商
          </p>
          <Button variant="secondary" size="sm" onClick={openAddProvider}>
            <Plus className="size-4" />
            新增提供商
          </Button>
        </div>
        <div className="p-4">
          <div className="grid gap-2 sm:grid-cols-2">
            {providers.map((p) => (
              <div
                key={p.id}
                className="group relative flex items-center gap-3 rounded-lg border border-border px-3 py-3 transition-colors hover:border-ring hover:bg-muted/40"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-secondary text-muted-foreground">
                  <Building2 className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{p.name}</span>
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                    {p.description || "无说明"} · {modelCountByProvider[p.id] ?? 0} 个模型
                  </span>
                </span>
                <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                  <Button variant="ghost" size="icon-sm" onClick={() => openEditProvider(p)} aria-label={`编辑 ${p.name}`}>
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => deleteProvider(p.id)}
                    aria-label={`删除 ${p.name}`}
                    disabled={BUILTIN_PROVIDER_IDS.has(p.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
          {providerError && (
            <p className="mt-2 text-xs text-destructive">{providerError}</p>
          )}
        </div>
      </div>

      {/* Models grouped by provider */}
      <div className="rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            模型列表
          </p>
          <Button variant="secondary" size="sm" onClick={openAddModel} disabled={providers.length === 0}>
            <Plus className="size-4" />
            新增模型
          </Button>
        </div>
        <div className="p-4">
          <div className="space-y-4">
            {groupedModels.map(({ provider, models: groupModels }) => (
              <div key={provider.id}>
                <p className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {provider.name}
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {groupModels.map(renderModelCard)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
        <Cpu className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          当前已配置 {providers.length} 个提供商、{models.length} 个模型。使用本地服务时需确保对应服务已启动。
        </span>
      </div>

      {/* Provider dialog */}
      <Modal
        open={providerDialogOpen}
        onClose={() => setProviderDialogOpen(false)}
        title={editingProviderId ? "编辑提供商" : "新增提供商"}
        description="提供商用于分组展示，不影响后端路由方式。"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setProviderDialogOpen(false)}>
              取消
            </Button>
            <Button size="sm" onClick={saveProvider} disabled={!providerDraft.name.trim()}>
              {editingProviderId ? "保存更改" : "添加"}
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground/70">名称</label>
            <Input
              value={providerDraft.name}
              onChange={(e) => setProviderDraft((d) => ({ ...d, name: e.target.value }))}
              placeholder="例如 DeepSeek、公司内网"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground/70">说明（选填）</label>
            <Input
              value={providerDraft.description ?? ""}
              onChange={(e) => setProviderDraft((d) => ({ ...d, description: e.target.value }))}
              placeholder="例如 内部推理服务"
            />
          </div>
        </div>
      </Modal>

      {/* Model dialog */}
      <Modal
        open={modelDialogOpen}
        onClose={() => setModelDialogOpen(false)}
        title={editingModelId ? "编辑模型" : "新增模型"}
        description="每个模型独立配置连接信息与推理参数。"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setModelDialogOpen(false)}>
              取消
            </Button>
            <Button size="sm" onClick={saveModel} disabled={!draft.name.trim() || !draft.providerId}>
              {editingModelId ? "保存更改" : "添加"}
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground/70">模型名称</label>
            <Input
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              placeholder="例如 Llama 3.1 70B"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground/70">所属提供商</label>
            <Select
              value={draft.providerId}
              onChange={(v) => setDraft((d) => ({ ...d, providerId: v }))}
              options={providers.map((p) => ({ value: p.id, label: p.name }))}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground/70">接口协议</label>
              <div className="grid grid-cols-2 gap-2">
                {(["openai", "anthropic"] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() =>
                      setDraft((d) => ({
                        ...d,
                        protocol: p,
                        backend: inferBackend(p, d.endpoint),
                      }))
                    }
                    className={cn(
                      "flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors",
                      draft.protocol === p ? "border-primary/60 bg-gradient-to-r from-primary/10 to-primary/5" : "border-border hover:border-ring",
                    )}
                  >
                    {PROTOCOL_LABEL[p]}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground/70">后端路由</label>
              <Select
                value={draft.backend}
                onChange={(v) => setDraft((d) => ({ ...d, backend: v as ModelBackend }))}
                options={[
                  { value: "openai", label: "OpenAI" },
                  { value: "anthropic", label: "Anthropic" },
                ]}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground/70">API 端点</label>
            <Input
              value={draft.endpoint ?? ""}
              onChange={(e) => {
                const endpoint = e.target.value
                setDraft((d) => ({
                  ...d,
                  endpoint,
                  ...(!isHttpsEndpoint(endpoint) ? { skipTlsVerify: false } : {}),
                }))
              }}
              placeholder="http://localhost:11434 或 https://api.example.com"
            />
          </div>

          {isHttpsEndpoint(draft.endpoint) && (
            <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-border px-3 py-2.5">
              <input
                type="checkbox"
                checked={draft.skipTlsVerify ?? false}
                onChange={(e) => setDraft((d) => ({ ...d, skipTlsVerify: e.target.checked }))}
                className="mt-0.5 accent-primary"
              />
              <span className="min-w-0">
                <span className="block text-xs font-medium">跳过 TLS 证书校验</span>
                <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">
                  仅在内网自签名证书时使用。会降低连接安全性，存在中间人攻击风险。
                </span>
              </span>
            </label>
          )}

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground/70">API Key（选填）</label>
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
              <label className="text-xs font-medium text-foreground/70">上下文窗口</label>
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
              <label className="text-xs font-medium text-foreground/70">
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
            <label className="text-xs font-medium text-foreground/70">说明</label>
            <Input
              value={draft.detail}
              onChange={(e) => setDraft((d) => ({ ...d, detail: e.target.value }))}
              placeholder="例如 本地 · OpenAI · 4-bit 量化"
            />
          </div>
        </div>
      </Modal>
    </div>
  )
}
