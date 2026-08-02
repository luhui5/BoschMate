"use client"

import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

export function SectionHeader({ title, desc }: { title: string; desc?: string }) {
  return (
    <div className="mb-6">
      <h1 className="text-xl font-bold tracking-tight">{title}</h1>
      {desc && <p className="mt-1 text-sm text-muted-foreground">{desc}</p>}
    </div>
  )
}

export function SettingsCard({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn("rounded-xl border border-border bg-card", className)}>{children}</div>
  )
}

export function SettingRow({
  title,
  desc,
  children,
  className,
}: {
  title: string
  desc?: string
  children?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4 border-b border-border px-4 py-3.5 last:border-b-0",
        className,
      )}
    >
      <div className="min-w-0">
        <p className="text-sm font-medium">{title}</p>
        {desc && <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{desc}</p>}
      </div>
      {children && <div className="shrink-0">{children}</div>}
    </div>
  )
}

export function Select({
  value,
  onChange,
  options,
  className,
}: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  className?: string
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "h-8 rounded-md border border-border bg-background px-2.5 text-sm text-foreground outline-none transition-colors hover:border-ring focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40",
        className,
      )}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}
