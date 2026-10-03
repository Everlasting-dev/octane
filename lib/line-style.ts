// Per-line display settings for the Analysis Plot / Channels overlay, and the
// "smart" vertical range that stops low-variance channels (battery voltage,
// ethanol content, temps…) from being stretched across the whole plot.

import type { Signal } from "./telemetry"

export interface LineStyle {
  /** vertical stretch around the middle of the plot */
  gain: number
  /** vertical shift, in plot-heights (0.1 = 10% of the plot) */
  offset: number
  /** stroke width override (px) */
  width?: number
  /** color override (must be unique among visible lines) */
  color?: string
  /** manual scale range in real units; when set it replaces the smart range */
  rangeMin?: number
  rangeMax?: number
}

export const DEFAULT_STYLE: LineStyle = { gain: 1, offset: 0 }
export const GAIN_MIN = 0.2
export const GAIN_MAX = 20
export const WIDTH_MIN = 0.5
export const WIDTH_MAX = 6

const STORAGE_KEY = "octane:line-styles:v1"

export function loadLineStyles(): Record<string, LineStyle> {
  if (typeof window === "undefined") return {}
  try {
    const raw = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}")
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {}
    const out: Record<string, LineStyle> = {}
    for (const [label, value] of Object.entries(raw as Record<string, unknown>)) {
      if (!value || typeof value !== "object") continue
      const v = value as Partial<LineStyle>
      const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : undefined)
      out[label] = {
        gain: num(v.gain) ?? 1,
        offset: num(v.offset) ?? 0,
        width: num(v.width),
        color: typeof v.color === "string" ? v.color : undefined,
        rangeMin: num(v.rangeMin),
        rangeMax: num(v.rangeMax),
      }
    }
    return out
  } catch {
    return {}
  }
}

export function saveLineStyles(styles: Record<string, LineStyle>) {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(styles))
  } catch {
    /* ignore storage failures */
  }
}

export function isDefaultStyle(s: LineStyle | undefined): boolean {
  if (!s) return true
  return (
    s.gain === 1 &&
    s.offset === 0 &&
    s.width == null &&
    s.color == null &&
    s.rangeMin == null &&
    s.rangeMax == null
  )
}

/**
 * Smallest vertical span (real units) a channel should occupy. A channel whose
 * whole-log range is smaller than this is drawn inside this span instead, so
 * 13.8–14.2 V battery voltage looks nearly flat rather than full-height noise.
 */
export function minSpanFor(label: string, unit: string, avg: number): number {
  const l = label.toLowerCase()
  const u = unit.trim().toLowerCase()
  if (/ethanol|flex.?fuel|e85/.test(l)) return 100
  // Battery/system voltage barely moves (13.8-14.4 V): keep it a quiet line.
  if (/batt|system volt|supply volt/.test(l)) return 16
  // Sensor voltages (0-5 V signals) still deserve most of the plot height.
  if (/volt/.test(l) || u === "v") return 5
  if (/lambda/.test(l) || u === "λ" || u === "lambda") return 0.3
  if (/\bafr\b|air.?fuel/.test(l) || u === "afr") return 4
  if (/temp|coolant|\biat\b|\begt\b/.test(l) || /°|deg ?c|deg ?f|^c$|^f$/.test(u)) return 40
  if (/\bgear\b/.test(l)) return 6
  if (/engine speed|\brpm\b/.test(l) || u === "rpm") return 1000
  if (/speed/.test(l) || u === "km/h" || u === "kph" || u === "mph") return 20
  if (u === "psi") return 10
  if (u === "kpa") return 50
  if (u === "bar") return 1
  if (/timing|ignition|advance/.test(l)) return 10
  if (u === "%") return 20
  return Math.max(Math.abs(avg) * 0.1, 1e-6)
}

export interface Range {
  lo: number
  hi: number
}

/** Vertical range used to normalise a channel when no manual range is set. */
export function smartRange(sig: Pick<Signal, "label" | "unit" | "min" | "max" | "avg">): Range {
  const min = Number.isFinite(sig.min) ? sig.min : 0
  const max = Number.isFinite(sig.max) ? sig.max : min + 1
  const range = max - min
  const span = minSpanFor(sig.label, sig.unit, sig.avg)
  if (range >= span && range > 0) return { lo: min, hi: max }
  const mid = (min + max) / 2
  let lo = mid - span / 2
  let hi = mid + span / 2
  // Keep naturally non-negative channels (%, content, speed) from dipping below 0.
  if (min >= 0 && lo < 0) {
    hi -= lo
    lo = 0
  }
  return { lo, hi: hi > lo ? hi : lo + 1 }
}

/** Range actually used: manual min/max when set, else the smart range. */
export function lineRange(sig: Pick<Signal, "label" | "unit" | "min" | "max" | "avg">, style?: LineStyle): Range {
  const smart = smartRange(sig)
  const lo = style?.rangeMin ?? smart.lo
  const hi = style?.rangeMax ?? smart.hi
  return hi > lo ? { lo, hi } : { lo, hi: lo + Math.max(1e-6, Math.abs(lo) * 0.01 || 1) }
}

/** Real value → 0..1 position within the range (before gain/offset). */
export function normalize(v: number, r: Range): number {
  return (v - r.lo) / (r.hi - r.lo)
}

/** 0..1 position → displayed position with gain/offset applied. */
export function applyStyle(v: number | null, s: LineStyle | undefined): number | null {
  if (v == null) return null
  const t = s ?? DEFAULT_STYLE
  return (v - 0.5) * t.gain + 0.5 + t.offset
}

/** Displayed 0..1 position → real value (inverse of normalize + applyStyle). */
export function realFromDisplay(y: number, r: Range, s: LineStyle | undefined): number {
  const t = s ?? DEFAULT_STYLE
  const norm = (y - 0.5 - t.offset) / t.gain + 0.5
  return r.lo + (r.hi - r.lo) * norm
}

/** A "nice" nudge step (1/2/5 × 10^n) about 5% of the span. */
export function niceStep(span: number): number {
  const raw = Math.abs(span) * 0.05 || 0.1
  const pow = Math.pow(10, Math.floor(Math.log10(raw)))
  const m = raw / pow
  const nice = m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10
  return nice * pow
}
