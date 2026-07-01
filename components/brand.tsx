import { cn } from "@/lib/utils"
import { BoschLogo } from "@/components/bosch-logo"

export function Logo({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex size-7 items-center justify-center rounded-md bg-foreground text-background",
        className,
      )}
      aria-hidden
    >
      <BoschLogo className="size-4" />
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
