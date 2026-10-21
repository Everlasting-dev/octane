// Largest-Triangle-Three-Buckets downsampling. Keeps the visual shape (peaks,
// dips) of a series while cutting point count, so we can plot huge logs fast.

import type { SignalSample } from "./telemetry"

export function lttb(data: SignalSample[], threshold: number): SignalSample[] {
  const n = data.length
  if (threshold >= n || threshold <= 2) return data

  const sampled: SignalSample[] = []
  const bucketSize = (n - 2) / (threshold - 2)

  let a = 0 // initially the first point
  sampled.push(data[0])

  for (let i = 0; i < threshold - 2; i++) {
    // Next bucket's average point (used as the third triangle vertex).
    const avgRangeStart = Math.floor((i + 1) * bucketSize) + 1
    const avgRangeEnd = Math.min(Math.floor((i + 2) * bucketSize) + 1, n)
    let avgX = 0
    let avgY = 0
    let avgCount = 0
    for (let j = avgRangeStart; j < avgRangeEnd; j++) {
      const v = data[j].value
      if (!Number.isFinite(v)) continue
      avgX += data[j].t
      avgY += v
      avgCount++
    }
    if (avgCount) {
      avgX /= avgCount
      avgY /= avgCount
    } else {
      avgX = data[Math.min(avgRangeStart, n - 1)].t
      avgY = 0
    }

    // Current bucket range.
    const rangeStart = Math.floor(i * bucketSize) + 1
    const rangeEnd = Math.floor((i + 1) * bucketSize) + 1

    const pax = data[a].t
    const pay = Number.isFinite(data[a].value) ? data[a].value : 0

    let maxArea = -1
    let chosen = rangeStart
    for (let j = rangeStart; j < rangeEnd && j < n; j++) {
      const y = Number.isFinite(data[j].value) ? data[j].value : 0
      const area = Math.abs((pax - avgX) * (y - pay) - (pax - data[j].t) * (avgY - pay)) * 0.5
      if (area > maxArea) {
        maxArea = area
        chosen = j
      }
    }
    sampled.push(data[chosen])
    a = chosen
  }

  sampled.push(data[n - 1])
  return sampled
}

// ---------------------------------------------------------------------------
// Window-aware rendering. Downsampling the whole log once meant a zoomed-in
// window only had a handful of points, so the drawn line was far smoother than
// the real readings while the cursor dot (full resolution) jumped off it.

/**
 * The range to render for a visible window: the window snapped to a coarse
 * grid and padded by half a window each side, so panning and gliding reuse the
 * same points (no shimmer) until the window moves a quarter of its width.
 */
export function renderRange(domain: [number, number]): [number, number] {
  const w = domain[1] - domain[0]
  if (!(w > 0)) return domain
  const level = Math.pow(2, Math.ceil(Math.log2(w)))
  const step = level / 4
  const start = Math.floor(domain[0] / step) * step - level / 2
  return [start, start + level * 2]
}

/** Samples inside [t0, t1] plus one on each side (so the line reaches the edges). */
export function sliceRange(data: SignalSample[], t0: number, t1: number): SignalSample[] {
  const n = data.length
  if (!n) return data
  let lo = 0
  let hi = n
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (data[mid].t < t0) lo = mid + 1
    else hi = mid
  }
  const a = Math.max(0, lo - 1)
  lo = a
  hi = n
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (data[mid].t <= t1) lo = mid + 1
    else hi = mid
  }
  const b = Math.min(n, lo + 1)
  return a === 0 && b === n ? data : data.slice(a, b)
}

/** Points to draw for one series over a render range (full resolution when they fit). */
export function renderPoints(data: SignalSample[], range: [number, number], points: number): SignalSample[] {
  return lttb(sliceRange(data, range[0], range[1]), points)
}

export type LineCurve = "monotone" | "linear" | "step"

/**
 * Value of the drawn line at time t: the same interpolation Recharts uses for
 * that curve type (d3 curveMonotoneX / curveLinear / curveStep) over the same
 * rendered points, with nulls skipped (the charts use connectNulls). This is
 * where the cursor dot belongs; the readout keeps the real sample value.
 */
export function lineValueAt(points: SignalSample[], t: number, curve: LineCurve): number | null {
  const pts = points.filter((p) => p.value != null && Number.isFinite(p.value))
  const n = pts.length
  if (!n) return null
  if (t <= pts[0].t) return pts[0].value
  if (t >= pts[n - 1].t) return pts[n - 1].value
  let lo = 0
  let hi = n - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (pts[mid].t <= t) lo = mid
    else hi = mid
  }
  const p0 = pts[lo]
  const p1 = pts[hi]
  const dx = p1.t - p0.t
  if (!(dx > 0)) return p0.value
  const u = (t - p0.t) / dx
  // d3 curveStep: the step happens halfway between the two points.
  if (curve === "step") return u < 0.5 ? p0.value : p1.value
  if (curve === "linear" || n < 3) return p0.value + (p1.value - p0.value) * u

  // d3 curveMonotoneX (Steffen): tangents per point, Hermite segment. The
  // Bezier x control points are evenly spaced, so x is linear in u.
  const slope = (i: number) => {
    const prev = pts[i - 1]
    const cur = pts[i]
    const next = pts[i + 1]
    if (prev && next) {
      const h0 = cur.t - prev.t
      const h1 = next.t - cur.t
      const s0 = (cur.value - prev.value) / (h0 || (h1 < 0 ? -0 : 0))
      const s1 = (next.value - cur.value) / (h1 || (h0 < 0 ? -0 : 0))
      const q = (s0 * h1 + s1 * h0) / (h0 + h1)
      const sign = (x: number) => (x < 0 ? -1 : 1)
      return (sign(s0) + sign(s1)) * Math.min(Math.abs(s0), Math.abs(s1), 0.5 * Math.abs(q)) || 0
    }
    return NaN
  }
  let m0 = slope(lo)
  let m1 = slope(hi)
  const secant = (p1.value - p0.value) / dx
  // end points: d3 slope2 (from the neighbour's tangent)
  if (!Number.isFinite(m0)) m0 = Number.isFinite(m1) ? (3 * secant - m1) / 2 : secant
  if (!Number.isFinite(m1)) m1 = Number.isFinite(m0) ? (3 * secant - m0) / 2 : secant
  const c1 = p0.value + (dx * m0) / 3
  const c2 = p1.value - (dx * m1) / 3
  const v = 1 - u
  return v * v * v * p0.value + 3 * v * v * u * c1 + 3 * v * u * u * c2 + u * u * u * p1.value
}
