"use client"

import { useState } from "react"
import { FolderOpen, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Modal } from "@/components/ui/modal"
import { pickFolder, isTauri } from "@/lib/tauri-api"

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
  const [browsing, setBrowsing] = useState(false)

  const handleBrowse = async () => {
    setBrowsing(true)
    try {
      const selected = await pickFolder()
      if (selected) {
        onSelect(selected)
        onClose()
      }
    } finally {
      setBrowsing(false)
    }
  }

  const tauriAvailable = isTauri()

  return (
    <Modal open={open} onClose={onClose} title="指定工作文件夹" className="max-w-md">
      <div className="space-y-4">
        <p className="text-xs text-muted-foreground">
          选择一个文件夹后，助手将在该目录范围内读取、检索和修改文件，回答会围绕其内容展开。
        </p>

        {/* Native folder picker button — uses OS dialog (Windows/Linux) */}
        {tauriAvailable && (
          <Button
            variant="default"
            className="w-full gap-2"
            onClick={handleBrowse}
            disabled={browsing}
          >
            {browsing ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <FolderOpen className="size-4" />
            )}
            {browsing ? "选择中…" : "浏览文件夹…"}
          </Button>
        )}

        {/* Manual path input */}
        <div className="space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            {tauriAvailable ? "或手动输入路径" : "输入文件夹路径"}
          </span>
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
