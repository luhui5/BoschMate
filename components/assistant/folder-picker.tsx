"use client"

import { useState } from "react"
import { Folder, FolderOpen, Check } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Modal } from "@/components/ui/modal"

/** 演示用的近期文件夹；桌面端接入 Tauri 后会替换为真实的目录选择对话框 */
const RECENT_FOLDERS = [
  "~/dev/bosch-code",
  "~/dev/bosch-code/docs",
  "~/dev/web-dashboard",
  "~/dev/ml-pipeline",
  "~/Documents/knowledge-base",
  "/srv/go-gateway",
]

export function FolderPicker({
  open,
  current,
  onClose,
  onSelect,
}: {
  open: boolean
  current: string | null
  onClose: () => void
  onSelect: (folder: string | null) => void
}) {
  const [custom, setCustom] = useState("")

  return (
    <Modal open={open} onClose={onClose} title="指定工作文件夹" className="max-w-md">
      <div className="space-y-4">
        <p className="text-xs text-muted-foreground">
          选择一个文件夹后，助手将在该目录范围内读取、检索和修改文件，回答会围绕其内容展开。
        </p>

        <div className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">近期文件夹</span>
          <div className="max-h-56 space-y-0.5 overflow-y-auto">
            {RECENT_FOLDERS.map((f) => (
              <button
                key={f}
                onClick={() => {
                  onSelect(f)
                  onClose()
                }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors hover:bg-accent",
                  current === f && "bg-accent",
                )}
              >
                <Folder className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate font-mono text-xs">{f}</span>
                {current === f && <Check className="size-4 shrink-0 text-primary" />}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">或输入路径</span>
          <div className="flex gap-2">
            <input
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              placeholder="/path/to/folder"
              className="h-9 flex-1 rounded-md border border-border bg-background px-2.5 font-mono text-xs outline-none focus:border-ring"
            />
            <Button
              size="sm"
              disabled={!custom.trim()}
              onClick={() => {
                onSelect(custom.trim())
                setCustom("")
                onClose()
              }}
            >
              <FolderOpen className="size-4" />
              使用
            </Button>
          </div>
        </div>

        {current && (
          <div className="flex items-center justify-between border-t border-border pt-3">
            <span className="truncate font-mono text-xs text-muted-foreground">已绑定：{current}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                onSelect(null)
                onClose()
              }}
            >
              解除绑定
            </Button>
          </div>
        )}
      </div>
    </Modal>
  )
}
