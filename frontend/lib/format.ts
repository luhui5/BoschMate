export function timeAgo(iso: string): string {
  const now = new Date("2026-06-27T11:00:00Z").getTime()
  const then = new Date(iso).getTime()
  const diff = Math.max(0, now - then)
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "刚刚"
  if (mins < 60) return `${mins} 分钟前`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} 天前`
  const months = Math.floor(days / 30)
  return `${months} 个月前`
}

export const langColor: Record<string, string> = {
  Rust: "oklch(0.65 0.18 40)",
  TypeScript: "oklch(0.6 0.13 250)",
  Python: "oklch(0.7 0.13 240)",
  Go: "oklch(0.7 0.12 200)",
  JavaScript: "oklch(0.8 0.16 95)",
}
