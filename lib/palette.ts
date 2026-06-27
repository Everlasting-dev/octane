// Distinct categorical colors used ONLY for the Analysis Plot overlay, so many
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
]

export function plotColor(i: number): string {
  return PLOT_COLORS[((i % PLOT_COLORS.length) + PLOT_COLORS.length) % PLOT_COLORS.length]
}
