import { cn } from "@/lib/utils"

export function Logo({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground font-mono text-sm font-bold",
        className,
      )}
      aria-hidden
    >
      {"</>"}
    </span>
  )
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2", className)}>
      <Logo />
      <span className="text-sm font-semibold tracking-tight">
        Bosch<span className="text-primary">Code</span>
      </span>
    </span>
  )
}
