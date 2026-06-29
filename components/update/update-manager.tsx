"use client"

import { useState } from "react"
import {
  Sparkles,
  Download,
  CheckCircle2,
  XCircle,
  TriangleAlert,
  ExternalLink,
  ChevronUp,
} from "lucide-react"
import { Modal } from "@/components/ui/modal"
import { Button } from "@/components/ui/button"
import { useApp } from "@/components/app-provider"
import { CURRENT_VERSION, formatBytes } from "@/lib/update"
import { cn } from "@/lib/utils"

/**
 * 全局更新管理器：渲染发现/确认/完成/失败弹窗 + 状态栏下载指示器 + 右下角通知。
 * 由 AppProvider 的更新状态机驱动，挂载在所有页面之上。
 */
export function UpdateManager() {
  const {
    t,
    update,
    startUpdate,
    confirmDownload,
    remindLater,
    skipVersion,
    installNow,
    dismissUpdate,
  } = useApp()
  const { phase, release, progress, downloadedBytes, speedBytesPerSec } = update
  const [downloadPanelOpen, setDownloadPanelOpen] = useState(true)

  if (!release) return null

  const etaSec =
    speedBytesPerSec > 0
      ? Math.max(1, Math.round((release.sizeBytes - downloadedBytes) / speedBytesPerSec))
      : 0

  return (
    <>
      {/* 发现新版本弹窗 */}
      <Modal
        open={phase === "available"}
        onClose={remindLater}
        title={t("update.found.title")}
      >
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3 rounded-lg bg-primary/10 p-3">
            <span className="flex size-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Sparkles className="size-4.5" />
            </span>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">{t("update.currentVersion")}</span>
              <span className="font-mono font-medium">v{CURRENT_VERSION}</span>
              <span className="text-muted-foreground">→</span>
              <span className="font-mono font-semibold text-primary">v{release.latestVersion}</span>
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t("update.changelog")}
            </p>
            <ul className="flex flex-col gap-1.5">
              {release.changelog.map((c) => (
                <li key={c} className="flex items-start gap-2 text-sm">
                  <span className="mt-1.5 size-1 shrink-0 rounded-full bg-primary" />
                  {c}
                </li>
              ))}
            </ul>
            <a
              href={release.changelogUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              {t("update.viewFullChangelog")}
              <ExternalLink className="size-3" />
            </a>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
            <Button variant="ghost" size="sm" onClick={remindLater}>
              {t("update.later")}
            </Button>
            <Button variant="ghost" size="sm" onClick={skipVersion}>
              {t("update.skip")}
            </Button>
            <Button size="sm" onClick={startUpdate}>
              {t("update.now")}
            </Button>
          </div>
        </div>
      </Modal>

      {/* 确认弹窗（下载前） */}
      <Modal open={phase === "confirm"} onClose={remindLater} title={t("update.confirm.title")}>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t("update.latestVersion")}</span>
              <span className="font-mono font-medium">v{release.latestVersion}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t("update.downloadSize")}</span>
              <span className="font-mono font-medium">~{formatBytes(release.sizeBytes)}</span>
            </div>
          </div>
          <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs text-warning-foreground">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
            <span>{t("update.confirm.warn")}</span>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={remindLater}>
              {t("common.cancel")}
            </Button>
            <Button size="sm" onClick={confirmDownload}>
              <Download />
              {t("update.confirm.action")}
            </Button>
          </div>
        </div>
      </Modal>

      {/* 下载完成弹窗 */}
      <Modal open={phase === "downloaded"} onClose={dismissUpdate} title={t("update.done.title")}>
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3 rounded-lg bg-success/10 p-3">
            <CheckCircle2 className="size-5 text-success" />
            <p className="text-sm">
              <span className="font-mono font-medium">v{release.latestVersion}</span>{" "}
              {t("update.done.desc")}
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={dismissUpdate}>
              {t("update.installLater")}
            </Button>
            <Button size="sm" onClick={installNow}>
              {t("update.restartInstall")}
            </Button>
          </div>
        </div>
      </Modal>

      {/* 更新失败弹窗 */}
      <Modal open={phase === "failed"} onClose={dismissUpdate} title={t("update.failed.title")}>
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3 rounded-lg bg-destructive/10 p-3">
            <XCircle className="size-5 text-destructive" />
            <div className="text-sm">
              <p>{update.error ?? "签名校验失败"}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t("update.failed.rolledBack")} v{CURRENT_VERSION}
              </p>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={dismissUpdate}>
              {t("update.feedback")}
            </Button>
            <Button size="sm" onClick={startUpdate}>
              {t("common.retry")}
            </Button>
          </div>
        </div>
      </Modal>

      {/* 下载中：右下角状态指示器（可展开/收起） */}
      {phase === "downloading" && (
        <div className="fixed bottom-4 right-4 z-50 w-80">
          {downloadPanelOpen ? (
            <div className="rounded-xl border border-border bg-popover p-4 shadow-2xl">
              <div className="mb-2 flex items-center gap-2">
                <Download className="size-4 animate-pulse text-primary" />
                <span className="text-sm font-medium">{t("update.downloading")}</span>
                <span className="ml-auto font-mono text-sm font-semibold text-primary">
                  {Math.round(progress)}%
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                <span className="font-mono">
                  {formatBytes(downloadedBytes)} / {formatBytes(release.sizeBytes)}
                </span>
                <span className="font-mono">
                  {formatBytes(speedBytesPerSec)}/s · {t("update.eta")} ~{etaSec}s
                </span>
              </div>
              <Button
                variant="ghost"
                size="xs"
                className="mt-2 w-full"
                onClick={() => setDownloadPanelOpen(false)}
              >
                {t("update.background")}
              </Button>
            </div>
          ) : (
            // 迷你进度条（状态栏样式）
            <button
              onClick={() => setDownloadPanelOpen(true)}
              className="flex w-full items-center gap-2 rounded-lg border border-border bg-popover px-3 py-2 shadow-xl transition-colors hover:bg-accent"
            >
              <Download className="size-3.5 shrink-0 animate-pulse text-primary" />
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <span className="font-mono text-xs font-medium">{Math.round(progress)}%</span>
              <ChevronUp className="size-3.5 text-muted-foreground" />
            </button>
          )}
        </div>
      )}

      {/* 右下角非模态通知：发现更新但用户尚未交互时（仅在 available 阶段已由弹窗覆盖，这里用于下载完成后的最小化提示） */}
    </>
  )
}

/** 用于状态栏内联的迷你更新入口（设置页/工作区可复用）。 */
export function UpdateStatusChip({ className }: { className?: string }) {
  const { t, update, startUpdate, checkForUpdates } = useApp()
  const hasUpdate = update.phase === "available" || update.phase === "confirm"

  if (!hasUpdate) {
    return (
      <button
        onClick={checkForUpdates}
        className={cn(
          "flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground",
          className,
        )}
      >
        <Sparkles className="size-3.5" />
        {update.phase === "checking" ? t("update.checking") : t("update.checkBtn")}
      </button>
    )
  }

  return (
    <button
      onClick={startUpdate}
      className={cn(
        "flex items-center gap-1.5 rounded-full bg-primary/15 px-2.5 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/25",
        className,
      )}
    >
      <Sparkles className="size-3.5" />
      {t("update.toast.title")}
    </button>
  )
}
