"use client"

import { useEffect } from "react"
import { keyLabel, matchesKey, type Combo } from "@/lib/keybindings"

export interface Shortcut extends Combo {
  description: string
  handler: () => void
}

export function formatCombo(s: Shortcut): string {
  return keyLabel(s)
}

/** Bind a list of keyboard shortcuts. Ignores events from text inputs. */
export function useShortcuts(shortcuts: Shortcut[], enabled = true) {
  useEffect(() => {
    if (!enabled) return
    function onKeyDown(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null
      const typing =
        el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)
      // Escape still fires while typing (to close dialogs); others don't.
      if (typing && e.key !== "Escape") return

      for (const s of shortcuts) {
        if (matchesKey(e, s)) {
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
