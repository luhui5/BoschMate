"use client"

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react"
import type { RunMode } from "@/lib/types"
import { translate, type Lang, type TranslationKey } from "@/lib/i18n"
import {
  MOCK_RELEASE,
  type ReleaseInfo,
  type UpdateChannel,
  type UpdatePhase,
} from "@/lib/update"
import { UpdateManager } from "@/components/update/update-manager"
import { isTauri, getSetting, setSetting as tauriSetSetting } from "@/lib/tauri-api"

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

  // 读取持久化偏好 (Tauri settings or localStorage fallback)
  useEffect(() => {
    const load = async () => {
      const desktop = isTauri()
      setIsDesktop(desktop)

      if (desktop) {
        // Load from Rust backend via Tauri IPC
        try {
          const tm = await getSetting("theme_mode")
          if (tm) setThemeModeState(tm as ThemeMode)
          const lg = await getSetting("lang")
          if (lg) setLangState(lg as Lang)
          const fs = await getSetting("font_size")
          if (fs) setFontSizeState(fs as FontSize)
          const ef = await getSetting("editor_font")
          if (ef) setEditorFontState(ef as EditorFont)
        } catch { /* fallback to localStorage below */ }
      }

      // Always try localStorage as fallback / initial value
      try {
        const tm = localStorage.getItem("bc-theme-mode") as ThemeMode | null
        if (tm) setThemeModeState(tm)
        const lg = localStorage.getItem("bc-lang") as Lang | null
        if (lg) setLangState(lg)
        const fs = localStorage.getItem("bc-font-size") as FontSize | null
        if (fs) setFontSizeState(fs)
        const ef = localStorage.getItem("bc-editor-font") as EditorFont | null
        if (ef) setEditorFontState(ef)
      } catch { /* ignore */ }
      setSystemTheme(getSystemTheme())
      const mq = window.matchMedia("(prefers-color-scheme: dark)")
      const onChange = () => setSystemTheme(mq.matches ? "dark" : "light")
      mq.addEventListener("change", onChange)
      return () => mq.removeEventListener("change", onChange)
    }
    load()
  }, [])

  // 应用主题
  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle("dark", resolvedTheme === "dark")
    root.classList.toggle("light", resolvedTheme === "light")
    try {
      localStorage.setItem("bc-theme-mode", themeMode)
    } catch {
      /* ignore */
    }
  }, [resolvedTheme, themeMode])

  // 应用字号与编辑器字体
  useEffect(() => {
    const root = document.documentElement
    root.dataset.fontSize = fontSize
    root.dataset.editorFont = editorFont
    try {
      localStorage.setItem("bc-font-size", fontSize)
      localStorage.setItem("bc-editor-font", editorFont)
      localStorage.setItem("bc-lang", lang)
    } catch { /* ignore */ }
    // Also persist to Tauri backend when available
    if (isDesktop) {
      tauriSetSetting("font_size", fontSize).catch(() => {})
      tauriSetSetting("editor_font", editorFont).catch(() => {})
      tauriSetSetting("lang", lang).catch(() => {})
    }
  }, [fontSize, editorFont, lang, isDesktop])

  // 启动时自动静默检查（5s 后），模拟发现更新弹出 toast
  useEffect(() => {
    const tid = setTimeout(() => {
      setUpdate((u) => {
        if (u.phase !== "idle") return u
        if (u.skippedVersion === MOCK_RELEASE.latestVersion) return u
        return { ...u, phase: "available", release: MOCK_RELEASE }
      })
    }, 5000)
    return () => clearTimeout(tid)
  }, [])

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
    setUpdate((u) => ({ ...u, phase: "checking", error: null }))
    const tid = setTimeout(() => {
      setUpdate((u) => ({ ...u, phase: "available", release: MOCK_RELEASE }))
    }, 1400)
    timers.current.push(tid)
  }

  const startUpdate = () => setUpdate((u) => ({ ...u, phase: "confirm" }))

  const confirmDownload = () => {
    setUpdate((u) => ({ ...u, phase: "downloading", progress: 0, downloadedBytes: 0 }))
    const total = MOCK_RELEASE.sizeBytes
    if (downloadTimer.current) clearInterval(downloadTimer.current)
    downloadTimer.current = setInterval(() => {
      setUpdate((u) => {
        if (u.phase !== "downloading") return u
        const next = Math.min(100, u.progress + Math.random() * 12 + 4)
        const downloadedBytes = Math.round((next / 100) * total)
        if (next >= 100) {
          if (downloadTimer.current) clearInterval(downloadTimer.current)
          return { ...u, phase: "downloaded", progress: 100, downloadedBytes: total }
        }
        return {
          ...u,
          progress: next,
          downloadedBytes,
          speedBytesPerSec: Math.round((1.8 + Math.random() * 1.2) * 1024 * 1024),
        }
      })
    }, 500)
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
    </AppContext.Provider>
  )
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error("useApp must be used within AppProvider")
  return ctx
}
