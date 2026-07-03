"use client"

import { useEffect } from "react"
import Link from "next/link"
import { redirectLegacyProjectUrl } from "@/lib/project-route"

export default function NotFound() {
  useEffect(() => {
    redirectLegacyProjectUrl()
  }, [])

  return (
    <div className="flex min-h-[calc(100vh-34px)] flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
      <p>页面不存在</p>
      <Link href="/" className="text-primary underline-offset-4 hover:underline">
        返回主页
      </Link>
    </div>
  )
}
