"use client"

import { useState } from "react"
import { Modal } from "@/components/ui/modal"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { Project } from "@/lib/types"

export function NewProjectDialog({
  open,
  mode,
  onClose,
  onCreate,
}: {
  open: boolean
  mode: "new" | "ssh"
  onClose: () => void
  onCreate: (p: Project) => void
}) {
  const isSsh = mode === "ssh"
  const [name, setName] = useState("")
  const [path, setPath] = useState("")
  const [host, setHost] = useState("")

  const reset = () => {
    setName("")
    setPath("")
    setHost("")
  }

  const submit = () => {
    if (!name.trim()) return
    const now = new Date().toISOString()
    onCreate({
      id: `p${Date.now()}`,
      name: name.trim(),
      localPath: path.trim() || (isSsh ? `~/${name.trim()}` : `~/dev/${name.trim()}`),
      language: "TypeScript",
      framework: "—",
      gitBranch: "main",
      ciStatus: "none",
      openedAt: now,
      createdAt: now,
      lastChatSummary: "新项目，尚无聊天记录。",
      kind: isSsh ? "ssh" : "local",
      sshHost: isSsh ? host.trim() || "remote-host" : undefined,
    })
    reset()
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        reset()
        onClose()
      }}
      title={isSsh ? "连接 SSH 主机" : "新建 / 打开项目"}
      description={
        isSsh
          ? "通过 SSH 连接远程项目，所有操作在远端沙箱执行。"
          : "选择本地目录开始，BoschCode 将加载项目上下文与长期记忆。"
      }
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
          <Button size="sm" onClick={submit} disabled={!name.trim()}>
            {isSsh ? "连接" : "打开项目"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">项目名称</span>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="my-project" autoFocus />
        </label>
        {isSsh && (
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">SSH 主机</span>
            <Input
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="user@host 或 已配置的别名"
            />
          </label>
        )}
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            {isSsh ? "远端路径" : "本地路径"}
          </span>
          <Input
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder={isSsh ? "/srv/my-project" : "~/dev/my-project"}
            className="font-mono"
          />
        </label>
      </div>
    </Modal>
  )
}
