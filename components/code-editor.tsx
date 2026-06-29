"use client"

import { useApp } from "@/components/app-provider"
import { cn } from "@/lib/utils"
import Editor, { type OnMount } from "@monaco-editor/react"
import { useRef, useState } from "react"

interface CodeEditorProps {
  value: string
  language?: string
  readOnly?: boolean
  onChange?: (value: string) => void
  className?: string
  height?: string
  showLineNumbers?: boolean
}

export function CodeEditor({
  value,
  language = "typescript",
  readOnly = false,
  onChange,
  className,
  height = "300px",
  showLineNumbers = true,
}: CodeEditorProps) {
  const { resolvedTheme, editorFont } = useApp()
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null)
  const [mounted, setMounted] = useState(false)

  const handleMount: OnMount = (editor) => {
    editorRef.current = editor
    setMounted(true)
  }

  const fontFamily =
    editorFont === "jetbrains"
      ? "'JetBrains Mono', monospace"
      : editorFont === "fira"
        ? "'Fira Code', monospace"
        : editorFont === "sf-mono"
          ? "'SF Mono', monospace"
          : "'Geist Mono', monospace"

  return (
    <div className={cn("rounded-lg border overflow-hidden", className)}>
      <Editor
        height={height}
        language={language}
        value={value}
        theme={resolvedTheme === "dark" ? "vs-dark" : "vs"}
        onChange={(v) => onChange?.(v ?? "")}
        onMount={handleMount}
        options={{
          readOnly,
          minimap: { enabled: false },
          lineNumbers: showLineNumbers ? "on" : "off",
          fontSize: 14,
          fontFamily,
          scrollBeyondLastLine: false,
          wordWrap: "on",
          padding: { top: 12, bottom: 12 },
          renderLineHighlight: "line",
          cursorBlinking: "smooth",
          smoothScrolling: true,
          bracketPairColorization: { enabled: true },
          automaticLayout: true,
        }}
        loading={
          <div className="flex items-center justify-center h-full text-muted-foreground">
            Loading editor...
          </div>
        }
      />
    </div>
  )
}

/** Side-by-side diff viewer using Monaco */
export function MonacoDiffViewer({
  original,
  modified,
  language = "typescript",
  className,
  height = "400px",
}: {
  original: string
  modified: string
  language?: string
  className?: string
  height?: string
}) {
  const { resolvedTheme } = useApp()
  // Monaco diff editor is available via the DiffEditor component
  const { default: DiffEditor } = require("@monaco-editor/react")

  return (
    <div className={cn("rounded-lg border overflow-hidden", className)}>
      <DiffEditor
        height={height}
        language={language}
        original={original}
        modified={modified}
        theme={resolvedTheme === "dark" ? "vs-dark" : "vs"}
        options={{
          minimap: { enabled: false },
          fontSize: 13,
          scrollBeyondLastLine: false,
          wordWrap: "on",
          renderSideBySide: true,
          readOnly: true,
          automaticLayout: true,
        }}
        loading={
          <div className="flex items-center justify-center h-full text-muted-foreground">
            Loading diff...
          </div>
        }
      />
    </div>
  )
}
