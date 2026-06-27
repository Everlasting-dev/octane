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
