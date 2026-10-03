// Distinct categorical colors used for the Analysis Plot overlay, so many
// channels on one chart are easy to tell apart. The rest of the app stays mono.

export const PLOT_COLORS = [
  "#4aa8ff", // blue
  "#4cd397", // green
  "#ffb454", // amber
  "#ff6b6b", // red
  "#b18cff", // purple
  "#3fd0d0", // teal
  "#f774c4", // pink
  "#a3d35a", // lime
  "#ff9f45", // orange
  "#7aa2ff", // indigo
  "#ffe066", // yellow
  "#e0e0e0", // white-ish
  "#c08457", // brown
  "#00e5ff", // cyan
  "#ff4fa0", // magenta
  "#8be9a8", // mint
]

/** Colors for files in Compare (file A, B, C…). Shared by every compare view. */
export const COMPARE_FILE_COLORS = ["#4aa8ff", "#4cd397", "#ffb454", "#ff6b6b", "#b18cff"]

/** Nth distinct color: the curated palette first, then golden-angle hues. */
export function plotColor(i: number): string {
  const n = Math.max(0, Math.floor(i))
  if (n < PLOT_COLORS.length) return PLOT_COLORS[n]
  const hue = Math.round(((n - PLOT_COLORS.length) * 137.508 + 23) % 360)
  const light = 58 + ((n - PLOT_COLORS.length) % 3) * 8
  return `hsl(${hue} 85% ${light}%)`
}

/** Every color the picker can offer (curated palette). */
export function paletteChoices(): string[] {
  return [...PLOT_COLORS]
}

/**
 * Give every visible line its own color.
 * - A user override wins (unless another visible line already claimed it).
 * - A line keeps the color it had before (prev) when it's still free, so
 *   toggling one channel doesn't repaint the others.
 * - Otherwise it takes the first palette color no visible line is using.
 */
export function assignLineColors(
  labels: string[],
  overrides: Record<string, string | undefined> = {},
  prev: Record<string, string> = {},
): Record<string, string> {
  const out: Record<string, string> = {}
  const used = new Set<string>()
  const norm = (c: string) => c.trim().toLowerCase()

  // Pass 1: user overrides.
  for (const label of labels) {
    const o = overrides[label]
    if (o && !used.has(norm(o))) {
      out[label] = o
      used.add(norm(o))
    }
  }
  // Pass 2: keep previous colors where still free.
  for (const label of labels) {
    if (out[label]) continue
    const p = prev[label]
    if (p && !used.has(norm(p))) {
      out[label] = p
      used.add(norm(p))
    }
  }
  // Pass 3: first free palette color.
  let cursor = 0
  for (const label of labels) {
    if (out[label]) continue
    while (used.has(norm(plotColor(cursor)))) cursor++
    out[label] = plotColor(cursor)
    used.add(norm(out[label]))
    cursor++
  }
  return out
}
