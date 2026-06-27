"use client"

import { useEffect } from "react"

export interface Shortcut {
  key: string
  ctrl?: boolean
  shift?: boolean
  alt?: boolean
  description: string
  handler: () => void
}

const isMac = typeof navigator !== "undefined" && /mac/i.test(navigator.platform)

export function formatCombo(s: Shortcut): string {
  const mods: string[] = []
  if (s.ctrl) mods.push(isMac ? "⌘" : "Ctrl")
  if (s.shift) mods.push("Shift")
  if (s.alt) mods.push("Alt")
  const key = s.key === " " ? "Space" : s.key.length === 1 ? s.key.toUpperCase() : s.key
  return [...mods, key].join(" + ")
}

/** Bind a list of keyboard shortcuts. Ignores events from text inputs. */
export function useShortcuts(shortcuts: Shortcut[], enabled = true) {
  useEffect(() => {
    if (!enabled) return
    function onKeyDown(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null
      const typing =
        el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)
      // Escape still fires while typing (to close dialogs); others don't.
      if (typing && e.key !== "Escape") return

      const ctrl = isMac ? e.metaKey : e.ctrlKey
      for (const s of shortcuts) {
        if (
          s.key.toLowerCase() === e.key.toLowerCase() &&
          Boolean(s.ctrl) === ctrl &&
          Boolean(s.shift) === e.shiftKey &&
          Boolean(s.alt) === e.altKey
        ) {
          e.preventDefault()
          s.handler()
          break
        }
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [shortcuts, enabled])
}
