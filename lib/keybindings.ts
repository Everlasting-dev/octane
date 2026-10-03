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

/** Task-based groups used by the cheat-sheet and the key-binding editor. */
export type ActionGroup = "time" | "lines" | "views" | "files" | "tools"

export const ACTION_GROUPS: { id: ActionGroup; title: string; hint: string }[] = [
  { id: "time", title: "Move through time", hint: "Cursor, time window and zoom" },
  { id: "lines", title: "Lines", hint: "Analysis Plot and Channels" },
  { id: "views", title: "Views", hint: "Switch screens" },
  { id: "files", title: "Files & search", hint: "Open, switch and find" },
  { id: "tools", title: "Display & tools", hint: "Toggles and helpers" },
]

export const ACTIONS: { id: ActionId; label: string; context: ActionContext; group: ActionGroup }[] = [
  { id: "cursorLeft", label: "Value cursor left (hold to glide)", context: "time", group: "time" },
  { id: "cursorRight", label: "Value cursor right (hold to glide)", context: "time", group: "time" },
  { id: "panLeft", label: "Shift time window left", context: "time", group: "time" },
  { id: "panRight", label: "Shift time window right", context: "time", group: "time" },
  { id: "zoomIn", label: "Zoom in", context: "time", group: "time" },
  { id: "zoomOut", label: "Zoom out", context: "time", group: "time" },
  { id: "windowMode", label: "Window mode: drag a graph to pick a time range", context: "time", group: "time" },
  { id: "reset", label: "Reset view", context: "global", group: "time" },

  { id: "focusPrev", label: "Previous line", context: "plot", group: "lines" },
  { id: "focusNext", label: "Next line", context: "plot", group: "lines" },
  { id: "lineAdjust", label: "Lines panel (colour, scale, weight)", context: "plot", group: "lines" },
  { id: "lineScaleUp", label: "Scale line up", context: "plot", group: "lines" },
  { id: "lineScaleDown", label: "Scale line down", context: "plot", group: "lines" },
  { id: "lineShiftUp", label: "Move line up", context: "plot", group: "lines" },
  { id: "lineShiftDown", label: "Move line down", context: "plot", group: "lines" },
  { id: "lineWidthUp", label: "Thicker line", context: "plot", group: "lines" },
  { id: "lineWidthDown", label: "Thinner line", context: "plot", group: "lines" },
  { id: "lineReset", label: "Reset line", context: "plot", group: "lines" },
  { id: "selectLine", label: "Add line to the group selection", context: "plot", group: "lines" },
  { id: "movePlot", label: "Send line to the other plot", context: "plot", group: "lines" },
  { id: "peakToggle", label: "Mark peaks", context: "plot", group: "lines" },
  { id: "fullscreen", label: "Fullscreen plot", context: "plot", group: "lines" },

  { id: "viewMatrix", label: "Signal Matrix", context: "global", group: "views" },
  { id: "viewPlot", label: "Analysis Plot", context: "global", group: "views" },
  { id: "viewChannels", label: "Channels", context: "global", group: "views" },
  { id: "viewCompare", label: "Compare", context: "global", group: "views" },

  { id: "openLog", label: "Open a log", context: "global", group: "files" },
  { id: "previousFile", label: "Previous file", context: "global", group: "files" },
  { id: "cycleFile", label: "Next file", context: "global", group: "files" },
  { id: "quickSearch", label: "Quick search a graph", context: "global", group: "files" },
  { id: "searchChannels", label: "Search the channel list", context: "global", group: "files" },

  { id: "sync", label: "Sync cursors", context: "global", group: "tools" },
  { id: "annotate", label: "Annotate", context: "global", group: "tools" },
  { id: "togglePick", label: "Pick lines from the readout", context: "global", group: "tools" },
  { id: "toggleGrid", label: "Grid lines", context: "global", group: "tools" },
  { id: "heightCycle", label: "Graph height (Signal Matrix)", context: "matrix", group: "tools" },
  { id: "editChannels", label: "Edit templates (Channels)", context: "channels", group: "tools" },
  { id: "lockCompare", label: "Lock alignment (Compare)", context: "compare", group: "tools" },
  { id: "scrollTop", label: "Scroll to top", context: "global", group: "tools" },
  { id: "shortcutsHelp", label: "This shortcuts list", context: "global", group: "tools" },
]

/** Actions shown together on one cheat-sheet row ("A / B"). */
export const ACTION_PAIRS: { a: ActionId; b: ActionId; label: string }[] = [
  { a: "cursorLeft", b: "cursorRight", label: "Move the value cursor (hold to glide)" },
  { a: "panLeft", b: "panRight", label: "Shift the time window" },
  { a: "zoomIn", b: "zoomOut", label: "Zoom in / out" },
  { a: "focusPrev", b: "focusNext", label: "Previous / next line" },
  { a: "lineScaleUp", b: "lineScaleDown", label: "Scale line up / down" },
  { a: "lineShiftUp", b: "lineShiftDown", label: "Move line up / down" },
  { a: "lineWidthUp", b: "lineWidthDown", label: "Thicker / thinner line" },
  { a: "previousFile", b: "cycleFile", label: "Previous / next file" },
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
