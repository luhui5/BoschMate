"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { ChatMessage } from "@/lib/types"

const FLOAT_VISIBLE_THRESHOLD = 100

export function useFloatingUserMessage(
  scrollRef: React.RefObject<HTMLDivElement | null>,
  messages: ChatMessage[],
) {
  const [floatingId, setFloatingId] = useState<string | null>(null)
  const messageRefs = useRef<Map<string, HTMLElement>>(new Map())

  const registerUserMessageRef = useCallback((id: string, el: HTMLElement | null) => {
    if (el) messageRefs.current.set(id, el)
    else messageRefs.current.delete(id)
  }, [])

  const userMessages = useMemo(
    () => messages.filter((m) => m.role === "user"),
    [messages],
  )

  useEffect(() => {
    const container = scrollRef.current
    if (!container || userMessages.length === 0) {
      setFloatingId(null)
      return
    }

    const update = () => {
      const containerRect = container.getBoundingClientRect()
      const threshold = containerRect.top + 8

      let activeId: string | null = null
      for (const m of userMessages) {
        const el = messageRefs.current.get(m.id)
        if (!el) continue
        const rect = el.getBoundingClientRect()
        if (rect.top <= threshold) activeId = m.id
      }

      if (!activeId) {
        setFloatingId(null)
        return
      }

      const activeEl = messageRefs.current.get(activeId)
      if (!activeEl) {
        setFloatingId(null)
        return
      }

      const rect = activeEl.getBoundingClientRect()
      const stillVisible =
        rect.top >= containerRect.top &&
        rect.top < containerRect.top + FLOAT_VISIBLE_THRESHOLD

      setFloatingId(stillVisible ? null : activeId)
    }

    update()
    container.addEventListener("scroll", update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(container)

    return () => {
      container.removeEventListener("scroll", update)
      ro.disconnect()
    }
  }, [scrollRef, userMessages])

  const floatingMessage =
    floatingId != null ? (messages.find((m) => m.id === floatingId) ?? null) : null

  return { floatingMessage, registerUserMessageRef }
}
