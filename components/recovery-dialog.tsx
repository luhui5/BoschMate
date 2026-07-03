"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Modal } from "@/components/ui/modal"
import { RotateCcw, Trash2, Info } from "lucide-react"

export interface RecoverySnapshotItem {
  sessionId: string
  projectId?: string
  draftContent: string
  messagesJson: string
  savedAt: string
}

export function RecoveryDialog({
  snapshots,
  onRestore,
  onDiscard,
  onDiscardAll,
}: {
  snapshots: RecoverySnapshotItem[]
  onRestore: (snap: RecoverySnapshotItem) => void
  onDiscard: (sessionId: string) => void
  onDiscardAll: () => void
}) {
  const [detailId, setDetailId] = useState<string | null>(null)
  const detail = snapshots.find((s) => s.sessionId === detailId)

  if (snapshots.length === 0) return null

  return (
    <Modal open title="恢复未保存的会话？" onClose={onDiscardAll}>
      <div className="max-w-lg space-y-4 py-2">
        <p className="text-sm text-muted-foreground">
          检测到上次异常退出前保存的会话快照。您可以选择恢复、丢弃或查看详情。
        </p>
        <ul className="max-h-60 space-y-2 overflow-auto">
          {snapshots.map((snap) => {
            let msgCount = 0
            let pendingChanges = 0
            try {
              const msgs = JSON.parse(snap.messagesJson) as Array<{ diffs?: unknown[] }>
              msgCount = msgs.length
              pendingChanges = msgs.reduce(
                (n, m) => n + (m.diffs?.filter?.(() => true)?.length ?? 0),
                0,
              )
            } catch {
              /* ignore parse errors */
            }
            return (
              <li
                key={snap.sessionId}
                className="flex items-center gap-2 rounded-lg border border-border p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-xs">{snap.sessionId.slice(0, 8)}…</p>
                  <p className="text-[10px] text-muted-foreground">
                    {new Date(snap.savedAt).toLocaleString()} · {msgCount} 条消息
                    {pendingChanges > 0 ? ` · ${pendingChanges} 个待处理变更` : ""}
                  </p>
                </div>
                <Button variant="ghost" size="xs" onClick={() => setDetailId(snap.sessionId)}>
                  <Info className="size-3" />
                  详情
                </Button>
                <Button variant="outline" size="xs" onClick={() => onDiscard(snap.sessionId)}>
                  <Trash2 className="size-3" />
                  丢弃
                </Button>
                <Button size="xs" onClick={() => onRestore(snap)}>
                  <RotateCcw className="size-3" />
                  恢复
                </Button>
              </li>
            )
          })}
        </ul>
        {detail && (
          <div className="rounded-lg border border-border bg-muted/30 p-3">
            <p className="mb-1 text-xs font-medium">快照详情</p>
            <pre className="max-h-40 overflow-auto text-[10px] text-muted-foreground whitespace-pre-wrap">
              {detail.messagesJson.slice(0, 2000)}
              {detail.messagesJson.length > 2000 ? "\n…" : ""}
            </pre>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onDiscardAll}>
            全部丢弃
          </Button>
        </div>
      </div>
    </Modal>
  )
}
