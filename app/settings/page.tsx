"use client"

import { Component, type ReactNode } from "react"
import Link from "next/link"
import { AlertTriangle, RefreshCw } from "lucide-react"
import { SettingsView } from "@/components/settings/settings-view"

class SettingsErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props)
    this.state = { hasError: false, error: null }
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error }
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-[calc(100dvh-34px)] flex-col items-center justify-center gap-4 px-4 text-center">
          <AlertTriangle className="size-10 text-amber-500" />
          <p className="text-sm font-medium text-foreground">设置页面加载失败</p>
          <p className="max-w-md text-xs text-muted-foreground">
            {this.state.error?.message ?? "未知错误"}
          </p>
          <div className="flex gap-3">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            >
              返回主页
            </Link>
            <button
              type="button"
              onClick={() => this.setState({ hasError: false, error: null })}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent"
            >
              <RefreshCw className="size-3.5" />
              重试
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

export default function SettingsPage() {
  return (
    <SettingsErrorBoundary>
      <SettingsView />
    </SettingsErrorBoundary>
  )
}
