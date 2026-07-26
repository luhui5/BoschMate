"use client"

import { ShieldCheck, KeyRound, FileLock2, Globe, Plus, X, Upload } from "lucide-react"
import { SectionHeader, SettingsCard, SettingRow, Select } from "./primitives"
import { Switch } from "@/components/ui/switch"
import { useSetting } from "@/lib/use-setting"
import { isTauri, checkDiskSpace, exportBackup, importBackup } from "@/lib/tauri-api"
import { useEffect, useState } from "react"

export function PrivacySection() {
  const [telemetry, setTelemetry] = useSetting("privacy_telemetry", false)
  const [encryptMemory, setEncryptMemory] = useSetting("privacy_encrypt_memory", true)
  const [redactSecrets, setRedactSecrets] = useSetting("privacy_redact_secrets", true)
  const [confirmPush, setConfirmPush] = useSetting("privacy_confirm_push", true)
  const [confirmShell, setConfirmShell] = useSetting("privacy_confirm_shell", true)
  const [writeScope, setWriteScope] = useSetting("privacy_write_scope", "project")
  const [networkWhitelist, setNetworkWhitelist] = useSetting("privacy_network_whitelist", "[]")
  const [diskWarning, setDiskWarning] = useState<string | null>(null)
  const [newDomain, setNewDomain] = useState("")

  const whitelist: string[] = (() => {
    try {
      return JSON.parse(networkWhitelist)
    } catch {
      return []
    }
  })()

  useEffect(() => {
    if (!isTauri()) return
    checkDiskSpace()
      .then((d) => {
        if (d.warning) setDiskWarning(d.message)
      })
      .catch(() => {})
  }, [])

  const addDomain = () => {
    if (!newDomain.trim()) return
    const updated = [...whitelist, newDomain.trim()]
    setNetworkWhitelist(JSON.stringify(updated))
    setNewDomain("")
  }

  const removeDomain = (domain: string) => {
    const updated = whitelist.filter((d) => d !== domain)
    setNetworkWhitelist(JSON.stringify(updated))
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        title="隐私与安全"
        desc="YourMate 默认完全本地运行。代码、记忆与密钥都不会离开你的设备，除非你显式启用云端模型。"
      />

      {diskWarning && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          {diskWarning}
        </div>
      )}

      <div className="flex items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
        <div>
          <p className="text-sm font-medium text-emerald-300">本地优先模式已启用</p>
          <p className="mt-0.5 text-xs text-emerald-200/70">
            所有推理与数据存储均在本机完成，无任何出站网络请求。
          </p>
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          数据
        </p>
        <SettingsCard>
          <SettingRow title="匿名遥测" desc="发送崩溃日志与匿名使用统计以帮助改进产品">
            <Switch checked={telemetry} onCheckedChange={setTelemetry} />
          </SettingRow>
          <SettingRow title="加密长期记忆" desc="敏感记忆使用 AES-256-GCM 加密，密钥存于系统密钥链">
            <Switch checked={encryptMemory} onCheckedChange={setEncryptMemory} />
          </SettingRow>
          <SettingRow title="自动脱敏密钥" desc="检测到 API Key、Token 时在发送给模型前自动打码">
            <Switch checked={redactSecrets} onCheckedChange={setRedactSecrets} />
          </SettingRow>
        </SettingsCard>
      </div>

      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          操作权限
        </p>
        <SettingsCard>
          <SettingRow title="Git push 前确认" desc="当前通过 Agent ask_user 确认；完整弹窗门禁待后续版本">
            <Switch checked={confirmPush} onCheckedChange={setConfirmPush} />
          </SettingRow>
          <SettingRow title="执行 Shell 命令前确认" desc="当前通过 Agent ask_user 确认；完整弹窗门禁待后续版本">
            <Switch checked={confirmShell} onCheckedChange={setConfirmShell} />
          </SettingRow>
          <SettingRow title="文件写入范围" desc="限制 Agent 可修改的目录">
            <Select
              value={writeScope}
              onChange={setWriteScope}
              options={[
                { value: "project", label: "仅项目目录" },
                { value: "workspace", label: "整个工作区" },
                { value: "ask", label: "每次询问" },
              ]}
            />
          </SettingRow>
        </SettingsCard>
      </div>

      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          网络白名单
        </p>
        <SettingsCard>
          <div className="px-4 py-3">
            <p className="mb-2 text-sm text-muted-foreground">
              允许沙箱命令访问的域名（如 *.npmjs.org）。默认阻止所有网络访问。
            </p>
            <div className="mb-3 flex gap-2">
              <input
                type="text"
                value={newDomain}
                onChange={(e) => setNewDomain(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addDomain()}
                placeholder="*.example.com"
                className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm"
              />
              <button
                type="button"
                onClick={addDomain}
                className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90"
              >
                <Plus className="h-3.5 w-3.5" />
                添加
              </button>
            </div>
            {whitelist.length > 0 && (
              <div className="space-y-1">
                {whitelist.map((domain) => (
                  <div
                    key={domain}
                    className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-1.5"
                  >
                    <span className="flex items-center gap-2 text-sm">
                      <Globe className="h-3.5 w-3.5 text-muted-foreground" />
                      {domain}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeDomain(domain)}
                      className="rounded p-0.5 hover:bg-muted"
                    >
                      <X className="h-3.5 w-3.5 text-muted-foreground" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </SettingsCard>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <button className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-3 text-left transition-colors hover:border-ring">
          <KeyRound className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">管理 API 密钥</span>
        </button>
        <button
          type="button"
          className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-3 text-left transition-colors hover:border-ring"
          onClick={() => {
            if (isTauri()) {
              const path = prompt("导出路径 (完整文件路径):") ?? ""
              if (path) void exportBackup(path)
            }
          }}
        >
          <FileLock2 className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">导出备份</span>
        </button>
        <button
          type="button"
          className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-3 text-left transition-colors hover:border-ring"
          onClick={async () => {
            if (!isTauri()) return
            const path = prompt("导入路径 (完整文件路径):") ?? ""
            if (!path) return
            try {
              const result = await importBackup(path)
              alert(`导入完成: ${JSON.stringify(result)}`)
            } catch (e) {
              alert(`导入失败: ${e}`)
            }
          }}
        >
          <Upload className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">导入备份</span>
        </button>
      </div>
    </div>
  )
}
