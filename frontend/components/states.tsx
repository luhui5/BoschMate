"use client"

import type { ReactNode } from "react"
import type { LucideIcon } from "lucide-react"
import { AlertTriangle, RefreshCw } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

/** 骨架块 */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-muted", className)} />
}

/** 项目卡片骨架屏 */
export function ProjectCardSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-3">
        <Skeleton className="size-9 rounded-md" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-3.5 w-2/3" />
          <Skeleton className="h-2.5 w-1/3" />
        </div>
      </div>
      <Skeleton className="mt-4 h-2.5 w-full" />
      <Skeleton className="mt-2 h-2.5 w-4/5" />
      <div className="mt-4 flex gap-2">
        <Skeleton className="h-5 w-16 rounded-full" />
        <Skeleton className="h-5 w-12 rounded-full" />
      </div>
    </div>
  )
}

/** 列表行骨架屏 */
export function RowSkeleton() {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <Skeleton className="size-7 rounded-md" />
      <Skeleton className="h-3 w-40" />
      <Skeleton className="ml-auto h-3 w-16" />
    </div>
  )
}

/** 空状态 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon
  title: string
  description?: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border py-16 text-center",
        className,
      )}
    >
      <span className="flex size-12 items-center justify-center rounded-full bg-secondary text-muted-foreground">
        <Icon className="size-6" />
      </span>
      <div className="max-w-sm">
        <p className="text-sm font-medium text-balance">{title}</p>
        {description && (
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground text-pretty">
            {description}
          </p>
        )}
      </div>
      {action}
    </div>
  )
}

/** 错误状态 */
export function ErrorState({
  title,
  description,
  onRetry,
  retryLabel = "重试",
  className,
}: {
  title: string
  description?: string
  onRetry?: () => void
  retryLabel?: string
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-4 rounded-xl border border-destructive/30 bg-destructive/5 py-16 text-center",
        className,
      )}
    >
      <span className="flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertTriangle className="size-6" />
      </span>
      <div className="max-w-sm">
        <p className="text-sm font-medium text-balance">{title}</p>
        {description && (
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground text-pretty">
            {description}
          </p>
        )}
      </div>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          <RefreshCw />
          {retryLabel}
        </Button>
      )}
    </div>
  )
}
