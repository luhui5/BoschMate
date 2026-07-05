"use client"

import { useCallback, useEffect, useState } from "react"
import { AssistantView } from "@/components/assistant/assistant-view"
import { KnowledgePanel } from "@/components/knowledge/knowledge-panel"
import { isTauri, listKnowledgeBases } from "@/lib/tauri-api"

export function AppShell() {
  const [knowledgeOpen, setKnowledgeOpen] = useState(false)
  const [documentCount, setDocumentCount] = useState(0)

  const refreshDocumentCount = useCallback(async () => {
    if (!isTauri()) {
      setDocumentCount(0)
      return
    }
    try {
      const bases = await listKnowledgeBases()
      setDocumentCount(bases.reduce((sum, b) => sum + b.documentCount, 0))
    } catch {
      setDocumentCount(0)
    }
  }, [])

  useEffect(() => {
    void refreshDocumentCount()
  }, [refreshDocumentCount])

  return (
    <>
      <AssistantView
        knowledgeCount={documentCount}
        onOpenKnowledge={() => setKnowledgeOpen(true)}
      />
      <KnowledgePanel
        open={knowledgeOpen}
        onClose={() => setKnowledgeOpen(false)}
        onDocumentCountChange={setDocumentCount}
      />
    </>
  )
}
