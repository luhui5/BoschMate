"use client"

import { useState } from "react"
import { ChevronRight, Folder, FolderOpen, File, Search } from "lucide-react"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import type { FileNode } from "@/lib/types"

const changeColor: Record<string, string> = {
  modified: "text-warning",
  added: "text-success",
  deleted: "text-destructive",
}

const changeMark: Record<string, string> = {
  modified: "M",
  added: "A",
  deleted: "D",
}

function TreeNode({
  node,
  depth,
  activePath,
  onOpen,
}: {
  node: FileNode
  depth: number
  activePath: string | null
  onOpen: (path: string) => void
}) {
  const [open, setOpen] = useState(depth < 2)

  if (node.type === "dir") {
    return (
      <div>
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center gap-1 rounded px-1.5 py-1 text-sm hover:bg-accent"
          style={{ paddingLeft: depth * 12 + 6 }}
        >
          <ChevronRight className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
          {open ? (
            <FolderOpen className="size-3.5 shrink-0 text-primary" />
          ) : (
            <Folder className="size-3.5 shrink-0 text-primary" />
          )}
          <span className="truncate">{node.name}</span>
        </button>
        {open &&
          node.children?.map((child) => (
            <TreeNode key={child.path} node={child} depth={depth + 1} activePath={activePath} onOpen={onOpen} />
          ))}
      </div>
    )
  }

  return (
    <button
      onClick={() => onOpen(node.path)}
      className={cn(
        "flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-sm hover:bg-accent",
        activePath === node.path && "bg-accent",
      )}
      style={{ paddingLeft: depth * 12 + 22 }}
    >
      <File className="size-3.5 shrink-0 text-muted-foreground" />
      <span className={cn("truncate", node.changed && changeColor[node.changed])}>{node.name}</span>
      {node.changed && (
        <span className={cn("ml-auto font-mono text-xs", changeColor[node.changed])}>
          {changeMark[node.changed]}
        </span>
      )}
    </button>
  )
}

export function FileTree({
  nodes,
  activePath,
  onOpen,
}: {
  nodes: FileNode[]
  activePath: string | null
  onOpen: (path: string) => void
}) {
  const [filter, setFilter] = useState("")

  return (
    <div className="flex h-full flex-col">
      <div className="relative border-b border-border p-2">
        <Search className="pointer-events-none absolute left-4 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="按名称过滤文件…"
          className="h-7 pl-7 text-xs"
        />
      </div>
      <div className="flex-1 overflow-auto p-1 scrollbar-thin">
        {nodes.map((n) => (
          <TreeNode key={n.path} node={n} depth={0} activePath={activePath} onOpen={onOpen} />
        ))}
      </div>
      <div className="border-t border-border px-3 py-1.5 text-[10px] text-muted-foreground">
        已排除 node_modules · .git · target
      </div>
    </div>
  )
}
