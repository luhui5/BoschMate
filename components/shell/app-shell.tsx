"use client"

import { useCallback, useState } from "react"
import { SideRail } from "./side-rail"
import { AssistantView } from "@/components/assistant/assistant-view"
import { HomeView } from "@/components/home/home-view"
import { KnowledgeDialog } from "@/components/knowledge/knowledge-dialog"
import { SEED_KNOWLEDGE, type KnowledgeFile } from "@/lib/knowledge"

export type ShellView = "assistant" | "coding"

export function AppShell({ initialView = "assistant" }: { initialView?: ShellView }) {
  const [view, setView] = useState<ShellView>(initialView)
  const [knowledgeOpen, setKnowledgeOpen] = useState(false)
  const [knowledge, setKnowledge] = useState<KnowledgeFile[]>(SEED_KNOWLEDGE)

  // Upsert by id so the async indexing → ready transition updates in place.
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
    <div className="flex min-h-[calc(100vh-34px)]">
      <SideRail
        active={view}
        onSelect={setView}
        onOpenKnowledge={() => setKnowledgeOpen(true)}
        knowledgeCount={knowledge.length}
      />
      <main className="min-w-0 flex-1">
        {view === "assistant" ? (
          <AssistantView knowledgeCount={knowledge.length} onOpenKnowledge={() => setKnowledgeOpen(true)} />
        ) : (
          <HomeView />
        )}
      </main>
      <KnowledgeDialog
        open={knowledgeOpen}
        onClose={() => setKnowledgeOpen(false)}
        files={knowledge}
        onAdd={upsertKnowledge}
        onRemove={removeKnowledge}
      />
    </div>
  )
}
