"use client"

import { useState } from "react"
import { SectionHeader, SettingsCard, SettingRow, Select } from "./primitives"
import { Switch } from "@/components/ui/switch"

export function NotificationsSection() {
  const [taskDone, setTaskDone] = useState(true)
  const [needsInput, setNeedsInput] = useState(true)
  const [errors, setErrors] = useState(true)
  const [sound, setSound] = useState(false)

  return (
    <div className="space-y-6">
      <SectionHeader
        title="通知"
        desc="选择在 Agent 长时间任务完成或需要你介入时如何收到提醒。"
      />

      <SettingsCard>
        <SettingRow title="任务完成" desc="后台长任务（如全量测试、重构）结束时通知">
          <Switch checked={taskDone} onCheckedChange={setTaskDone} />
        </SettingRow>
        <SettingRow title="需要确认" desc="Agent 等待你批准操作（如 push、运行命令）时通知">
          <Switch checked={needsInput} onCheckedChange={setNeedsInput} />
        </SettingRow>
        <SettingRow title="错误与失败" desc="测试失败、命令报错或 CI 失败时通知">
          <Switch checked={errors} onCheckedChange={setErrors} />
        </SettingRow>
        <SettingRow title="提示音" desc="通知时播放声音">
          <Switch checked={sound} onCheckedChange={setSound} />
        </SettingRow>
      </SettingsCard>

      <SettingsCard>
        <SettingRow title="勿扰阈值" desc="任务运行时长超过该值才发送系统通知">
          <Select
            value="30"
            onChange={() => {}}
            options={[
              { value: "10", label: "10 秒" },
              { value: "30", label: "30 秒" },
              { value: "60", label: "1 分钟" },
            ]}
          />
        </SettingRow>
        <SettingRow title="通知方式" desc="系统通知中心或仅应用内提示">
          <Select
            value="system"
            onChange={() => {}}
            options={[
              { value: "system", label: "系统通知" },
              { value: "in-app", label: "仅应用内" },
              { value: "both", label: "两者" },
            ]}
          />
        </SettingRow>
      </SettingsCard>
    </div>
  )
}
