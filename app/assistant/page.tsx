import { Suspense } from "react"
import { AppShell } from "@/components/shell/app-shell"

export default function AssistantPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[calc(100vh-34px)] items-center justify-center text-sm text-muted-foreground">
          加载…
        </div>
      }
    >
      <AppShell />
    </Suspense>
  )
}
