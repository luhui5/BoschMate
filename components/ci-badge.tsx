import { CheckCircle2, XCircle, Loader2, CircleDashed } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import type { CIStatus } from "@/lib/types"

export function CiBadge({ status }: { status: CIStatus }) {
  if (status === "none") {
    return (
      <Badge variant="outline">
        <CircleDashed className="size-3" />
        无 CI
      </Badge>
    )
  }
  if (status === "passing") {
    return (
      <Badge variant="success">
        <CheckCircle2 className="size-3" />
        通过
      </Badge>
    )
  }
  if (status === "failing") {
    return (
      <Badge variant="destructive">
        <XCircle className="size-3" />
        失败
      </Badge>
    )
  }
  return (
    <Badge variant="warning">
      <Loader2 className="size-3 animate-spin" />
      运行中
    </Badge>
  )
}
