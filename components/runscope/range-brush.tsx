"use client"

import { useMemo, useRef } from "react"
import { ZoomIn, ZoomOut } from "lucide-react"
import { lttb } from "@/lib/downsample"
import { cn } from "@/lib/utils"
import type { SignalSample } from "@/lib/telemetry"

const OVERVIEW_POINTS = 240
const VIEW_W = 1000
const VIEW_H = 120

export interface OverviewSeries {
  color: string
  data: SignalSample[]
}

function buildPath(data: SignalSample[], duration: number): string {
  if (!data.length || duration <= 0) return ""
  let min = Infinity
  let max = -Infinity
  for (const d of data) {
    if (d.value == null || !Number.isFinite(d.value)) continue
    if (d.value < min) min = d.value
    if (d.value > max) max = d.value
  }
  const range = max - min || 1
  let path = ""
  let started = false
  for (const d of data) {
    if (d.value == null || !Number.isFinite(d.value)) continue
    const x = (d.t / duration) * VIEW_W
    const y = VIEW_H - ((d.value - min) / range) * (VIEW_H - 8) - 4
    path += `${started ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`
    started = true
  }
  return path
}

export function RangeBrush({
  series,
  duration,
  domain,
  timeUnit,
  onChange,
  onZoomIn,
  onZoomOut,
  compact = false,
}: {
  series: OverviewSeries[]
  duration: number
  domain: [number, number]
  timeUnit: string
  onChange: (start: number, end: number) => void
  onZoomIn: () => void
  onZoomOut: () => void
  compact?: boolean
}) {
  const trackRef = useRef<HTMLDivElement>(null)

  const startFrac = duration > 0 ? domain[0] / duration : 0
  const endFrac = duration > 0 ? domain[1] / duration : 1

  function fracFromClientX(clientX: number): number {
    const el = trackRef.current
    if (!el) return 0
    const rect = el.getBoundingClientRect()
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
  }

  function startDrag(mode: "left" | "right" | "move", e: React.PointerEvent) {
    e.preventDefault()
    e.stopPropagation()
    const grabFrac = fracFromClientX(e.clientX)
    const startLeft = startFrac
    const startRight = endFrac
    const width = startRight - startLeft

    function onMove(ev: PointerEvent) {
      const f = fracFromClientX(ev.clientX)
      let l = startLeft
      let r = startRight
      if (mode === "left") l = Math.min(f, startRight - 0.01)
      else if (mode === "right") r = Math.max(f, startLeft + 0.01)
      else {
        const delta = f - grabFrac
        l = startLeft + delta
        r = startRight + delta
        if (l < 0) {
          l = 0
          r = width
        }
        if (r > 1) {
          r = 1
          l = 1 - width
        }
      }
      onChange(l * duration, r * duration)
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
  }

  const paths = useMemo(
    () => series.map((s) => ({ color: s.color, d: buildPath(lttb(s.data, OVERVIEW_POINTS), duration) })),
    [series, duration],
  )
  const leftPct = `${(startFrac * 100).toFixed(2)}%`
  const widthPct = `${((endFrac - startFrac) * 100).toFixed(2)}%`

  const track = (
    <div
      ref={trackRef}
      className={cn(
        "relative touch-none overflow-hidden rounded-md border border-border bg-card/40",
        compact ? "h-14 w-full" : "h-16 flex-1",
      )}
    >
      <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
        {paths.map((s, i) => (
          <path
            key={i}
            d={s.d}
            fill="none"
            stroke={s.color}
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
            opacity={0.85}
          />
        ))}
      </svg>

      {/* Dimmed regions outside the window */}
      <div className="absolute inset-y-0 left-0 bg-background/60" style={{ width: leftPct }} />
      <div className="absolute inset-y-0 right-0 bg-background/60" style={{ width: `${((1 - endFrac) * 100).toFixed(2)}%` }} />

      {/* Selection window */}
      <div
        className="absolute inset-y-0 cursor-grab border-x-2 border-primary/70 bg-primary/5 active:cursor-grabbing"
        style={{ left: leftPct, width: widthPct }}
        onPointerDown={(e) => startDrag("move", e)}
      >
        <div className="absolute inset-y-0 -left-1.5 w-3 cursor-ew-resize" onPointerDown={(e) => startDrag("left", e)}>
          <span className="absolute left-1/2 top-1/2 h-6 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary" />
        </div>
        <div className="absolute inset-y-0 -right-1.5 w-3 cursor-ew-resize" onPointerDown={(e) => startDrag("right", e)}>
          <span className="absolute left-1/2 top-1/2 h-6 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary" />
        </div>
      </div>

      <div className="pointer-events-none absolute bottom-1 left-2 font-mono text-[10px] text-muted-foreground">
        {domain[0].toFixed(1)}
        {timeUnit}
      </div>
      <div className="pointer-events-none absolute bottom-1 right-2 font-mono text-[10px] text-muted-foreground">
        {domain[1].toFixed(1)}
        {timeUnit}
      </div>
    </div>
  )

  if (compact) {
    return (
      <div className="flex flex-col gap-2">
        {track}
        <div className="flex items-center justify-end gap-1">
          <button
            type="button"
            onClick={onZoomOut}
            aria-label="Zoom out"
            className="inline-flex size-7 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <ZoomOut className="size-4" />
          </button>
          <button
            type="button"
            onClick={onZoomIn}
            aria-label="Zoom in"
            className="inline-flex size-7 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <ZoomIn className="size-4" />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="sticky bottom-0 z-10 flex items-center gap-3 border-t border-border bg-background/85 px-4 py-3 backdrop-blur">
      {track}
      <div className="flex shrink-0 flex-col gap-1">
        <button
          type="button"
          onClick={onZoomIn}
          aria-label="Zoom in"
          className="inline-flex size-7 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <ZoomIn className="size-4" />
        </button>
        <button
          type="button"
          onClick={onZoomOut}
          aria-label="Zoom out"
          className="inline-flex size-7 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <ZoomOut className="size-4" />
        </button>
      </div>
    </div>
  )
}
