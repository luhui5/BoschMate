"use client"

import { useCallback, useEffect, useState } from "react"
import { getSetting, setSetting as tauriSetSetting, isTauri } from "@/lib/tauri-api"

/**
 * Persisted setting hook.
 * Priority chain on load: Tauri (SQLite) → localStorage → defaultValue
 * On save: localStorage immediately → Tauri in background
 */
export function useSetting<T>(
  key: string,
  defaultValue: T,
): [T, (v: T) => void, boolean] {
  const [value, setValue] = useState<T>(defaultValue)
  const [loaded, setLoaded] = useState(false)

  // Load once on mount
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      // 1. Try Tauri
      if (isTauri()) {
        try {
          const raw = await getSetting(key)
          if (!cancelled && raw != null) {
            try {
              setValue(JSON.parse(raw) as T)
              setLoaded(true)
              return
            } catch { /* parse error, fall through */ }
          }
        } catch { /* Tauri not available, fall through */ }
      }
      // 2. Try localStorage
      try {
        const raw = localStorage.getItem(`bc-${key}`)
        if (!cancelled && raw != null) {
          setValue(JSON.parse(raw) as T)
        }
      } catch { /* ignore */ }
      setLoaded(true)
    }
    load()
    return () => { cancelled = true }
  }, [key])

  // Persist on every change (skip initial load to avoid overwriting with default)
  const persist = useCallback(
    (newValue: T) => {
      setValue(newValue)
      const json = JSON.stringify(newValue)
      try { localStorage.setItem(`bc-${key}`, json) } catch { /* ignore */ }
      if (isTauri()) {
        tauriSetSetting(key, json).catch(() => {})
      }
    },
    [key],
  )

  return [value, persist, loaded]
}
