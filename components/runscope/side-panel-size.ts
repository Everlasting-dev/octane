"use client"

// Drag-to-resize height of the side panel's Templates list. Growing it pushes
// Window and Channels down; the Channels list shrinks (it never scrolls the
// panel) but never below a minimum that depends on the screen height.

import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react"

const KEY = "octane:panel-height:templates"
/** about two and a half rows, as before */
export const TEMPLATES_DEFAULT = 76
const TEMPLATES_MIN = 34

/** Smallest height the Channels list may shrink to on this screen (px). */
export function channelsMinHeight(viewportHeight: number): number {
  return Math.round(Math.min(240, Math.max(96, viewportHeight * 0.18)))
}

export function useTemplatesHeight() {
  const [height, setHeight] = useState(TEMPLATES_DEFAULT)
  const [dragging, setDragging] = useState(false)
  const listRef = useRef<HTMLUListElement>(null)
  const channelsRef = useRef<HTMLUListElement>(null)
  const drag = useRef<{ y: number; h: number; max: number } | null>(null)

  useEffect(() => {
    try {
      const v = Number(window.localStorage.getItem(KEY))
      if (Number.isFinite(v) && v >= TEMPLATES_MIN) setHeight(v)
    } catch {
      /* default height */
    }
  }, [])

  /** Tallest the list can be right now: its content, and only what Channels can spare. */
  const maxNow = useCallback((current: number) => {
    const content = listRef.current ? listRef.current.scrollHeight : current
    const channels = channelsRef.current?.clientHeight ?? 0
    const spare = Math.max(0, channels - channelsMinHeight(window.innerHeight))
    return Math.max(TEMPLATES_MIN, Math.min(content, current + spare))
  }, [])

  // A smaller window (or more templates removed) can leave Channels below its
  // minimum: give the space back.
  useEffect(() => {
    function fit() {
      const channels = channelsRef.current?.clientHeight
      if (channels == null) return
      const deficit = channelsMinHeight(window.innerHeight) - channels
      if (deficit > 0) setHeight((h) => Math.max(TEMPLATES_MIN, h - deficit))
    }
    fit()
    window.addEventListener("resize", fit)
    return () => window.removeEventListener("resize", fit)
  }, [height])

  const save = (h: number) => {
    try {
      window.localStorage.setItem(KEY, String(Math.round(h)))
    } catch {
      /* ignore */
    }
  }

  return {
    height,
    dragging,
    listRef,
    channelsRef,
    onPointerDown(e: PointerEvent<HTMLDivElement>) {
      if (e.button !== 0) return
      e.preventDefault()
      e.currentTarget.setPointerCapture(e.pointerId)
      drag.current = { y: e.clientY, h: height, max: maxNow(height) }
      setDragging(true)
    },
    onPointerMove(e: PointerEvent<HTMLDivElement>) {
      const d = drag.current
      if (!d) return
      const next = Math.round(Math.min(d.max, Math.max(TEMPLATES_MIN, d.h + (e.clientY - d.y))))
      setHeight(next)
    },
    onPointerUp(e: PointerEvent<HTMLDivElement>) {
      if (!drag.current) return
      drag.current = null
      setDragging(false)
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {
        /* already released */
      }
      setHeight((h) => {
        save(h)
        return h
      })
    },
    reset() {
      setHeight(TEMPLATES_DEFAULT)
      save(TEMPLATES_DEFAULT)
    },
  }
}
