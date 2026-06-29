"use client"

import { useEffect, useState } from "react"

// Remappable single-key shortcuts. Modifier combos (Ctrl+O, Ctrl+K, ?) stay fixed.
export type ActionId =
  | "focusNext"
  | "focusPrev"
  | "selectLine"
  | "movePlot"
  | "peakToggle"
  | "fullscreen"
  | "quickSearch"
  | "cycleFile"
  | "toggleGrid"
  | "lockCompare"
  | "heightCycle"
  | "sync"
  | "annotate"
  | "reset"
  | "viewMatrix"
  | "viewPlot"
  | "viewCompare"

export const ACTIONS: { id: ActionId; label: string; scope: "plot" | "global" }[] = [
  { id: "focusNext", label: "Focus next line (Analysis Plot)", scope: "plot" },
  { id: "focusPrev", label: "Focus previous line (Analysis Plot)", scope: "plot" },
  { id: "selectLine", label: "Select / deselect focused line", scope: "plot" },
  { id: "movePlot", label: "Send focused line to the other plot", scope: "plot" },
  { id: "peakToggle", label: "Toggle peak markers", scope: "plot" },
  { id: "fullscreen", label: "Fullscreen the plot", scope: "plot" },
  { id: "quickSearch", label: "Quick search (Signal Matrix)", scope: "global" },
  { id: "cycleFile", label: "Cycle active / reference file", scope: "global" },
  { id: "toggleGrid", label: "Toggle grid lines", scope: "global" },
  { id: "lockCompare", label: "Lock alignment (Compare)", scope: "global" },
  { id: "heightCycle", label: "Cycle chart height (Signal Matrix)", scope: "global" },
  { id: "sync", label: "Toggle sync", scope: "global" },
  { id: "annotate", label: "Toggle annotate", scope: "global" },
  { id: "reset", label: "Reset view", scope: "global" },
  { id: "viewMatrix", label: "View: Signal Matrix", scope: "global" },
  { id: "viewPlot", label: "View: Analysis Plot", scope: "global" },
  { id: "viewCompare", label: "View: Compare", scope: "global" },
]

export type Bindings = Record<ActionId, string>

export const DEFAULT_BINDINGS: Bindings = {
  focusNext: "]",
  focusPrev: "[",
  selectLine: " ",
  movePlot: "m",
  peakToggle: "p",
  fullscreen: "f",
  quickSearch: "/",
  cycleFile: ".",
  heightCycle: "h",
  toggleGrid: "g",
  lockCompare: "l",
  sync: "s",
  annotate: "a",
  reset: "r",
  viewMatrix: "1",
  viewPlot: "2",
  viewCompare: "3",
}

const KEY = "octane:keybindings"
const EVT = "octane:keybindings-changed"

export function loadBindings(): Bindings {
  if (typeof window === "undefined") return { ...DEFAULT_BINDINGS }
  try {
    const raw = window.localStorage.getItem(KEY)
    return { ...DEFAULT_BINDINGS, ...(raw ? JSON.parse(raw) : {}) }
  } catch {
    return { ...DEFAULT_BINDINGS }
  }
}

export function saveBindings(b: Bindings) {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(KEY, JSON.stringify(b))
    window.dispatchEvent(new Event(EVT))
  } catch {
    /* ignore */
  }
}

/** Reactive hook — re-reads when bindings change anywhere in the app. */
export function useBindings(): Bindings {
  const [b, setB] = useState<Bindings>(DEFAULT_BINDINGS)
  useEffect(() => {
    setB(loadBindings())
    const h = () => setB(loadBindings())
    window.addEventListener(EVT, h)
    return () => window.removeEventListener(EVT, h)
  }, [])
  return b
}

export function keyLabel(k: string): string {
  if (!k) return "—"
  if (k === " ") return "Space"
  return k.length === 1 ? k.toUpperCase() : k
}

/** Single-key match (no modifiers), case-insensitive. */
export function matchesKey(e: KeyboardEvent, key: string): boolean {
  if (!key || e.ctrlKey || e.metaKey || e.altKey) return false
  return e.key.toLowerCase() === key.toLowerCase()
}
