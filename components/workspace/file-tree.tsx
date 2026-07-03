"use client"

import { useCallback, useMemo, useRef, useState } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { ChevronRight, Folder, FolderOpen, File, Search, Loader2 } from "lucide-react"
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

interface FlatRow {
  node: FileNode
  depth: number
}

function flattenVisible(nodes: FileNode[], openDirs: Set<string>, depth = 0): FlatRow[] {
  const rows: FlatRow[] = []
  for (const node of nodes) {
    rows.push({ node, depth })
    if (node.type === "dir" && openDirs.has(node.path) && node.children) {
      rows.push(...flattenVisible(node.children, openDirs, depth + 1))
    }
  }
  return rows
}

function mergeChildren(nodes: FileNode[], dirPath: string, children: FileNode[]): FileNode[] {
  return nodes.map((n) => {
    if (n.path === dirPath && n.type === "dir") {
      return { ...n, children }
    }
    if (n.children) {
      return { ...n, children: mergeChildren(n.children, dirPath, children) }
    }
    return n
  })
}

export function FileTree({
  nodes,
  activePath,
  onOpen,
  onLoadChildren,
  onNodesChange,
  onCopyPath,
  onRevealInExplorer,
}: {
  nodes: FileNode[]
  activePath: string | null
  onOpen: (path: string) => void
  onLoadChildren?: (dirPath: string) => Promise<FileNode[]>
  onNodesChange?: (nodes: FileNode[]) => void
  onCopyPath?: (path: string) => void
  onRevealInExplorer?: (path: string) => void
}) {
  const [filter, setFilter] = useState("")
  const [openDirs, setOpenDirs] = useState<Set<string>>(() => new Set())
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(() => new Set())
  const [menu, setMenu] = useState<{ path: string; x: number; y: number } | null>(null)
  const parentRef = useRef<HTMLDivElement>(null)

  const filteredNodes = useMemo(() => {
    if (!filter.trim()) return nodes
    const q = filter.toLowerCase()
    const match = (n: FileNode): FileNode | null => {
      if (n.name.toLowerCase().includes(q)) return n
      if (n.children) {
        const kids = n.children.map(match).filter(Boolean) as FileNode[]
        if (kids.length) return { ...n, children: kids }
      }
      return null
    }
    return nodes.map(match).filter(Boolean) as FileNode[]
  }, [nodes, filter])

  const rows = useMemo(
    () => flattenVisible(filteredNodes, openDirs),
    [filteredNodes, openDirs],
  )

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 28,
    overscan: 20,
  })

  const toggleDir = useCallback(
    async (node: FileNode) => {
      const isOpen = openDirs.has(node.path)
      if (isOpen) {
        setOpenDirs((prev) => {
          const next = new Set(prev)
          next.delete(node.path)
          return next
        })
        return
      }

      if (node.children === undefined && onLoadChildren && onNodesChange) {
        setLoadingDirs((prev) => new Set(prev).add(node.path))
        try {
          const children = await onLoadChildren(node.path)
          onNodesChange(mergeChildren(nodes, node.path, children))
        } finally {
          setLoadingDirs((prev) => {
            const next = new Set(prev)
            next.delete(node.path)
            return next
          })
        }
      }

      setOpenDirs((prev) => new Set(prev).add(node.path))
    },
    [openDirs, onLoadChildren, onNodesChange, nodes],
  )

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
      <div ref={parentRef} className="flex-1 overflow-auto p-1 scrollbar-thin">
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            width: "100%",
            position: "relative",
          }}
        >
          {virtualizer.getVirtualItems().map((item) => {
            const { node, depth } = rows[item.index]
            const isDir = node.type === "dir"
            const isOpen = openDirs.has(node.path)
            const isLoading = loadingDirs.has(node.path)

            return (
              <div
                key={node.path}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: `${item.size}px`,
                  transform: `translateY(${item.start}px)`,
                }}
              >
                {isDir ? (
                  <button
                    onClick={() => void toggleDir(node)}
                    className="flex w-full items-center gap-1 rounded px-1.5 py-1 text-sm hover:bg-accent"
                    style={{ paddingLeft: depth * 12 + 6 }}
                  >
                    {isLoading ? (
                      <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
                    ) : (
                      <ChevronRight
                        className={cn(
                          "size-3.5 shrink-0 text-muted-foreground transition-transform",
                          isOpen && "rotate-90",
                        )}
                      />
                    )}
                    {isOpen ? (
                      <FolderOpen className="size-3.5 shrink-0 text-primary" />
                    ) : (
                      <Folder className="size-3.5 shrink-0 text-primary" />
                    )}
                    <span className="truncate">{node.name}</span>
                  </button>
                ) : (
                  <button
                    onClick={() => onOpen(node.path)}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setMenu({ path: node.path, x: e.clientX, y: e.clientY })
                    }}
                    className={cn(
                      "flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-sm hover:bg-accent",
                      activePath === node.path && "bg-accent",
                    )}
                    style={{ paddingLeft: depth * 12 + 22 }}
                  >
                    <File className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className={cn("truncate", node.changed && changeColor[node.changed])}>
                      {node.name}
                    </span>
                    {node.changed && (
                      <span className={cn("ml-auto font-mono text-xs", changeColor[node.changed])}>
                        {changeMark[node.changed]}
                      </span>
                    )}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>
      <div className="border-t border-border px-3 py-1.5 text-[10px] text-muted-foreground">
        虚拟滚动 · 右键文件打开菜单
      </div>

      {menu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenu(null)} aria-hidden />
          <div
            className="fixed z-50 min-w-[160px] rounded-md border border-border bg-popover py-1 shadow-lg"
            style={{ left: menu.x, top: menu.y }}
          >
            <button type="button" className="block w-full px-3 py-1.5 text-left text-xs hover:bg-accent" onClick={() => { onOpen(menu.path); setMenu(null) }}>
              打开
            </button>
            <button type="button" className="block w-full px-3 py-1.5 text-left text-xs hover:bg-accent" onClick={() => { void navigator.clipboard.writeText(menu.path); onCopyPath?.(menu.path); setMenu(null) }}>
              复制路径
            </button>
            <button type="button" className="block w-full px-3 py-1.5 text-left text-xs hover:bg-accent" onClick={() => { onRevealInExplorer?.(menu.path); setMenu(null) }}>
              在资源管理器中显示
            </button>
          </div>
        </>
      )}
    </div>
  )
}
