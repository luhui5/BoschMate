"use client"

import { useState } from "react"
import Link from "next/link"
import {
  ArrowLeft,
  Cpu,
  Keyboard,
  Brain,
  ShieldCheck,
  Palette,
  Plug,
  Bell,
  Info,
  ScanSearch,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Wordmark } from "@/components/brand"
import { useApp } from "@/components/app-provider"
import { ModelSection } from "./model-section"
import { ShortcutsSection } from "./shortcuts-section"
import { MemorySection } from "./memory-section"
import { PrivacySection } from "./privacy-section"
import { AppearanceSection } from "./appearance-section"
import { IntegrationsSection } from "./integrations-section"
import { NotificationsSection } from "./notifications-section"
import { AboutSection } from "./about-section"
import { SelectionLookupSection } from "./selection-lookup-section"

type SectionId =
  | "appearance"
  | "model"
  | "shortcuts"
  | "memory"
  | "privacy"
  | "integrations"
  | "notifications"
  | "selectionLookup"
  | "about"

export function SettingsView() {
  const { t } = useApp()
  const [active, setActive] = useState<SectionId>("appearance")

  // Diagnostic: confirm component mounted
  if (typeof window !== "undefined") {
    console.log("[SettingsView] mounted, default tab=appearance")
  }

  const NAV: { id: SectionId; label: string; icon: typeof Cpu; desc: string }[] = [
    { id: "appearance", label: t("settings.appearance"), icon: Palette, desc: "语言、主题、字体" },
    { id: "model", label: t("settings.model"), icon: Cpu, desc: "本地与云端模型、上下文" },
    { id: "shortcuts", label: t("settings.shortcuts"), icon: Keyboard, desc: "键盘绑定" },
    { id: "memory", label: t("settings.memory"), icon: Brain, desc: "长期记忆与规则" },
    { id: "privacy", label: t("settings.privacy"), icon: ShieldCheck, desc: "数据与权限" },
    { id: "integrations", label: t("settings.integrations"), icon: Plug, desc: "Git、终端、MCP" },
    { id: "notifications", label: t("settings.notifications"), icon: Bell, desc: "提醒与声音" },
    { id: "selectionLookup", label: t("settings.selectionLookup"), icon: ScanSearch, desc: "桌面划词知识库查询" },
    { id: "about", label: t("settings.about"), icon: Info, desc: "版本与自动更新" },
  ]

  return (
    <div className="flex h-[calc(100dvh-34px)] flex-col bg-background text-foreground">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
        <Link
          href="/"
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="返回主页"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <Wordmark />
        <span className="text-sm text-muted-foreground">/</span>
        <span className="text-sm font-medium">{t("settings.title")}</span>
      </header>

      <div className="mx-auto flex w-full max-w-5xl flex-1 overflow-hidden">
        <nav className="hidden w-60 shrink-0 flex-col gap-1 overflow-y-auto border-r border-border p-3 md:flex">
          {NAV.map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.id}
                onClick={() => setActive(item.id)}
                className={cn(
                  "relative flex items-start gap-3 rounded-lg px-3 py-2 text-left transition-colors",
                  active === item.id
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                )}
              >
                {active === item.id && (
                  <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-primary" />
                )}
                <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                <span className="flex flex-col">
                  <span className="text-sm font-medium leading-tight">{item.label}</span>
                  <span className="text-xs text-muted-foreground">{item.desc}</span>
                </span>
              </button>
            )
          })}
        </nav>

        {/* Mobile nav */}
        <div className="flex w-full flex-col overflow-hidden">
          <div className="flex gap-1 overflow-x-auto border-b border-border p-2 md:hidden">
            {NAV.map((item) => (
              <button
                key={item.id}
                onClick={() => setActive(item.id)}
                className={cn(
                  "whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                  active === item.id
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-6">
            {active === "model" && <ModelSection />}
            {active === "shortcuts" && <ShortcutsSection />}
            {active === "memory" && <MemorySection />}
            {active === "privacy" && <PrivacySection />}
            {active === "appearance" && <AppearanceSection />}
            {active === "integrations" && <IntegrationsSection />}
            {active === "notifications" && <NotificationsSection />}
            {active === "selectionLookup" && <SelectionLookupSection />}
            {active === "about" && <AboutSection />}
          </div>
        </div>
      </div>
    </div>
  )
}
