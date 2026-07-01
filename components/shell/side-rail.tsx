"use client"

import Link from "next/link"
import { Sparkles, Code2, BookUp, Settings, Sun, Moon } from "lucide-react"
import { cn } from "@/lib/utils"
import { useApp } from "@/components/app-provider"
import { BoschLogo } from "@/components/bosch-logo"
import type { ShellView } from "./app-shell"

interface SideRailProps {
  active: ShellView
  onSelect: (v: ShellView) => void
  onOpenKnowledge: () => void
  knowledgeCount: number
}

interface RailButtonProps {
  icon: React.ComponentType<{ className?: string }>
  label: string
  active?: boolean
  badge?: number
  onClick?: () => void
}

function RailButton({ icon: Icon, label, active, badge, onClick }: RailButtonProps) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex w-full flex-col items-center gap-1 rounded-lg py-2.5 transition-colors",
        active
          ? "bg-primary/10 text-primary"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {active && (
        <span className="absolute left-0 top-1/2 h-6 w-0.5 -translate-y-1/2 rounded-r-full bg-primary" />
      )}
      <span className="relative">
        <Icon className="size-5" />
        {badge !== undefined && badge > 0 && (
          <span className="absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
            {badge}
          </span>
        )}
      </span>
      <span className="text-[10px] font-medium leading-none">{label}</span>
    </button>
  )
}

export function SideRail({ active, onSelect, onOpenKnowledge, knowledgeCount }: SideRailProps) {
  const { resolvedTheme, toggleTheme } = useApp()

  return (
    <aside className="sticky top-[34px] flex h-[calc(100vh-34px)] w-16 shrink-0 flex-col items-center gap-1 border-r border-border bg-card/40 px-2 py-3">
      {/* Brand mark */}
      <div className="mb-2 flex size-9 items-center justify-center rounded-lg bg-foreground text-background">
        <BoschLogo className="size-5" />
      </div>

      {/* Primary navigation */}
      <nav className="flex w-full flex-col gap-1">
        <RailButton
          icon={Sparkles}
          label="助手"
          active={active === "assistant"}
          onClick={() => onSelect("assistant")}
        />
        <RailButton
          icon={Code2}
          label="编码"
          active={active === "coding"}
          onClick={() => onSelect("coding")}
        />
      </nav>

      {/* Bottom utilities */}
      <div className="mt-auto flex w-full flex-col gap-1">
        <RailButton
          icon={BookUp}
          label="知识库"
          badge={knowledgeCount}
          onClick={onOpenKnowledge}
        />
        <Link href="/settings" className="w-full">
          <RailButton icon={Settings} label="设置" />
        </Link>
        <button
          onClick={toggleTheme}
          aria-label="切换主题"
          className="flex w-full flex-col items-center gap-1 rounded-lg py-2.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          {resolvedTheme === "dark" ? <Sun className="size-5" /> : <Moon className="size-5" />}
          <span className="text-[10px] font-medium leading-none">主题</span>
        </button>
      </div>
    </aside>
  )
}
