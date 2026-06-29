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

export const MOCK_RELEASE: ReleaseInfo = {
  latestVersion: "0.4.0",
  sizeBytes: 18874368, // ~18MB
  changelog: [
    "新增 Ask before edits 完整流程",
    "修复大仓库文件树卡顿问题",
    "优化 FAISS 索引重建性能",
    "新增多语言界面（English / 简体中文）",
  ],
  changelogUrl: "https://github.com/boschcode/boschcode/releases",
  minPreviousVersion: "0.2.0",
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
