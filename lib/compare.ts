// Time-aligned diff between two signal series. Ported from the legacy
// modules/comparison.js, typed to the {t, value} sample shape.

import type { SignalSample } from "./telemetry"

export interface DiffStats {
  count: number
  maxDiff: number
  minDiff: number
  avgDiff: number
  medianDiff: number
  stdDev: number
  maxPct: number
  minPct: number
  avgPct: number
}

export interface DiffResult {
  time: number[]
  a: (number | null)[]
  b: (number | null)[]
  diff: (number | null)[]
  stats: DiffStats | null
}

/** Linear interpolation of a {t,value} series onto target time points. */
function interpolate(series: SignalSample[], target: number[]): (number | null)[] {
  return target.map((t) => {
    let idx = 0
    for (let i = 0; i < series.length - 1; i++) {
      if (series[i].t <= t && series[i + 1].t >= t) {
        idx = i
        break
      }
      if (series[i].t > t) {
        idx = i
        break
      }
    }
    if (idx >= series.length - 1) {
      const last = series[series.length - 1]?.value
      return Number.isFinite(last) ? last : null
    }
    const t0 = series[idx].t
    const t1 = series[idx + 1].t
    const v0 = series[idx].value
    const v1 = series[idx + 1].value
    if (!Number.isFinite(v0) || !Number.isFinite(v1)) {
      return Number.isFinite(v0) ? v0 : Number.isFinite(v1) ? v1 : null
    }
    if (t1 === t0) return v0
    return v0 + (v1 - v0) * ((t - t0) / (t1 - t0))
  })
}

function stdDev(values: number[], mean: number): number {
  const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length
  return Math.sqrt(variance)
}

/** Align two series to a common time grid and compute differences + stats. */
export function calculateDiff(a: SignalSample[], b: SignalSample[]): DiffResult | null {
  if (!a?.length || !b?.length) return null

  const minTime = Math.max(a[0].t, b[0].t)
  const maxTime = Math.min(a[a.length - 1].t, b[b.length - 1].t)
  if (minTime >= maxTime) return null

  const stepA = (a[a.length - 1].t - a[0].t) / a.length
  const stepB = (b[b.length - 1].t - b[0].t) / b.length
  const step = Math.max(Math.min(stepA, stepB) * 0.5, (maxTime - minTime) / 4000)

  const time: number[] = []
  for (let t = minTime; t <= maxTime; t += step) time.push(+t.toFixed(4))

  const alignedA = interpolate(a, time)
  const alignedB = interpolate(b, time)

  const diff = alignedA.map((va, i) => {
    const vb = alignedB[i]
    if (va == null || vb == null) return null
    return va - vb
  })

  const valid = diff.filter((d): d is number => d != null)
  let stats: DiffStats | null = null
  if (valid.length) {
    const sorted = [...valid].sort((x, y) => x - y)
    const avg = valid.reduce((s, v) => s + v, 0) / valid.length
    const pct = alignedA
      .map((va, i) => {
        const vb = alignedB[i]
        if (va == null || vb == null || vb === 0) return null
        return ((va - vb) / vb) * 100
      })
      .filter((d): d is number => d != null)
    stats = {
      count: valid.length,
      maxDiff: Math.max(...valid),
      minDiff: Math.min(...valid),
      avgDiff: avg,
      medianDiff: sorted[Math.floor(sorted.length / 2)],
      stdDev: stdDev(valid, avg),
      maxPct: pct.length ? Math.max(...pct) : 0,
      minPct: pct.length ? Math.min(...pct) : 0,
      avgPct: pct.length ? pct.reduce((s, v) => s + v, 0) / pct.length : 0,
    }
  }

  return { time, a: alignedA, b: alignedB, diff, stats }
}
