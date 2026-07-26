"use client"

import { Sparkles, RefreshCw, CheckCircle2, ExternalLink, History, RotateCcw } from "lucide-react"
import { cn } from "@/lib/utils"
import { useApp } from "@/components/app-provider"
import { CURRENT_VERSION } from "@/lib/update"
import { SectionHeader, SettingsCard, SettingRow } from "./primitives"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { useSetting } from "@/lib/use-setting"

export function AboutSection() {
  const { t, update, setChannel, checkForUpdates, startUpdate } = useApp()
  const { phase, channel, release, skippedVersion } = update

  const hasUpdate =
    (phase === "available" || phase === "confirm" || phase === "downloaded") && release !== null
  const checking = phase === "checking"

  return (
    <div className="space-y-6">
      <SectionHeader title={t("settings.about")} desc="版本信息、更新通道与自动更新。" />

      {/* 版本卡片 */}
      <div className="flex items-center gap-4 rounded-xl border border-border bg-card p-5">
        <span className="flex size-12 items-center justify-center rounded-xl bg-primary font-mono text-lg font-bold text-primary-foreground">
          {"</>"}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold">YourMate</p>
          <p className="font-mono text-sm text-muted-foreground">v{CURRENT_VERSION}</p>
        </div>
        {hasUpdate ? (
          <Button size="sm" onClick={startUpdate}>
            <Sparkles />
            {t("update.now")}
          </Button>
        ) : (
          <Button variant="secondary" size="sm" onClick={checkForUpdates} disabled={checking}>
            <RefreshCw className={cn("size-4", checking && "animate-spin")} />
            {checking ? t("update.checking") : t("update.checkBtn")}
          </Button>
        )}
      </div>

      {/* 更新状态提示 */}
      {hasUpdate && release && (
        <div className="flex items-start gap-3 rounded-xl border border-primary/30 bg-primary/10 p-4">
          <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">
              {t("update.found.title")} · v{release.latestVersion}
            </p>
            <ul className="mt-1.5 flex flex-col gap-1">
              {release.changelog.map((c) => (
                <li key={c} className="text-xs text-muted-foreground">
                  · {c}
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
        </div>
      )}

      {!hasUpdate && !checking && (
        <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
          <CheckCircle2 className="size-4 text-success" />
          {t("update.upToDate")}
          {skippedVersion && (
            <span className="ml-auto text-xs">已跳过 v{skippedVersion}</span>
          )}
        </div>
      )}

      {/* 更新通道 */}
      <div>
        <p className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {t("update.channel")}
        </p>
        <div className="grid grid-cols-2 gap-3">
          {(
            [
              { id: "stable" as const, label: t("update.channel.stable"), desc: "经过完整测试的稳定版本" },
              { id: "beta" as const, label: t("update.channel.beta"), desc: "抢先体验新功能，可能不稳定" },
            ]
          ).map((c) => {
            const isActive = channel === c.id
            return (
              <button
                key={c.id}
                onClick={() => setChannel(c.id)}
                className={cn(
                  "flex flex-col items-start gap-0.5 rounded-lg border px-4 py-3 text-left transition-colors",
                  isActive ? "border-primary bg-primary/5" : "border-border hover:border-ring",
                )}
              >
                <span className="text-sm font-medium">{c.label}</span>
                <span className="text-xs text-muted-foreground">{c.desc}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* 自动更新选项 */}
      <SettingsCard>
        <SettingRow title="启动时自动检查" desc="应用启动后 5 秒内静默检查更新">
          <AutoUpdateToggle storageKey="update_auto_check" defaultOn />
        </SettingRow>
        <SettingRow title="定时检查" desc="每 6 小时后台轮询一次更新">
          <AutoUpdateToggle storageKey="update_periodic_check" defaultOn />
        </SettingRow>
        <SettingRow title="下载完成后自动安装" desc="下次关闭应用时自动完成安装">
          <AutoUpdateToggle storageKey="update_auto_install" />
        </SettingRow>
      </SettingsCard>

      {/* 版本回退 */}
      <SettingsCard>
        <SettingRow title="版本历史" desc="保留最近 2 个版本的二进制备份">
          <Button variant="ghost" size="sm">
            <History />
            查看
          </Button>
        </SettingRow>
        <SettingRow title="回退到上一版本" desc="若新版本存在问题，可手动回退至 v0.3.0">
          <Button variant="ghost" size="sm" className="text-warning hover:text-warning">
            <RotateCcw />
            回退
          </Button>
        </SettingRow>
      </SettingsCard>
    </div>
  )
}

function AutoUpdateToggle({ storageKey, defaultOn = false }: { storageKey: string; defaultOn?: boolean }) {
  const [on, setOn] = useSetting(storageKey, defaultOn)
  return <Switch checked={on} onCheckedChange={setOn} />
}
