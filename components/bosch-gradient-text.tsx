import { cn } from "@/lib/utils"
import { BOSCH_GRADIENT_LOOP } from "@/lib/bosch-brand"

export function BoschGradientText({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return (
    <span
      className={cn("bosch-gradient-text", className)}
      style={{ backgroundImage: BOSCH_GRADIENT_LOOP }}
    >
      {children}
    </span>
  )
}
