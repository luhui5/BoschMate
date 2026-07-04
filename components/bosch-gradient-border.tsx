import { cn } from "@/lib/utils"
import { BOSCH_CONIC_GRADIENT, BOSCH_GRADIENT } from "@/lib/bosch-brand"

export function BoschGradientBorder({
  className,
  innerClassName,
  focusable,
  spinOnInteract,
  spinActive,
  children,
}: {
  className?: string
  innerClassName?: string
  focusable?: boolean
  spinOnInteract?: boolean
  spinActive?: boolean
  children: React.ReactNode
}) {
  if (spinOnInteract || spinActive) {
    return (
      <div
        className={cn(
          "group relative p-px transition-shadow",
          spinActive && "bosch-border-spin-group-active",
          focusable && "focus-within:shadow-sm",
          className,
        )}
      >
        <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]">
          <div
            className={cn(
              "absolute inset-0 transition-opacity",
              spinActive
                ? "opacity-0"
                : "group-hover:opacity-0 group-focus-within:opacity-0",
            )}
            style={{ background: BOSCH_GRADIENT }}
          />
          <div
            className={cn(
              "bosch-border-spin-layer absolute left-1/2 top-1/2 size-[200%] -translate-x-1/2 -translate-y-1/2 transition-opacity",
              spinActive
                ? "opacity-100"
                : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
            )}
            style={{ background: BOSCH_CONIC_GRADIENT }}
          />
        </div>
        <div className={cn("relative z-10 h-full w-full bg-card", innerClassName)}>
          {children}
        </div>
      </div>
    )
  }

  return (
    <div
      className={cn(
        "p-px transition-shadow",
        focusable && "focus-within:shadow-sm",
        className,
      )}
      style={{ background: BOSCH_GRADIENT }}
    >
      <div className={cn("h-full w-full bg-card", innerClassName)}>{children}</div>
    </div>
  )
}
