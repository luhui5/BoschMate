"use client"

import { useState } from "react"
import { Modal } from "@/components/ui/modal"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

interface CreateKnowledgeBaseDialogProps {
  open: boolean
  onClose: () => void
  onCreate: (name: string, description?: string) => Promise<void>
}

export function CreateKnowledgeBaseDialog({
  open,
  onClose,
  onCreate,
}: CreateKnowledgeBaseDialogProps) {
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    const trimmed = name.trim()
    if (!trimmed || saving) return
    setSaving(true)
    try {
      await onCreate(trimmed, description.trim() || undefined)
      setName("")
      setDescription("")
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="新建知识库"
      description="为相关文档创建一个集合，助手将从中检索内容。"
      className="max-w-md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button onClick={() => void submit()} disabled={!name.trim() || saving}>
            {saving ? "创建中…" : "创建"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">名称</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：产品文档库"
            autoFocus
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">描述（可选）</label>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="简要说明该知识库用途"
          />
        </div>
      </div>
    </Modal>
  )
}
