"use client"

import { useEffect, useState } from "react"

// Every shortcut is a user-remappable key combo (key + optional Ctrl/Shift/Alt).
// Only Esc (close / cancel) is fixed.
export type ActionId =
  | "focusNext"
  | "focusPrev"
  | "selectLine"
  | "movePlot"
  | "peakToggle"
  | "fullscreen"
  | "lineAdjust"
  | "lineScaleUp"
  | "lineScaleDown"
  | "lineShiftUp"
  | "lineShiftDown"
  | "lineWidthUp"
  | "lineWidthDown"
  | "lineReset"
  | "togglePick"
  | "editChannels"
  | "quickSearch"
  | "previousFile"
  | "cycleFile"
  | "toggleGrid"
  | "lockCompare"
  | "heightCycle"
  | "sync"
  | "annotate"
  | "reset"
  | "viewMatrix"
  | "viewPlot"
  | "viewChannels"
  | "viewCompare"
  | "windowMode"
  | "zoomIn"
  | "zoomOut"
  | "cursorLeft"
  | "cursorRight"
  | "panLeft"
  | "panRight"
  | "openLog"
  | "searchChannels"
  | "shortcutsHelp"
  | "scrollTop"

export type ActionContext = "plot" | "matrix" | "channels" | "compare" | "time" | "global"

export const ACTIONS: { id: ActionId; label: string; context: ActionContext }[] = [
  { id: "focusNext", label: "Select next line", context: "plot" },
  { id: "focusPrev", label: "Select previous line", context: "plot" },
  { id: "selectLine", label: "Add / remove selected line from the group", context: "plot" },
  { id: "lineAdjust", label: "Lines panel (colour / scale / weight)", context: "plot" },
  { id: "lineScaleUp", label: "Scale selected line up", context: "plot" },
  { id: "lineScaleDown", label: "Scale selected line down", context: "plot" },
  { id: "lineShiftUp", label: "Move selected line up", context: "plot" },
  { id: "lineShiftDown", label: "Move selected line down", context: "plot" },
  { id: "lineWidthUp", label: "Thicker selected line", context: "plot" },
  { id: "lineWidthDown", label: "Thinner selected line", context: "plot" },
  { id: "lineReset", label: "Reset selected line", context: "plot" },
  { id: "movePlot", label: "Send selected line to the other plot", context: "plot" },
  { id: "peakToggle", label: "Toggle peak markers", context: "plot" },
  { id: "fullscreen", label: "Fullscreen the plot", context: "plot" },
  { id: "cursorLeft", label: "Move value cursor left", context: "time" },
  { id: "cursorRight", label: "Move value cursor right", context: "time" },
  { id: "panLeft", label: "Shift time window left", context: "time" },
  { id: "panRight", label: "Shift time window right", context: "time" },
  { id: "zoomIn", label: "Zoom time window in", context: "time" },
  { id: "zoomOut", label: "Zoom time window out", context: "time" },
  { id: "windowMode", label: "Window mode (drag a plot to set the time window)", context: "time" },
  { id: "editChannels", label: "Edit templates", context: "channels" },
  { id: "heightCycle", label: "Cycle chart height", context: "matrix" },
  { id: "lockCompare", label: "Lock alignment", context: "compare" },
  { id: "openLog", label: "Open log", context: "global" },
  { id: "searchChannels", label: "Search channels", context: "global" },
  { id: "quickSearch", label: "Quick search (Matrix & Plot)", context: "global" },
  { id: "previousFile", label: "Previous loaded / reference file", context: "global" },
  { id: "cycleFile", label: "Next loaded / reference file", context: "global" },
  { id: "togglePick", label: "Toggle readout picking", context: "global" },
  { id: "toggleGrid", label: "Toggle grid lines", context: "global" },
  { id: "sync", label: "Toggle sync", context: "global" },
  { id: "annotate", label: "Toggle annotate", context: "global" },
  { id: "reset", label: "Reset view", context: "global" },
  { id: "scrollTop", label: "Scroll to top", context: "global" },
  { id: "shortcutsHelp", label: "Keyboard shortcuts cheat-sheet", context: "global" },
  { id: "viewMatrix", label: "View: Signal Matrix", context: "global" },
  { id: "viewPlot", label: "View: Analysis Plot", context: "global" },
  { id: "viewChannels", label: "View: Channels", context: "global" },
  { id: "viewCompare", label: "View: Compare", context: "global" },
]

export interface Combo {
  key: string
  ctrl?: boolean
  shift?: boolean
  alt?: boolean
}

export type Bindings = Record<ActionId, Combo>

const k = (key: string, mods: Omit<Combo, "key"> = {}): Combo => ({ key, ...mods })

export const DEFAULT_BINDINGS: Bindings = {
  focusNext: k("]"),
  focusPrev: k("["),
  selectLine: k(" "),
  movePlot: k("m"),
  peakToggle: k("p"),
  fullscreen: k("f"),
  lineAdjust: k("t"),
  lineScaleUp: k("=", { ctrl: true }),
  lineScaleDown: k("-", { ctrl: true }),
  lineShiftUp: k("ArrowUp", { ctrl: true }),
  lineShiftDown: k("ArrowDown", { ctrl: true }),
  lineWidthUp: k("=", { ctrl: true, shift: true }),
  lineWidthDown: k("-", { ctrl: true, shift: true }),
  lineReset: k("0", { ctrl: true }),
  togglePick: k("v"),
  editChannels: k("e"),
  quickSearch: k("/"),
  previousFile: k(","),
  cycleFile: k("."),
  heightCycle: k("h"),
  toggleGrid: k("g"),
  lockCompare: k("l"),
  sync: k("s"),
  annotate: k("a"),
  reset: k("r"),
  viewMatrix: k("1"),
  viewPlot: k("2"),
  viewChannels: k("3"),
  viewCompare: k("4"),
  windowMode: k("w"),
  zoomIn: k("="),
  zoomOut: k("-"),
  cursorLeft: k("ArrowLeft"),
  cursorRight: k("ArrowRight"),
  panLeft: k("ArrowLeft", { shift: true }),
  panRight: k("ArrowRight", { shift: true }),
  openLog: k("o", { ctrl: true }),
  searchChannels: k("k", { ctrl: true }),
  shortcutsHelp: k("?", { shift: true }),
  scrollTop: k("Home"),
}

const KEY = "octane:keybindings"
const EVT = "octane:keybindings-changed"

/** One spelling per physical key: "+"/"=" and "_"/"-" are the same key. */
export function canonicalKey(key: string): string {
  if (key === "+") return "="
  if (key === "_") return "-"
  return key.length === 1 ? key.toLowerCase() : key
}

const MODIFIER_KEYS = new Set(["Control", "Shift", "Alt", "Meta", "AltGraph", "CapsLock", "OS"])

export function isModifierKey(key: string): boolean {
  return MODIFIER_KEYS.has(key)
}

export function comboFromEvent(e: KeyboardEvent): Combo {
  return { key: canonicalKey(e.key), ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey, alt: e.altKey }
}

export function sameCombo(a: Combo, b: Combo): boolean {
  return canonicalKey(a.key) === canonicalKey(b.key) && !!a.ctrl === !!b.ctrl && !!a.shift === !!b.shift && !!a.alt === !!b.alt
}

/** Exact combo match (modifiers must match too). Ctrl and ⌘ are treated alike. */
export function matchesKey(e: KeyboardEvent, combo: Combo | undefined): boolean {
  if (!combo?.key) return false
  return sameCombo(comboFromEvent(e), combo)
}

function toCombo(value: unknown): Combo | null {
  if (typeof value === "string" && value) return { key: canonicalKey(value) }
  if (value && typeof value === "object" && typeof (value as Combo).key === "string") {
    const v = value as Combo
    return { key: canonicalKey(v.key), ctrl: !!v.ctrl, shift: !!v.shift, alt: !!v.alt }
  }
  return null
}

export function loadBindings(): Bindings {
  if (typeof window === "undefined") return { ...DEFAULT_BINDINGS }
  try {
    const raw = window.localStorage.getItem(KEY)
    const stored = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
    const out = { ...DEFAULT_BINDINGS }
    for (const id of Object.keys(DEFAULT_BINDINGS) as ActionId[]) {
      const c = toCombo(stored[id])
      if (c) out[id] = c
    }
    return out
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

const KEY_NAMES: Record<string, string> = {
  " ": "Space",
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
  ArrowDown: "↓",
  Escape: "Esc",
  PageUp: "PgUp",
  PageDown: "PgDn",
}

const isMac = typeof navigator !== "undefined" && /mac/i.test(navigator.platform)

export function keyLabel(combo: Combo | string | undefined): string {
  if (!combo) return "—"
  const c = typeof combo === "string" ? { key: combo } : combo
  if (!c.key) return "—"
  const name = KEY_NAMES[c.key] ?? (c.key.length === 1 ? c.key.toUpperCase() : c.key)
  const parts: string[] = []
  if (c.ctrl) parts.push(isMac ? "⌘" : "Ctrl")
  if (c.alt) parts.push(isMac ? "⌥" : "Alt")
  // "?" already implies Shift on most layouts; don't print it twice.
  if (c.shift && c.key !== "?") parts.push("Shift")
  parts.push(name)
  return parts.join(" + ")
}
