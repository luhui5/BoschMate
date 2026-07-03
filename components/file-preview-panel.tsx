"use client"

import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { CodeEditor } from "@/components/code-editor"
import { readFile, isTauri } from "@/lib/tauri-api"

function langFromPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? ""
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    rs: "rust",
    py: "python",
    go: "go",
    json: "json",
    md: "markdown",
    css: "css",
    html: "html",
    yml: "yaml",
    yaml: "yaml",
    toml: "toml",
    sh: "shell",
  }
  return map[ext] ?? "plaintext"
}

export function FilePreviewPanel({
  projectId,
  path,
}: {
  projectId: string
  path: string
}) {
  const [content, setContent] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError(null)
      if (!isTauri()) {
        setContent("// 浏览器预览模式无法读取本地文件")
        setLoading(false)
        return
      }
      try {
        const text = await readFile(projectId, { path })
        if (!cancelled) setContent(text)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
          setContent("")
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [projectId, path])

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 border-b border-border py-8 text-xs text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        加载 {path}…
      </div>
    )
  }

  if (error) {
    return (
      <div className="border-b border-border px-4 py-4 text-xs text-destructive">
        无法读取文件：{error}
      </div>
    )
  }

  return (
    <div className="border-b border-border">
      <CodeEditor value={content} language={langFromPath(path)} readOnly height="240px" />
    </div>
  )
}
