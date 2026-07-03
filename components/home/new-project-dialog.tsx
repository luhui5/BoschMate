"use client"

import { useState } from "react"
import { FolderOpen, Loader2 } from "lucide-react"
import { Modal } from "@/components/ui/modal"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { Project } from "@/lib/types"
import { isTauri, pickFolder } from "@/lib/tauri-api"

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
  const [browsing, setBrowsing] = useState(false)

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
          {isSsh ? (
            <Input
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="/srv/my-project"
              className="font-mono"
            />
          ) : (
            <div className="relative">
              <Input
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder="~/dev/my-project"
                className="w-full pr-8 font-mono"
              />
              {isTauri() && (
                <button
                  type="button"
                  className="absolute inset-y-0 right-0 flex w-8 items-center justify-center rounded-r-md text-muted-foreground transition-colors hover:text-foreground"
                  disabled={browsing}
                  onClick={async () => {
                    setBrowsing(true)
                    try {
                      const selected = await pickFolder()
                      if (selected) setPath(selected)
                    } finally {
                      setBrowsing(false)
                    }
                  }}
                  aria-label="浏览文件夹"
                >
                  {browsing ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <FolderOpen className="size-4" />
                  )}
                </button>
              )}
            </div>
          )}
        </label>
      </div>
    </Modal>
  )
}
