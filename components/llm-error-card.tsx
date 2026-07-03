"use client"

import Link from "next/link"
import { AlertTriangle, RefreshCw, ArrowRightLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { ParsedLlmError } from "@/lib/llm-error"

export function LlmErrorCard({
  error,
  onRetry,
  retryDisabled,
}: {
  error: ParsedLlmError
  onRetry?: () => void
  retryDisabled?: boolean
}) {
  return (
    <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-foreground">{error.message}</p>
          <div className="flex flex-wrap gap-2">
            {error.retryable && onRetry && (
              <Button variant="outline" size="xs" onClick={onRetry} disabled={retryDisabled}>
                <RefreshCw className="size-3" />
                {error.retryAfterSec ? `重试 (${error.retryAfterSec}s)` : "重试"}
              </Button>
            )}
            {error.canSwitchModel && (
              <Button
                variant="ghost"
                size="xs"
                nativeButton={false}
                render={<Link href="/settings">切换模型</Link>}
              >
                <ArrowRightLeft className="size-3" />
                切换模型
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
