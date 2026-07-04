"use client"

import { useCallback, useState } from "react"
import { AssistantView } from "@/components/assistant/assistant-view"
import { KnowledgeDialog } from "@/components/knowledge/knowledge-dialog"
import { SEED_KNOWLEDGE, type KnowledgeFile } from "@/lib/knowledge"

export function AppShell() {
  const [knowledgeOpen, setKnowledgeOpen] = useState(false)
  const [knowledge, setKnowledge] = useState<KnowledgeFile[]>(SEED_KNOWLEDGE)

  const upsertKnowledge = useCallback((incoming: KnowledgeFile[]) => {
    setKnowledge((prev) => {
      const map = new Map(prev.map((f) => [f.id, f]))
      for (const f of incoming) map.set(f.id, f)
      return Array.from(map.values()).sort(
        (a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime(),
      )
    })
  }, [])

  const removeKnowledge = useCallback((id: string) => {
    setKnowledge((prev) => prev.filter((f) => f.id !== id))
  }, [])

  return (
    <>
      <AssistantView
        knowledgeCount={knowledge.length}
        onOpenKnowledge={() => setKnowledgeOpen(true)}
      />
      <KnowledgeDialog
        open={knowledgeOpen}
        onClose={() => setKnowledgeOpen(false)}
        files={knowledge}
        onAdd={upsertKnowledge}
        onRemove={removeKnowledge}
      />
    </>
  )
}
