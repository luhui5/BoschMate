export type UpdateChannel = "stable" | "beta"

export type UpdatePhase =
  | "idle" // 无更新 / 未检查
  | "checking" // 正在检查
  | "up-to-date" // 已是最新
  | "available" // 发现新版本（发现弹窗）
  | "confirm" // 确认弹窗（下载前）
  | "downloading" // 下载中
  | "downloaded" // 下载完成
  | "failed" // 更新失败

export interface ReleaseInfo {
  latestVersion: string
  sizeBytes: number
  changelog: string[]
  changelogUrl: string
  minPreviousVersion: string
}

export const CURRENT_VERSION = "0.3.1"

/** true if `latest` is a strictly newer dotted version than `current`. */
export function isNewerVersion(latest: string, current: string): boolean {
  const a = latest.split(".").map((n) => parseInt(n, 10) || 0)
  const b = current.split(".").map((n) => parseInt(n, 10) || 0)
  const len = Math.max(a.length, b.length)
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    if (x !== y) return x > y
  }
  return false
}

/** Map backend UpdateInfo to ReleaseInfo; null when already up to date. */
export function releaseFromUpdateInfo(info: {
  currentVersion: string
  latestVersion?: string
  downloadUrl?: string
  sizeBytes?: number
  changelog?: string
}): ReleaseInfo | null {
  if (!info.latestVersion || !isNewerVersion(info.latestVersion, info.currentVersion)) return null
  const changelog = (info.changelog ?? "")
    .split("\n")
    .map((line) => line.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 8)
  return {
    latestVersion: info.latestVersion,
    sizeBytes: info.sizeBytes ?? 0,
    changelog: changelog.length ? changelog : ["查看发布页了解更新内容"],
    changelogUrl: info.downloadUrl ?? "",
    minPreviousVersion: "",
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
