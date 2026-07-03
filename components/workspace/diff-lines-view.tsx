"use client"

import { useMemo, useRef, useState } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { cn } from "@/lib/utils"
import type { DiffLine } from "@/lib/types"
import { buildDisplayRows, expandCollapsedRows, type DisplayDiffRow } from "@/lib/workspace-utils"

export function DiffLinesView({ lines }: { lines: DiffLine[] }) {
  const parentRef = useRef<HTMLDivElement>(null)
  const [rows, setRows] = useState<DisplayDiffRow[]>(() => buildDisplayRows(lines))

  const displayRows = useMemo(() => rows, [rows])

  const virtualizer = useVirtualizer({
    count: displayRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 22,
    overscan: 30,
  })

  return (
    <div ref={parentRef} className="max-h-72 overflow-auto scrollbar-thin">
      <table className="w-full border-collapse font-mono text-xs">
        <tbody
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            position: "relative",
            display: "block",
          }}
        >
          {virtualizer.getVirtualItems().map((item) => {
            const row = displayRows[item.index]
            return (
              <tr
                key={item.key}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: `${item.size}px`,
                  transform: `translateY(${item.start}px)`,
                  display: "table",
                  tableLayout: "fixed",
                }}
              >
                {row.kind === "collapsed" ? (
                  <td colSpan={4} className="bg-secondary/40 px-2 py-1 text-center text-muted-foreground">
                    <button
                      type="button"
                      className="hover:text-foreground"
                      onClick={() =>
                        setRows((prev) => expandCollapsedRows(lines, prev, row.startIndex))
                      }
                    >
                      ··· {row.count} 行上下文 ···
                    </button>
                  </td>
                ) : (
                  <>
                    <td className="w-10 select-none border-r border-border px-2 text-right text-muted-foreground/60">
                      {row.line.oldNo ?? ""}
                    </td>
                    <td className="w-10 select-none border-r border-border px-2 text-right text-muted-foreground/60">
                      {row.line.newNo ?? ""}
                    </td>
                    <td
                      className={cn(
                        "w-4 select-none px-1 text-center",
                        row.line.type === "add" && "text-diff-add-foreground",
                        row.line.type === "del" && "text-diff-del-foreground",
                      )}
                    >
                      {row.line.type === "add" ? "+" : row.line.type === "del" ? "-" : ""}
                    </td>
                    <td
                      className={cn(
                        "whitespace-pre px-2 py-0.5",
                        row.line.type === "add" && "bg-diff-add/40 text-diff-add-foreground",
                        row.line.type === "del" && "bg-diff-del/40 text-diff-del-foreground",
                        row.line.type === "meta" && "bg-secondary/50 text-muted-foreground",
                      )}
                    >
                      {row.line.text || " "}
                    </td>
                  </>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
