"use client"

import { ArrowDown } from "lucide-react"
import { cn } from "@/lib/utils"

export function ScrollToBottomButton({
  visible,
  onClick,
  className,
}: {
  visible: boolean
  onClick: () => void
  className?: string
}) {
  if (!visible) return null

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="回到底部"
      className={cn(
        "absolute bottom-3 left-1/2 z-10 flex size-8 -translate-x-1/2 items-center justify-center rounded-full border border-border bg-muted/80 text-muted-foreground shadow-sm transition-opacity hover:bg-muted",
        className,
      )}
    >
      <ArrowDown className="size-4" />
    </button>
  )
}
