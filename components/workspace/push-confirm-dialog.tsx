"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Modal } from "@/components/ui/modal"
import { GitBranch, AlertTriangle, Ban } from "lucide-react"

export interface PushConfirmRequest {
  remote: string
  branch: string
  ahead: number
  behind: number
  sessionId?: string
  callbackId: string
}

export function PushConfirmDialog({
  request,
  onConfirm,
  onCancel,
}: {
  request: PushConfirmRequest | null
  onConfirm: (callbackId: string) => void
  onCancel: (callbackId: string) => void
}) {
  if (!request) return null

  const isForcePush = false // force push is blocked at backend level
  const hasDiverged = request.behind > 0

  return (
    <Modal
      open
      title={isForcePush ? "禁止强制推送" : "确认 Git Push"}
      onClose={() => onCancel(request.callbackId)}
      footer={
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => onCancel(request.callbackId)}>
            取消
          </Button>
          <Button
            size="sm"
            onClick={() => onConfirm(request.callbackId)}
            className="gap-1.5"
          >
            <GitBranch className="size-3.5" />
            确认推送
          </Button>
        </div>
      }
    >
      <div className="max-w-sm space-y-3 py-2">
        <div className="rounded-lg border border-border bg-muted/30 p-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">远程仓库</span>
            <span className="font-mono font-medium">{request.remote}</span>
          </div>
          <div className="mt-1 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">当前分支</span>
            <span className="font-mono font-medium">{request.branch}</span>
          </div>
          <div className="mt-1 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">领先 / 落后</span>
            <span className="font-mono">
              +{request.ahead} / -{request.behind}
            </span>
          </div>
        </div>

        {hasDiverged && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-400" />
            <div className="text-xs text-amber-400/90">
              <p className="font-medium">分支已分叉</p>
              <p className="mt-0.5">
                远程仓库有 {request.behind} 个新提交。推送前建议先拉取合并。
              </p>
            </div>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          AI Agent 请求将本地提交推送到远程仓库。推送前请确认代码变更符合预期。
        </p>
      </div>
    </Modal>
  )
}
