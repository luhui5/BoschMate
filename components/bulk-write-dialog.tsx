"use client"

import { Button } from "@/components/ui/button"
import { Modal } from "@/components/ui/modal"
import { AlertTriangle } from "lucide-react"

export function BulkWriteDialog({
  open,
  onConfirm,
  onCancel,
}: {
  open: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  if (!open) return null
  return (
    <Modal open title="确认批量写入" onClose={onCancel}>
      <div className="max-w-md space-y-4 py-2">
        <div className="flex items-start gap-3">
          <AlertTriangle className="size-5 shrink-0 text-warning" />
          <p className="text-sm text-muted-foreground">
            Auto 模式即将修改超过 <strong>50</strong> 个文件。继续操作可能影响大量代码，请确认您已审阅 Agent 的计划。
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            取消
          </Button>
          <Button size="sm" onClick={onConfirm}>
            确认继续
          </Button>
        </div>
      </div>
    </Modal>
  )
}
