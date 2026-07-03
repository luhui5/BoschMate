"use client"

import { useState } from "react"
import { Loader2 } from "lucide-react"
import { Modal } from "@/components/ui/modal"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { Project } from "@/lib/types"

export function NewProjectDialog({
  open,
  onClose,
  onCreate,
}: {
  open: boolean
  onClose: () => void
  onCreate: (p: Project) => void
}) {
  const [name, setName] = useState("")
  const [path, setPath] = useState("")
  const [host, setHost] = useState("")
  const [submitting, setSubmitting] = useState(false)

  const reset = () => {
    setName("")
    setPath("")
    setHost("")
  }

  const submit = async () => {
    if (!name.trim()) return
    setSubmitting(true)
    try {
      const now = new Date().toISOString()
      onCreate({
        id: `p${Date.now()}`,
        name: name.trim(),
        localPath: path.trim() || `~/${name.trim()}`,
        language: "—",
        framework: "—",
        gitBranch: "main",
        ciStatus: "none",
        openedAt: now,
        createdAt: now,
        lastChatSummary: "新项目，尚无聊天记录。",
        kind: "ssh",
        sshHost: host.trim() || "remote-host",
      })
      reset()
      onClose()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        reset()
        onClose()
      }}
      title="连接 SSH 主机"
      description="通过 SSH 连接远程项目，所有操作在远端沙箱执行。"
      footer={
        <>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              reset()
              onClose()
            }}
          >
            取消
          </Button>
          <Button size="sm" onClick={submit} disabled={!name.trim() || submitting}>
            {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
            连接
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">项目名称</span>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="my-project" autoFocus />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">SSH 主机</span>
          <Input
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder="user@host 或 已配置的别名"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">远端路径</span>
          <Input
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="/srv/my-project"
            className="font-mono"
          />
        </label>
      </div>
    </Modal>
  )
}
