"use client"

import { useEffect, useState } from "react"
import { Minus, Square, X } from "lucide-react"
import { useApp } from "@/components/app-provider"

export function TitleBar() {
  const { resolvedTheme } = useApp()
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    let unlisten: (() => void) | null = null
    import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) => {
        const win = getCurrentWindow()
        win.isMaximized().then(setIsMaximized)

        import("@tauri-apps/api/event").then(({ listen }) => {
          listen("tauri://resize", () => {
            win.isMaximized().then(setIsMaximized)
          }).then((fn) => { unlisten = fn })
        })
      })
      .catch(() => {})

    return () => { if (unlisten) unlisten() }
  }, [])

  const handleMinimize = async () => {
    const { getCurrentWindow } = await import("@tauri-apps/api/window")
    await getCurrentWindow().minimize()
  }

  const handleMaximize = async () => {
    const { getCurrentWindow } = await import("@tauri-apps/api/window")
    await getCurrentWindow().toggleMaximize()
    setIsMaximized(!isMaximized)
  }

  const handleClose = async () => {
    const { getCurrentWindow } = await import("@tauri-apps/api/window")
    await getCurrentWindow().close()
  }

  const bg = resolvedTheme === "dark" ? "bg-zinc-950" : "bg-white"
  const textColor = resolvedTheme === "dark" ? "text-zinc-300" : "text-zinc-700"
  const hoverBg = resolvedTheme === "dark" ? "hover:bg-zinc-800" : "hover:bg-zinc-100"
  const closeHover = "hover:bg-red-500 hover:text-white"

  return (
    <div className="fixed top-0 left-0 right-0 z-50 select-none">
      {/* Bosch gradient strip */}
      <div
        className="h-[2px] w-full"
        style={{
          background: "linear-gradient(to right, #8B0000, #DC143C, #800080, #00008B, #4169E1, #006400, #2E8B57)",
        }}
      />

      {/* Title bar */}
      <div
        data-tauri-drag-region
        className={`flex items-center h-8 ${bg} ${textColor} border-b border-border`}
      >
        {/* Left: Logo + Title */}
        <div className="flex items-center gap-2 pl-3">
          <span className="text-sm font-semibold tracking-wide">
            BoschCode
          </span>
        </div>

        {/* Center: drag region (flex spacer) */}
        <div className="flex-1" data-tauri-drag-region />

        {/* Right: Window controls */}
        <div className="flex items-center h-full">
          <button
            onClick={handleMinimize}
            className={`h-full w-10 flex items-center justify-center transition-colors ${hoverBg}`}
            aria-label="Minimize"
          >
            <Minus className="size-3.5" />
          </button>
          <button
            onClick={handleMaximize}
            className={`h-full w-10 flex items-center justify-center transition-colors ${hoverBg}`}
            aria-label={isMaximized ? "Restore" : "Maximize"}
          >
            <Square className="size-3" />
          </button>
          <button
            onClick={handleClose}
            className={`h-full w-10 flex items-center justify-center transition-colors ${closeHover}`}
            aria-label="Close"
          >
            <X className="size-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}
