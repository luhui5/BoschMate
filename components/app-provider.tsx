"use client"

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react"
import type { RunMode } from "@/lib/types"
import { translate, type Lang, type TranslationKey } from "@/lib/i18n"
import {
  releaseFromUpdateInfo,
  type ReleaseInfo,
  type UpdateChannel,
  type UpdatePhase,
} from "@/lib/update"
import { projectPath } from "@/lib/project-route"
import { UpdateManager } from "@/components/update/update-manager"
import { RecoveryDialog, type RecoverySnapshotItem } from "@/components/recovery-dialog"
import { isTauri, getSetting, setSetting as tauriSetSetting, loadRecoverySnapshots, clearRecoverySnapshot, healthCheck, getUpdateInfo } from "@/lib/tauri-api"

type ThemeMode = "dark" | "light" | "system"
type FontSize = "sm" | "md" | "lg"
type EditorFont = "geist-mono" | "jetbrains" | "fira" | "sf-mono"

interface UpdateState {
  phase: UpdatePhase
  channel: UpdateChannel
  release: ReleaseInfo | null
  progress: number // 0-100
  downloadedBytes: number
  speedBytesPerSec: number
  skippedVersion: string | null
  error: string | null
}

interface AppState {
  // 平台
  isDesktop: boolean
  // 主题
  themeMode: ThemeMode
  resolvedTheme: "dark" | "light"
  setThemeMode: (m: ThemeMode) => void
  toggleTheme: () => void
  // 语言
  lang: Lang
  setLang: (l: Lang) => void
  t: (key: TranslationKey) => string
  // 字体
  fontSize: FontSize
  setFontSize: (s: FontSize) => void
  editorFont: EditorFont
  setEditorFont: (f: EditorFont) => void
  // 运行模式
  runMode: RunMode
  setRunMode: (m: RunMode) => void
  // 更新
  update: UpdateState
  setChannel: (c: UpdateChannel) => void
  checkForUpdates: () => void
  startUpdate: () => void
  confirmDownload: () => void
  remindLater: () => void
  skipVersion: () => void
  installNow: () => void
  dismissUpdate: () => void
}

const AppContext = createContext<AppState | null>(null)

function getSystemTheme(): "dark" | "light" {
  if (typeof window === "undefined") return "dark"
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [themeMode, setThemeModeState] = useState<ThemeMode>("dark")
  const [systemTheme, setSystemTheme] = useState<"dark" | "light">("dark")
  const [lang, setLangState] = useState<Lang>("zh")
  const [fontSize, setFontSizeState] = useState<FontSize>("md")
  const [editorFont, setEditorFontState] = useState<EditorFont>("geist-mono")
  const [runMode, setRunMode] = useState<RunMode>("full")
  const [isDesktop, setIsDesktop] = useState(false)
  const [recoverySnapshots, setRecoverySnapshots] = useState<RecoverySnapshotItem[]>([])

  const [update, setUpdate] = useState<UpdateState>({
    phase: "idle",
    channel: "stable",
    release: null,
    progress: 0,
    downloadedBytes: 0,
    speedBytesPerSec: 0,
    skippedVersion: null,
    error: null,
  })

  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const downloadTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  const resolvedTheme = themeMode === "system" ? systemTheme : themeMode

  // 读取持久化偏好 (Tauri settings → localStorage fallback → defaults)
  useEffect(() => {
    const load = async () => {
      const desktop = isTauri()
      setIsDesktop(desktop)

      // Helper: try Tauri first, fall back to localStorage, then default
      const loadPref = async <T extends string>(
        key: string,
        lsKey: string,
        fallback: T,
        setter: (v: T) => void,
      ) => {
        if (desktop) {
          try {
            const val = await getSetting(key)
            if (val) { setter(val as T); return }
          } catch { /* Tauri unavailable, try localStorage */ }
        }
        try {
          const val = localStorage.getItem(lsKey) as T | null
          if (val) setter(val)
        } catch { /* ignore */ }
      }

      await loadPref("theme_mode", "bc-theme-mode", "dark" as ThemeMode, setThemeModeState)
      await loadPref("lang", "bc-lang", "zh" as Lang, setLangState)
      await loadPref("font_size", "bc-font-size", "md" as FontSize, setFontSizeState)
      await loadPref("editor_font", "bc-editor-font", "geist-mono" as EditorFont, setEditorFontState)

      if (desktop) {
        try {
          const snaps = await loadRecoverySnapshots()
          if (snaps.length) setRecoverySnapshots(snaps)
        } catch { /* ignore */ }
      }

      setSystemTheme(getSystemTheme())
      const mq = window.matchMedia("(prefers-color-scheme: dark)")
      const onChange = () => setSystemTheme(mq.matches ? "dark" : "light")
      mq.addEventListener("change", onChange)
      return () => mq.removeEventListener("change", onChange)
    }
    load()
  }, [])

  useEffect(() => {
    if (!isDesktop) return
    let unlisten: (() => void) | undefined
    void import("@tauri-apps/api/window").then(({ getCurrentWindow }) =>
      getCurrentWindow().onCloseRequested(() => {
        // Recovery cleared in Rust on CloseRequested / ExitRequested
      }).then((fn) => {
        unlisten = fn
      }),
    )
    return () => {
      unlisten?.()
    }
  }, [isDesktop])

  // Health probe every 30s (Full / Degraded / Offline) — main window only
  useEffect(() => {
    if (!isDesktop) return
    let cancelled = false
    let intervalId: ReturnType<typeof setInterval> | undefined

    void import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
      if (cancelled) return
      if (getCurrentWindow().label !== "main") return

      const poll = async () => {
        try {
          const health = await healthCheck("http://localhost:11434")
          setRunMode(health.mode as RunMode)
        } catch {
          setRunMode("offline")
        }
      }
      void poll()
      intervalId = setInterval(() => void poll(), 30_000)
    })

    return () => {
      cancelled = true
      if (intervalId) clearInterval(intervalId)
    }
  }, [isDesktop])

  // 应用主题 + 持久化
  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle("dark", resolvedTheme === "dark")
    root.classList.toggle("light", resolvedTheme === "light")
    try { localStorage.setItem("bc-theme-mode", themeMode) } catch { /* ignore */ }
    if (isDesktop) {
      tauriSetSetting("theme_mode", themeMode).catch(() => {})
    }
  }, [resolvedTheme, themeMode, isDesktop])

  // 持久化学号、编辑器字体、语言（已在上面读取时设置了 data 属性）
  useEffect(() => {
    const root = document.documentElement
    root.dataset.fontSize = fontSize
    root.dataset.editorFont = editorFont
    try {
      localStorage.setItem("bc-font-size", fontSize)
      localStorage.setItem("bc-editor-font", editorFont)
      localStorage.setItem("bc-lang", lang)
    } catch { /* ignore */ }
    if (isDesktop) {
      tauriSetSetting("font_size", fontSize).catch(() => {})
      tauriSetSetting("editor_font", editorFont).catch(() => {})
      tauriSetSetting("lang", lang).catch(() => {})
    }
  }, [fontSize, editorFont, lang, isDesktop])

  // 启动时自动静默检查（桌面端，延迟 5s 避免影响启动）
  useEffect(() => {
    if (!isDesktop) return
    const tid = setTimeout(() => {
      void getUpdateInfo()
        .then((info) => {
          const release = releaseFromUpdateInfo(info)
          if (!release) return
          setUpdate((u) => {
            if (u.phase !== "idle") return u
            if (u.skippedVersion === release.latestVersion) return u
            return { ...u, phase: "available", release }
          })
        })
        .catch(() => {})
    }, 5000)
    return () => clearTimeout(tid)
  }, [isDesktop])

  // 清理
  useEffect(() => {
    return () => {
      timers.current.forEach(clearTimeout)
      if (downloadTimer.current) clearInterval(downloadTimer.current)
    }
  }, [])

  const setThemeMode = (m: ThemeMode) => setThemeModeState(m)
  const toggleTheme = () => setThemeModeState(resolvedTheme === "dark" ? "light" : "dark")
  const setLang = (l: Lang) => setLangState(l)
  const setFontSize = (s: FontSize) => setFontSizeState(s)
  const setEditorFont = (f: EditorFont) => setEditorFontState(f)
  const t = useCallback((key: TranslationKey) => translate(lang, key), [lang])

  const setChannel = (c: UpdateChannel) => setUpdate((u) => ({ ...u, channel: c }))

  const checkForUpdates = () => {
    if (!isDesktop) return
    setUpdate((u) => ({ ...u, phase: "checking", error: null }))
    void getUpdateInfo()
      .then((info) => {
        const release = releaseFromUpdateInfo(info)
        setUpdate((u) => {
          if (!release) return { ...u, phase: "up-to-date", release: null }
          return { ...u, phase: "available", release }
        })
      })
      .catch((e) => {
        setUpdate((u) => ({ ...u, phase: "idle", error: String(e) }))
      })
  }

  const startUpdate = () => setUpdate((u) => ({ ...u, phase: "confirm" }))

  // 尚未接入 tauri-plugin-updater（P8-13），下载动作打开发布页由用户手动下载安装。
  const confirmDownload = () => {
    const url = update.release?.changelogUrl
    if (url) {
      if (isDesktop) {
        void import("@tauri-apps/plugin-shell")
          .then(({ open }) => open(url))
          .catch(() => window.open(url, "_blank"))
      } else {
        window.open(url, "_blank")
      }
    }
    setUpdate((u) => ({ ...u, phase: "idle" }))
  }

  const remindLater = () => setUpdate((u) => ({ ...u, phase: "idle" }))

  const skipVersion = () =>
    setUpdate((u) => ({ ...u, phase: "idle", skippedVersion: u.release?.latestVersion ?? null }))

  const installNow = () => {
    // 模拟安装：演示一次失败回滚的可能性较低，这里直接成功重启（回到 idle）
    setUpdate((u) => ({ ...u, phase: "idle", release: null, progress: 0, downloadedBytes: 0 }))
  }

  const dismissUpdate = () => {
    if (downloadTimer.current) clearInterval(downloadTimer.current)
    setUpdate((u) => ({
      ...u,
      phase: u.phase === "downloading" ? "downloading" : "idle",
    }))
  }

  const discardRecovery = async (sessionId: string) => {
    if (isDesktop) await clearRecoverySnapshot(sessionId).catch(() => {})
    setRecoverySnapshots((prev) => prev.filter((s) => s.sessionId !== sessionId))
  }

  const discardAllRecovery = async () => {
    for (const s of recoverySnapshots) {
      if (isDesktop) await clearRecoverySnapshot(s.sessionId).catch(() => {})
    }
    setRecoverySnapshots([])
  }

  return (
    <AppContext.Provider
      value={{
        isDesktop,
        themeMode,
        resolvedTheme,
        setThemeMode,
        toggleTheme,
        lang,
        setLang,
        t,
        fontSize,
        setFontSize,
        editorFont,
        setEditorFont,
        runMode,
        setRunMode,
        update,
        setChannel,
        checkForUpdates,
        startUpdate,
        confirmDownload,
        remindLater,
        skipVersion,
        installNow,
        dismissUpdate,
      }}
    >
      {children}
      <UpdateManager />
      {recoverySnapshots.length > 0 && (
        <RecoveryDialog
          snapshots={recoverySnapshots}
          onRestore={(snap) => {
            void discardRecovery(snap.sessionId)
            if (snap.projectId) {
              window.location.href = projectPath(snap.projectId)
            }
          }}
          onDiscard={(id) => void discardRecovery(id)}
          onDiscardAll={() => void discardAllRecovery()}
        />
      )}
    </AppContext.Provider>
  )
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error("useApp must be used within AppProvider")
  return ctx
}
