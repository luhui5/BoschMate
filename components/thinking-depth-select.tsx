"use client"

import { useState } from "react"
import { Brain, ChevronDown, Check } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { THINKING_DEPTHS, getThinkingDepth, type ThinkingDepth } from "@/lib/thinking-depth"

export function ThinkingDepthSelect({
  value,
  onChange,
  variant = "ghost",
  align = "left",
}: {
  value: ThinkingDepth
  onChange: (d: ThinkingDepth) => void
  variant?: "ghost" | "outline"
  align?: "left" | "right"
}) {
  const [open, setOpen] = useState(false)
  const active = getThinkingDepth(value)

  return (
    <div className="relative">
      <Button
        variant={variant}
        size="sm"
        className="gap-1.5"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Brain className="size-3.5 text-primary" />
        <span className="hidden sm:inline">思考深度：</span>
        {active.label}
        <ChevronDown className="size-3.5" />
      </Button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden />
          <div
            className={cn(
              "absolute bottom-full z-20 mb-1 w-64 overflow-hidden rounded-lg border border-border bg-popover p-1 shadow-xl",
              align === "right" ? "right-0" : "left-0",
            )}
          >
            {THINKING_DEPTHS.map((d) => (
              <button
                key={d.id}
                onClick={() => {
                  onChange(d.id)
                  setOpen(false)
                }}
                className={cn(
                  "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent",
                  d.id === value && "bg-accent",
                )}
              >
                <Check
                  className={cn("mt-0.5 size-3.5 shrink-0", d.id === value ? "text-primary" : "opacity-0")}
                />
                <span className="flex min-w-0 flex-col">
                  <span className="text-sm font-medium">{d.label}</span>
                  <span className="text-xs text-muted-foreground">{d.desc}</span>
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
