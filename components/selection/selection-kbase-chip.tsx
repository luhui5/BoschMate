"use client"

import { BookOpen } from "lucide-react"
import { cn } from "@/lib/utils"

interface SelectionKbaseChipProps {
  kbaseName: string
  onClick: () => void
  disabled?: boolean
}

export function SelectionKbaseChip({
  kbaseName,
  onClick,
  disabled,
}: SelectionKbaseChipProps) {
  return (
    <button
      type="button"
      title={`查询「${kbaseName}」`}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex h-full w-full items-center justify-center gap-2 rounded-xl border border-border",
        "bg-card px-3 shadow-lg transition-colors",
        "hover:bg-accent hover:border-primary/30",
        "disabled:cursor-not-allowed disabled:opacity-50",
      )}
    >
      <span className="flex size-8 items-center justify-center rounded-full bg-primary/10 text-primary">
        <BookOpen className="size-4" />
      </span>
      <span className="max-w-[4.5rem] truncate text-xs font-medium">{kbaseName}</span>
    </button>
  )
}
