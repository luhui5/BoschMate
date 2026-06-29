"use client"

import { useState } from "react"
import { Check, Cpu, Cloud, HardDrive } from "lucide-react"
import { cn } from "@/lib/utils"
import { SectionHeader, SettingsCard, SettingRow, Select } from "./primitives"
import { Switch } from "@/components/ui/switch"

const MODELS = [
  {
    id: "local-qwen",
    name: "Qwen2.5-Coder 32B",
    kind: "local",
    detail: "本地 · Ollama · 4-bit 量化",
    icon: HardDrive,
  },
  {
    id: "local-deepseek",
    name: "DeepSeek-Coder V2 16B",
    kind: "local",
    detail: "本地 · llama.cpp",
    icon: HardDrive,
  },
  {
    id: "cloud-claude",
    name: "Claude Opus 4.6",
    kind: "cloud",
    detail: "云端 · 需 API Key",
    icon: Cloud,
  },
  {
    id: "cloud-gpt",
    name: "GPT-5",
    kind: "cloud",
    detail: "云端 · 需 API Key",
    icon: Cloud,
  },
]

export function ModelSection() {
  const [selected, setSelected] = useState("local-qwen")
  const [contextWindow, setContextWindow] = useState("32768")
  const [temperature, setTemperature] = useState(0.2)
  const [preferLocal, setPreferLocal] = useState(true)
  const [autoFallback, setAutoFallback] = useState(true)

  return (
    <div className="space-y-6">
      <SectionHeader
        title="模型与推理"
        desc="BoschCode 优先在本地运行模型，保证代码与数据不出本机。可在离线时自动降级。"
      />

      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          活动模型
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {MODELS.map((m) => {
            const Icon = m.icon
            const isActive = selected === m.id
            return (
              <button
                key={m.id}
                onClick={() => setSelected(m.id)}
                className={cn(
                  "flex items-center gap-3 rounded-lg border px-3 py-3 text-left transition-colors",
                  isActive
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-ring hover:bg-muted/40",
                )}
              >
                <span
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
                    m.kind === "local"
                      ? "bg-emerald-500/15 text-emerald-400"
                      : "bg-sky-500/15 text-sky-400",
                  )}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{m.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{m.detail}</span>
                </span>
                {isActive && <Check className="h-4 w-4 shrink-0 text-primary" />}
              </button>
            )
          })}
        </div>
      </div>

      <SettingsCard>
        <SettingRow title="上下文窗口" desc="单次会话可用的最大 token 数">
          <Select
            value={contextWindow}
            onChange={setContextWindow}
            options={[
              { value: "8192", label: "8K" },
              { value: "32768", label: "32K" },
              { value: "131072", label: "128K" },
            ]}
          />
        </SettingRow>
        <SettingRow
          title={`采样温度 · ${temperature.toFixed(2)}`}
          desc="较低更稳定，较高更有创造力"
        >
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={temperature}
            onChange={(e) => setTemperature(Number(e.target.value))}
            className="w-40 accent-primary"
          />
        </SettingRow>
        <SettingRow title="优先使用本地模型" desc="可用时始终优先调用本地推理">
          <Switch checked={preferLocal} onCheckedChange={setPreferLocal} />
        </SettingRow>
        <SettingRow
          title="自动降级"
          desc="本地资源不足或离线时，自动切换到降级 / 离线模式"
        >
          <Switch checked={autoFallback} onCheckedChange={setAutoFallback} />
        </SettingRow>
      </SettingsCard>

      <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
        <Cpu className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          当前硬件：Apple M3 Max · 48GB 统一内存 · 检测到 Metal 加速。本地模型预计吞吐 ~38 tok/s。
        </span>
      </div>
    </div>
  )
}
