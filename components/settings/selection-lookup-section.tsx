"use client"

import { useCallback, useEffect, useState } from "react"
import { SectionHeader, SettingsCard, SettingRow, Select } from "./primitives"
import { Switch } from "@/components/ui/switch"
import { useSetting } from "@/lib/use-setting"
import {
  DEFAULT_SELECTION_LOOKUP_SETTINGS,
  type SelectionLookupSettings,
} from "@/lib/selection-lookup"
import {
  isTauri,
  listKnowledgeBases,
  selectionLookupApplySettings,
} from "@/lib/tauri-api"
import { saveSelectedKbaseId, loadSelectedKbaseId } from "@/lib/knowledge"

export function SelectionLookupSection() {
  const [settings, setSettings, loaded] = useSetting<SelectionLookupSettings>(
    "selection_lookup",
    DEFAULT_SELECTION_LOOKUP_SETTINGS,
  )
  const [kbaseId, setKbaseId] = useState<string | null>(null)
  const [kbaseOptions, setKbaseOptions] = useState<{ id: string; name: string }[]>([])

  useEffect(() => {
    if (!isTauri()) return
    void loadSelectedKbaseId().then(setKbaseId)
    void listKnowledgeBases().then((bases) => {
      setKbaseOptions(bases.map((b) => ({ id: b.id, name: b.name })))
    })
  }, [])

  const persist = useCallback(
    (next: SelectionLookupSettings) => {
      setSettings(next)
      if (isTauri()) {
        selectionLookupApplySettings(next).catch((err) => {
          console.error("[selection-lookup] apply settings failed:", err)
        })
      }
    },
    [setSettings],
  )

  const patch = useCallback(
    (partial: Partial<SelectionLookupSettings>) => {
      persist({ ...settings, ...partial })
    },
    [persist, settings],
  )

  const handleKbaseChange = (id: string) => {
    const value = id || null
    setKbaseId(value)
    void saveSelectedKbaseId(value)
  }

  if (!loaded) {
    return null
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        title="划词知识库查询"
        desc="在任意应用中选中文字后，基于默认知识库本地检索匹配片段。不发送到模型。"
      />

      <SettingsCard>
        <SettingRow title="启用划词查询" desc="关闭后快捷键与自动模式均不生效">
          <Switch
            checked={settings.enabled}
            onCheckedChange={(enabled) => patch({ enabled })}
          />
        </SettingRow>
        <SettingRow title="触发方式" desc="快捷键、自动或两者同时启用">
          <Select
            value={settings.triggerMode}
            onChange={(v) =>
              patch({ triggerMode: v as SelectionLookupSettings["triggerMode"] })
            }
            options={[
              { value: "shortcut", label: "仅快捷键" },
              { value: "auto", label: "仅自动" },
              { value: "both", label: "快捷键 + 自动" },
            ]}
          />
        </SettingRow>
        <SettingRow title="全局快捷键" desc="Windows / Linux 默认 Ctrl+Shift+K">
          <input
            type="text"
            value={settings.shortcut}
            onChange={(e) => patch({ shortcut: e.target.value })}
            onBlur={() => persist(settings)}
            className="h-8 w-44 rounded-md border border-border bg-background px-2 font-mono text-xs"
          />
        </SettingRow>
        <SettingRow title="自动模式" desc="鼠标抬起模拟复制，或监听剪贴板复制">
          <Select
            value={settings.autoMode}
            onChange={(v) =>
              patch({ autoMode: v as SelectionLookupSettings["autoMode"] })
            }
            options={[
              { value: "mouse_up", label: "鼠标抬起（划词）" },
              { value: "clipboard", label: "复制触发" },
            ]}
          />
        </SettingRow>
        <SettingRow title="自动延迟" desc="防抖毫秒数，避免连续触发">
          <input
            type="number"
            min={100}
            max={2000}
            step={50}
            value={settings.autoDelayMs}
            onChange={(e) => patch({ autoDelayMs: Number(e.target.value) || 400 })}
            className="h-8 w-24 rounded-md border border-border bg-background px-2 text-xs"
          />
        </SettingRow>
        <SettingRow title="最小选区长度" desc="低于该字符数不触发">
          <input
            type="number"
            min={1}
            max={20}
            value={settings.minSelectionChars}
            onChange={(e) =>
              patch({ minSelectionChars: Number(e.target.value) || 2 })
            }
            className="h-8 w-24 rounded-md border border-border bg-background px-2 text-xs"
          />
        </SettingRow>
        <SettingRow title="检索条数" desc="每次返回的最大片段数">
          <input
            type="number"
            min={1}
            max={20}
            value={settings.topK}
            onChange={(e) => patch({ topK: Number(e.target.value) || 8 })}
            className="h-8 w-24 rounded-md border border-border bg-background px-2 text-xs"
          />
        </SettingRow>
        <SettingRow title="关闭时最小化到托盘" desc="关闭主窗口后仍可在后台划词">
          <Switch
            checked={settings.closeToTray}
            onCheckedChange={(closeToTray) => patch({ closeToTray })}
          />
        </SettingRow>
        <SettingRow title="默认知识库" desc="划词检索的目标知识库">
          <Select
            value={kbaseId ?? ""}
            onChange={handleKbaseChange}
            options={[
              { value: "", label: "未选择" },
              ...kbaseOptions.map((b) => ({ value: b.id, label: b.name })),
            ]}
          />
        </SettingRow>
      </SettingsCard>
    </div>
  )
}
