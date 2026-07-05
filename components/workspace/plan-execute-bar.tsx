"use client"

import { Hammer, ListTodo } from "lucide-react"
import { Button } from "@/components/ui/button"

export function PlanExecuteBar({
  onExecute,
  disabled,
  disabledReason,
}: {
  onExecute: () => void
  disabled?: boolean
  disabledReason?: string
}) {
  return (
    <div className="w-full overflow-hidden rounded-lg border border-border bg-background">
      <div className="flex items-center gap-2 border-b border-border bg-card px-3 py-2">
        <ListTodo className="size-4 shrink-0 text-primary" />
        <span className="text-sm font-medium">计划已就绪</span>
      </div>
      <div className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground">
          一键切换到 Auto 模式并按此计划逐步执行，无需手动切换模式或输入指令。
        </p>
        <Button
          size="sm"
          className="shrink-0 gap-1.5"
          disabled={disabled}
          title={disabled ? disabledReason : undefined}
          onClick={onExecute}
        >
          <Hammer className="size-3.5" />
          执行计划
        </Button>
      </div>
    </div>
  )
}
