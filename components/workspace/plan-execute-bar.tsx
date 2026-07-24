"use client"

import { useState, useCallback } from "react"
import { Hammer, ListTodo, Download, Check, Square } from "lucide-react"
import { Button } from "@/components/ui/button"

interface PlanStep {
  order: number
  action: string
  tool?: string
  expectedResult?: string
}

interface PlanData {
  title: string
  steps: PlanStep[]
  markdown: string
}

export function PlanExecuteBar({
  onExecute,
  disabled,
  disabledReason,
  planData,
  onExport,
  onUpdatePlan,
}: {
  onExecute: () => void
  disabled?: boolean
  disabledReason?: string
  planData?: PlanData | null
  onExport?: (markdown: string) => void
  onUpdatePlan?: (markdown: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [editContent, setEditContent] = useState(planData?.markdown ?? "")
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set())

  const handleToggleStep = useCallback((order: number) => {
    setCompletedSteps((prev) => {
      const next = new Set(prev)
      if (next.has(order)) {
        next.delete(order)
      } else {
        next.add(order)
      }
      return next
    })
  }, [])

  const handleSave = () => {
    onUpdatePlan?.(editContent)
    setEditing(false)
  }

  if (!planData || planData.steps.length === 0) {
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

  return (
    <div className="w-full overflow-hidden rounded-lg border border-border bg-background">
      <div className="flex items-center gap-2 border-b border-border bg-card px-3 py-2">
        <ListTodo className="size-4 shrink-0 text-primary" />
        <span className="flex-1 text-sm font-medium">
          {planData.title}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={() => setEditing((v) => !v)}
            title={editing ? "预览" : "编辑"}
          >
            {editing ? <Check className="size-3.5" /> : <Square className="size-3.5" />}
          </button>
          {onExport && (
            <button
              type="button"
              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={() => onExport(planData.markdown)}
              title="导出为 Markdown"
            >
              <Download className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      {editing ? (
        <div className="p-3">
          <textarea
            className="w-full min-h-40 rounded border border-border bg-muted/30 p-2 font-mono text-xs text-foreground resize-y"
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
          />
          <div className="mt-2 flex justify-end gap-2">
            <Button size="sm" variant="secondary" onClick={() => { setEditing(false); setEditContent(planData.markdown) }}>
              取消
            </Button>
            <Button size="sm" onClick={handleSave}>
              保存
            </Button>
          </div>
        </div>
      ) : (
        <div className="p-3 space-y-1.5">
          {planData.steps.map((step) => {
            const done = completedSteps.has(step.order)
            return (
              <button
                key={step.order}
                type="button"
                onClick={() => handleToggleStep(step.order)}
                className="flex w-full items-start gap-2 rounded p-1.5 text-left text-xs transition-colors hover:bg-muted/50"
              >
                <span className={done ? "text-emerald-400" : "text-muted-foreground"}>
                  {done ? (
                    <Check className="size-3.5" />
                  ) : (
                    <span className="flex size-3.5 items-center justify-center rounded border border-muted-foreground/50">
                      <span className="text-[9px]">{step.order}</span>
                    </span>
                  )}
                </span>
                <span className={done ? "text-muted-foreground line-through" : "text-foreground"}>
                  {step.action}
                  {step.tool && (
                    <code className="ml-1 rounded bg-muted px-1 py-0.5 font-mono text-[10px] text-muted-foreground">
                      {step.tool}
                    </code>
                  )}
                </span>
              </button>
            )
          })}

          <div className="mt-3 border-t border-border pt-2">
            <p className="text-xs text-muted-foreground">
              {completedSteps.size}/{planData.steps.length} 步已完成
            </p>
          </div>
        </div>
      )}

      <div className="flex justify-end border-t border-border p-2">
        <Button
          size="sm"
          className="gap-1.5"
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
