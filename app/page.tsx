import { Suspense } from "react"
import { HomeRouter } from "@/components/home-router"

export default function Page() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[calc(100vh-34px)] items-center justify-center text-sm text-muted-foreground">
          加载…
        </div>
      }
    >
      <HomeRouter />
    </Suspense>
  )
}
