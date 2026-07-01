"use client"

import { Moon, Sun, Monitor, Check, Languages } from "lucide-react"
import { cn } from "@/lib/utils"
import { useApp } from "@/components/app-provider"
import type { Lang } from "@/lib/i18n"
import { SectionHeader, SettingsCard, SettingRow, Select } from "./primitives"
import { Switch } from "@/components/ui/switch"
import { useSetting } from "@/lib/use-setting"

const ACCENTS = [
  { id: "blue", color: "oklch(0.62 0.19 250)" },
  { id: "emerald", color: "oklch(0.7 0.17 162)" },
  { id: "amber", color: "oklch(0.77 0.16 70)" },
  { id: "rose", color: "oklch(0.65 0.22 18)" },
]

export function AppearanceSection() {
  const {
    t,
    lang,
    setLang,
    themeMode,
    setThemeMode,
    fontSize,
    setFontSize,
    editorFont,
    setEditorFont,
  } = useApp()
  const [accent, setAccent] = useSetting("appearance_accent", "blue")
  const [ligatures, setLigatures] = useSetting("appearance_ligatures", true)

  const themes = [
    { id: "dark" as const, label: t("settings.theme.dark"), icon: Moon },
    { id: "light" as const, label: t("settings.theme.light"), icon: Sun },
    { id: "system" as const, label: t("settings.theme.system"), icon: Monitor },
  ]

  const fontSizes = [
    { id: "sm" as const, label: t("settings.fontSize.sm") },
    { id: "md" as const, label: t("settings.fontSize.md") },
    { id: "lg" as const, label: t("settings.fontSize.lg") },
  ]

  return (
    <div className="space-y-6">
      <SectionHeader title={t("settings.appearance")} desc="语言、主题与编辑器排版（置顶分区）。" />

      {/* 语言（置顶） */}
      <SettingsCard>
        <SettingRow title={t("settings.language")} desc={t("settings.language.desc")}>
          <div className="flex items-center gap-2">
            <Languages className="h-4 w-4 text-muted-foreground" />
            <Select
              value={lang}
              onChange={(v) => setLang(v as Lang)}
              options={[
                { value: "zh", label: "简体中文" },
                { value: "en", label: "English" },
              ]}
            />
          </div>
        </SettingRow>
      </SettingsCard>

      {/* 主题 */}
      <div>
        <p className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {t("settings.theme")}
        </p>
        <p className="mb-2 text-xs text-muted-foreground">{t("settings.theme.desc")}</p>
        <div className="grid grid-cols-3 gap-3">
          {themes.map((th) => {
            const Icon = th.icon
            const isActive = themeMode === th.id
            return (
              <button
                key={th.id}
                onClick={() => setThemeMode(th.id)}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg border px-3 py-3 transition-colors",
                  isActive ? "border-primary bg-primary/5" : "border-border hover:border-ring",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="text-sm font-medium">{th.label}</span>
                {isActive && <Check className="ml-auto h-4 w-4 text-primary" />}
              </button>
            )
          })}
        </div>
      </div>

      {/* 强调色 */}
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          强调色
        </p>
        <div className="flex gap-3">
          {ACCENTS.map((a) => (
            <button
              key={a.id}
              onClick={() => setAccent(a.id)}
              className={cn(
                "h-9 w-9 rounded-full border-2 transition-transform hover:scale-110",
                accent === a.id ? "border-foreground" : "border-transparent",
              )}
              style={{ backgroundColor: a.color }}
              aria-label={`强调色 ${a.id}`}
            />
          ))}
        </div>
      </div>

      {/* 字体大小（分段控件，影响聊天与代码展示区） */}
      <div>
        <p className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {t("settings.fontSize")}
        </p>
        <p className="mb-2 text-xs text-muted-foreground">{t("settings.fontSize.desc")}</p>
        <div className="inline-flex rounded-lg border border-border p-1">
          {fontSizes.map((f) => (
            <button
              key={f.id}
              onClick={() => setFontSize(f.id)}
              className={cn(
                "rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
                fontSize === f.id
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* 编辑器字体与连字 */}
      <SettingsCard>
        <SettingRow title={t("settings.editorFont")} desc={t("settings.editorFont.desc")}>
          <Select
            value={editorFont}
            onChange={(v) => setEditorFont(v as typeof editorFont)}
            options={[
              { value: "geist-mono", label: "Geist Mono" },
              { value: "jetbrains", label: "JetBrains Mono" },
              { value: "fira", label: "Fira Code" },
              { value: "sf-mono", label: "SF Mono" },
            ]}
          />
        </SettingRow>
        <SettingRow title="字体连字" desc="在代码中启用编程连字（如 => 、!==）">
          <Switch checked={ligatures} onCheckedChange={setLigatures} />
        </SettingRow>
      </SettingsCard>

      {/* 预览 */}
      <div className="rounded-xl border border-border bg-card p-4">
        <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          预览
        </p>
        <p className="text-sm leading-relaxed">这是一段示例界面文字，用于预览当前字号设置。</p>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-secondary p-3 font-mono text-sm">
          <code>{`fn main() {\n    println!("hello, bosch");\n}`}</code>
        </pre>
      </div>
    </div>
  )
}
