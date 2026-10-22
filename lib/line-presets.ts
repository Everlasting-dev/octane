// Tidy lanes for the Analysis Plot: instead of every line using the full plot
// height (a tangle of overlapping traces), related channels share a lane and
// lanes stack top to bottom. Channels with well-known physical ranges get a
// fixed scale, so normal readings look calm (battery 13.8-14.2 V is a nearly
// flat line, ethanol sits still) and a real excursion stands out.
//
// The result is expressed as the usual per-line gain / offset / scale range,
// so the Lines panel shows it and anything the user changes by hand wins.

import type { Signal } from "./telemetry"
import type { LineStyle } from "./line-style"

type Sig = Pick<Signal, "label" | "unit" | "min" | "max" | "avg">

interface Preset {
  group: string
  /** fixed range, or null to fit the data */
  range: [number, number] | null
}

/** Lane order (top -> bottom) and relative lane heights. */
const GROUPS: { id: string; weight: number }[] = [
  { id: "rpm", weight: 1.3 },
  { id: "speed", weight: 1 },
  { id: "driver", weight: 1 },
  { id: "boost", weight: 1.2 },
  { id: "afr", weight: 1.2 },
  { id: "ignition", weight: 1 },
  { id: "pressure", weight: 1 },
  { id: "trims", weight: 0.8 },
  { id: "drivetrain", weight: 1 },
  { id: "temps", weight: 0.8 },
  { id: "electrical", weight: 0.6 },
  { id: "ethanol", weight: 0.6 },
  { id: "flags", weight: 0.5 },
  { id: "other", weight: 1 },
]
const ORDER = new Map(GROUPS.map((g, i) => [g.id, i]))
const WEIGHT = new Map(GROUPS.map((g) => [g.id, g.weight]))

const ceilTo = (v: number, step: number) => Math.ceil(v / step) * step

/** Which lane a channel belongs in and how it should be scaled. */
export function presetFor(sig: Sig): Preset {
  const l = sig.label.toLowerCase()
  const u = sig.unit.trim().toLowerCase()
  const max = Number.isFinite(sig.max) ? sig.max : 1
  const min = Number.isFinite(sig.min) ? sig.min : 0

  if (/flags|failsafe|^mil|mil source|\(raw\)|\braw\b|mapswitch|lc flags|launch control active|log mark|digitalparameter/.test(l) || u === "raw")
    return { group: "flags", range: [0, Math.max(1, max)] }
  if (/ethanol|flex.?fuel/.test(l) && !/advance|ignition/.test(l)) return { group: "ethanol", range: [0, 100] }
  if (/batt|battey|system volt|supply volt/.test(l)) return { group: "electrical", range: [10, 16] }
  if (/volt|\(v\)/.test(l) || u === "v" || u === "mv") return { group: "electrical", range: u === "mv" ? [0, 5000] : [0, 5] }
  if (/temp/.test(l)) {
    if (/coolant|water/.test(l)) return { group: "temps", range: [0, 130] }
    if (/fluid|trans|clutch|oil/.test(l)) return { group: "temps", range: [0, 150] }
    if (/intake|iat|air|fuel/.test(l)) return { group: "temps", range: [0, 80] }
    return { group: "temps", range: [Math.min(0, min), Math.max(100, ceilTo(max, 10))] }
  }
  if (/fuel trim/.test(l)) return { group: "trims", range: Math.abs(sig.avg) > 50 ? [75, 125] : [-25, 25] }
  if (/\bafr\b|air.?fuel/.test(l) || u === "afr") return { group: "afr", range: [9, 16] }
  if (/lambda/.test(l) || u === "λ") return { group: "afr", range: [0.6, 1.1] }
  if (/knock/.test(l)) return { group: "ignition", range: [-8, 4] }
  if (/ignition|timing|advance/.test(l)) return { group: "ignition", range: null }
  if (/boost|manifold|\bmap\b|wastegate|wg duty|turbo/.test(l)) return { group: "boost", range: /duty|%/.test(l) || u === "%" ? [0, 100] : null }
  if (/pressure/.test(l)) return { group: "pressure", range: null }
  if (/\bgear\b/.test(l)) return { group: "drivetrain", range: [0, 7] }
  if (/clutch|slip|torque split|4wd|output shaft|sleeve|tcm|tc torque|torque/.test(l)) return { group: "drivetrain", range: null }
  if (/engine speed|engine idle speed|\brpm\b/.test(l) || (u === "rpm" && /engine/.test(l)))
    return { group: "rpm", range: [0, Math.max(7000, ceilTo(max, 1000))] }
  if (/speed/.test(l) || u === "km/h" || u === "mph") return { group: "speed", range: [0, Math.max(60, ceilTo(max, 20))] }
  if (/pedal|accel|throttle|engine load|injector duty|duty/.test(l)) return { group: "driver", range: /angle/.test(l) ? [0, 90] : [0, 100] }
  if (/injector|pulse width|airflow|maf/.test(l)) return { group: "driver", range: null }
  return { group: "other", range: null }
}

/** Fixed range widened to the data, or the data range with a little headroom. */
function rangeFor(sig: Sig, preset: Preset): [number, number] {
  const min = Number.isFinite(sig.min) ? sig.min : 0
  const max = Number.isFinite(sig.max) ? sig.max : min + 1
  if (preset.range) {
    const lo = Math.min(preset.range[0], min)
    const hi = Math.max(preset.range[1], max)
    return hi > lo ? [lo, hi] : [lo, lo + 1]
  }
  const span = max - min || Math.abs(max) || 1
  let lo = min - span * 0.05
  const hi = max + span * 0.05
  if (min >= 0 && lo < 0) lo = 0
  return [lo, hi]
}

const GAP = 0.03
const PAD = 0.02

/**
 * Lane layout for one or more panes (each pane is laid out on its own).
 * Returns per-line gain / offset / range in LineStyle terms.
 */
export function tidyLayout(panes: Sig[][]): Record<string, LineStyle> {
  const out: Record<string, LineStyle> = {}
  for (const pane of panes) {
    if (!pane.length) continue
    const byGroup = new Map<string, { sig: Sig; preset: Preset }[]>()
    for (const sig of pane) {
      const preset = presetFor(sig)
      const list = byGroup.get(preset.group) ?? []
      list.push({ sig, preset })
      byGroup.set(preset.group, list)
    }
    const groups = [...byGroup.keys()].sort((a, b) => (ORDER.get(a) ?? 99) - (ORDER.get(b) ?? 99))
    const totalWeight = groups.reduce((s, g) => s + (WEIGHT.get(g) ?? 1), 0)
    const usable = 1 - PAD * 2 - GAP * (groups.length - 1)
    let top = 1 - PAD
    for (const g of groups) {
      const h = (usable * (WEIGHT.get(g) ?? 1)) / totalWeight
      const bottom = top - h
      for (const { sig, preset } of byGroup.get(g)!) {
        const [lo, hi] = rangeFor(sig, preset)
        // display y = (norm - 0.5) * gain + 0.5 + offset; norm 0..1 -> bottom..top
        out[sig.label] = { gain: +h.toFixed(4), offset: +((top + bottom) / 2 - 0.5).toFixed(4), rangeMin: lo, rangeMax: hi }
      }
      top = bottom - GAP
    }
  }
  return out
}

const near = (a: number | undefined, b: number | undefined) =>
  a == null || b == null ? a == null && b == null : Math.abs(a - b) < 1e-6

/** True when the user has changed this line's scaling away from the base (tidy or default). */
export function isManualScale(t: LineStyle | undefined, base: LineStyle | undefined): boolean {
  if (!t) return false
  const b = base ?? { gain: 1, offset: 0 }
  return !(near(t.gain, b.gain) && near(t.offset, b.offset) && near(t.rangeMin, b.rangeMin) && near(t.rangeMax, b.rangeMax))
}

/** A line with only colour / weight set (or a plain reset) means "use the base layout". */
function isPlainEntry(t: LineStyle): boolean {
  return t.gain === 1 && t.offset === 0 && t.rangeMin == null && t.rangeMax == null
}

/** User styles on top of the tidy base: manual scaling wins, colour and weight always carry over. */
export function mergeStyles(base: Record<string, LineStyle>, user: Record<string, LineStyle>): Record<string, LineStyle> {
  const out: Record<string, LineStyle> = { ...base }
  for (const [label, t] of Object.entries(user)) {
    const b = base[label]
    if (b && isPlainEntry(t)) out[label] = { ...b, color: t.color, width: t.width }
    else out[label] = t
  }
  return out
}

/** Keep only what differs from the base, so the base can keep adapting. */
export function stripBase(base: Record<string, LineStyle>, next: Record<string, LineStyle>): Record<string, LineStyle> {
  const out: Record<string, LineStyle> = {}
  for (const [label, t] of Object.entries(next)) {
    if (isManualScale(t, base[label])) out[label] = t
    else if (t.color != null || t.width != null) out[label] = { gain: 1, offset: 0, color: t.color, width: t.width }
  }
  return out
}
