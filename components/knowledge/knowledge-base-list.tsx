"use client"

import { Plus, Trash2, BookUp } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { KnowledgeBase } from "@/lib/knowledge"

interface KnowledgeBaseListProps {
  bases: KnowledgeBase[]
  selectedId: string | null
  onSelect: (id: string) => void
  onCreate: () => void
  onDelete: (id: string) => void
}

export function KnowledgeBaseList({
  bases,
  selectedId,
  onSelect,
  onCreate,
  onDelete,
}: KnowledgeBaseListProps) {
  return (
    <div className="flex h-full flex-col border-r border-border">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          知识库
        </span>
        <Button variant="ghost" size="icon-sm" onClick={onCreate} aria-label="新建知识库">
          <Plus className="size-4" />
        </Button>
      </div>

      {bases.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
          <BookUp className="size-8 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">还没有知识库</p>
          <Button size="sm" onClick={onCreate}>
            创建第一个
          </Button>
        </div>
      ) : (
        <ul className="flex-1 space-y-0.5 overflow-y-auto p-2">
          {bases.map((base) => {
            const selected = base.id === selectedId
            return (
              <li key={base.id}>
                <div
                  className={cn(
                    "group flex items-start gap-2 rounded-lg px-2 py-2 transition-colors",
                    selected ? "bg-accent" : "hover:bg-accent/50",
                  )}
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => onSelect(base.id)}
                  >
                    <p className="truncate text-sm font-medium">{base.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {base.documentCount} 文档 · {base.chunkCount} 块
                    </p>
                  </button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="opacity-0 group-hover:opacity-100"
                    onClick={() => onDelete(base.id)}
                    aria-label={`删除 ${base.name}`}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
