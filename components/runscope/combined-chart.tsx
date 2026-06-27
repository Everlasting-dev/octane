"use client"

import { memo, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react"
import { ChevronLeft, ChevronRight, Maximize2, Minimize2, RotateCcw, TrendingUp } from "lucide-react"
import { Area, AreaChart, CartesianGrid, ReferenceDot, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from "recharts"
import { lttb } from "@/lib/downsample"
import { cn } from "@/lib/utils"
import { plotColor } from "@/lib/palette"
import { matchesKey, useBindings } from "@/lib/keybindings"
import { colorForType, type Annotation } from "@/lib/annotations"
import type { ChartSeries } from "./signal-chart"
import type { DisplaySettings } from "./display-panel"

const RENDER_POINTS = 700
const PLOT_TOP = 10
const AXIS_H = 28 // approx x-axis band height
const LEFT = 40
const RIGHT = 16
const GAIN_MIN = 0.2
const GAIN_MAX = 20

export interface Transform {
  gain: number
  offset: number
}

interface CombinedChartProps {
  series: ChartSeries[]
  domain: [number, number]
  sync: boolean
  cursorT: number | null
  display: DisplaySettings
  timeUnit: string
  annotations: Annotation[]
  annotateMode: boolean
  // Persisted across view switches (owned by the dashboard).
  transforms: Record<string, Transform>
  setTransforms: Dispatch<SetStateAction<Record<string, Transform>>>
  focusKey: string | null
  setFocusKey: Dispatch<SetStateAction<string | null>>
  markPeaks: boolean
  setMarkPeaks: Dispatch<SetStateAction<boolean>>
  onCursorChange: (t: number | null) => void
  onAddAnnotation: (t: number, channel: string) => void
}

function fmt(v: number, decimals: number) {
  return v.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}
function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v))
}
function nearest(data: ChartSeries["signal"]["data"], t: number) {
  let best = data[0]
  let bestDist = Infinity
  for (const d of data) {
    const dist = Math.abs(d.t - t)
    if (dist < bestDist) {
      bestDist = dist
      best = d
    }
  }
  return best
}

function CombinedChartImpl({
  series,
  domain,
  sync,
  cursorT,
  display,
  timeUnit,
  annotations,
  annotateMode,
  transforms,
  setTransforms,
  focusKey,
  setFocusKey,
  markPeaks,
  setMarkPeaks,
  onCursorChange,
  onAddAnnotation,
}: CombinedChartProps) {
  const [highlightI, setHighlightI] = useState<number | null>(null)
  const [dockOpen, setDockOpen] = useState(true)
  const [fullscreen, setFullscreen] = useState(false)
  const bindings = useBindings()

  const wrapRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ moved: boolean } | null>(null)
  const clickRef = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  const offsetDragRef = useRef<{ startY: number; startOffset: number } | null>(null)

  const labels = series.map((s) => s.signal.label)

  function tf(label: string): Transform {
    return transforms[label] ?? { gain: 1, offset: 0 }
  }
  function applyTf(v: number | null, label: string): number | null {
    if (v == null) return null
    const t = tf(label)
    return (v - 0.5) * t.gain + 0.5 + t.offset
  }

  // Normalise each channel to 0..1 (base), merged by timestamp.
  const { rows, keys } = useMemo(() => {
    const map = new Map<number, Record<string, number | null>>()
    series.forEach((s, si) => {
      const key = `k${si}`
      const range = s.signal.max - s.signal.min || 1
      for (const d of lttb(s.signal.data, RENDER_POINTS)) {
        let row = map.get(d.t)
        if (!row) {
          row = { t: d.t }
          map.set(d.t, row)
        }
        row[key] = d.value == null ? null : (d.value - s.signal.min) / range
      }
    })
    return { rows: [...map.values()].sort((a, b) => (a.t as number) - (b.t as number)), keys: series.map((_, i) => `k${i}`) }
  }, [series])

  // Windowed peak of the highlighted (mark-peaks) line.
  const peak = useMemo(() => {
    if (!markPeaks || highlightI == null) return null
    const s = series[highlightI]
    if (!s) return null
    const [lo, hi] = domain
    let bt: number | null = null
    let bv = -Infinity
    for (const d of s.signal.data) {
      if (d.value == null || !Number.isFinite(d.value)) continue
      if (d.t < lo || d.t > hi) continue
      if (d.value > bv) {
        bv = d.value
        bt = d.t
      }
    }
    if (bt == null) return null
    const range = s.signal.max - s.signal.min || 1
    return {
      t: bt,
      value: bv,
      norm: (bv - s.signal.min) / range,
      label: s.signal.label,
      unit: s.signal.unit,
      decimals: s.signal.decimals,
      color: plotColor(highlightI),
    }
  }, [markPeaks, highlightI, series, domain])

  const shownAnnotations = useMemo(() => annotations.filter((a) => !a.channel), [annotations])

  function cycleFocus(dir: number) {
    if (!labels.length) return
    setFocusKey((prev) => {
      const idx = prev ? labels.indexOf(prev) : -1
      return labels[(idx + dir + labels.length) % labels.length]
    })
  }

  // Remappable plot shortcuts.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return
      if (matchesKey(e, bindings.focusNext)) {
        e.preventDefault()
        cycleFocus(1)
      } else if (matchesKey(e, bindings.focusPrev)) {
        e.preventDefault()
        cycleFocus(-1)
      } else if (matchesKey(e, bindings.peakToggle)) {
        e.preventDefault()
        setMarkPeaks((v) => !v)
      } else if (matchesKey(e, bindings.fullscreen)) {
        e.preventDefault()
        setFullscreen((v) => !v)
      } else if (e.key === "Escape") {
        if (fullscreen) setFullscreen(false)
        else setFocusKey(null)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [series, bindings, fullscreen]) // eslint-disable-line react-hooks/exhaustive-deps

  // When Mark-peaks is on, the focused line's peak is highlighted automatically.
  useEffect(() => {
    if (markPeaks && focusKey) setHighlightI(labels.indexOf(focusKey))
  }, [focusKey, markPeaks]) // eslint-disable-line react-hooks/exhaustive-deps

  // Shift+scroll = gain on the focused line (non-passive so we can preventDefault).
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    function onWheel(e: WheelEvent) {
      if (!e.shiftKey || !focusKey) return
      e.preventDefault()
      setTransforms((prev) => {
        const t = prev[focusKey] ?? { gain: 1, offset: 0 }
        const gain = clamp(t.gain * (e.deltaY < 0 ? 1.12 : 1 / 1.12), GAIN_MIN, GAIN_MAX)
        return { ...prev, [focusKey]: { ...t, gain: +gain.toFixed(3) } }
      })
    }
    el.addEventListener("wheel", onWheel, { passive: false })
    return () => el.removeEventListener("wheel", onWheel)
  }, [focusKey])

  function pointerToT(clientX: number) {
    const r = wrapRef.current!.getBoundingClientRect()
    const w = Math.max(1, r.width - LEFT - RIGHT)
    return +clamp(domain[0] + ((clientX - r.left - LEFT) / w) * (domain[1] - domain[0]), domain[0], domain[1]).toFixed(3)
  }

  function markNearest(clientX: number, clientY: number) {
    const r = wrapRef.current!.getBoundingClientRect()
    const usable = Math.max(1, r.height - AXIS_H - PLOT_TOP)
    const ratio = clamp(1 - (clientY - r.top - PLOT_TOP) / usable, 0, 1)
    const t = pointerToT(clientX)
    const row = rows.reduce((best, x) => (Math.abs((x.t as number) - t) < Math.abs((best.t as number) - t) ? x : best), rows[0])
    let bi = 0
    let bd = Infinity
    keys.forEach((k, i) => {
      const disp = applyTf(row?.[k] ?? null, series[i].signal.label)
      if (disp == null) return
      const d = Math.abs(disp - ratio)
      if (d < bd) {
        bd = d
        bi = i
      }
    })
    setHighlightI(bi)
  }

  function onPointerDown(e: React.PointerEvent) {
    if (!wrapRef.current) return
    if (e.shiftKey && focusKey) {
      e.preventDefault()
      offsetDragRef.current = { startY: e.clientY, startOffset: tf(focusKey).offset }
      wrapRef.current.setPointerCapture(e.pointerId)
      return
    }
    if (annotateMode || markPeaks) {
      clickRef.current = { x: e.clientX, y: e.clientY, moved: false }
      wrapRef.current.setPointerCapture(e.pointerId)
      return
    }
    dragRef.current = { moved: false }
    wrapRef.current.setPointerCapture(e.pointerId)
    onCursorChange(pointerToT(e.clientX))
  }
  function onPointerMove(e: React.PointerEvent) {
    if (offsetDragRef.current && focusKey) {
      const usable = Math.max(1, (wrapRef.current?.getBoundingClientRect().height ?? 416) - AXIS_H - PLOT_TOP)
      const dy = e.clientY - offsetDragRef.current.startY
      const offset = offsetDragRef.current.startOffset - dy / usable
      setTransforms((prev) => ({ ...prev, [focusKey]: { ...(prev[focusKey] ?? { gain: 1, offset: 0 }), offset: +offset.toFixed(3) } }))
      return
    }
    if (clickRef.current) {
      if (Math.abs(e.clientX - clickRef.current.x) > 3 || Math.abs(e.clientY - clickRef.current.y) > 3) clickRef.current.moved = true
      return
    }
    if (dragRef.current) {
      dragRef.current.moved = true
      onCursorChange(pointerToT(e.clientX))
    }
  }
  function onPointerUp(e: React.PointerEvent) {
    if (offsetDragRef.current) {
      offsetDragRef.current = null
      return
    }
    if (clickRef.current) {
      const c = clickRef.current
      clickRef.current = null
      if (!c.moved) {
        const t = pointerToT(e.clientX)
        if (annotateMode) onAddAnnotation(t, "")
        else if (markPeaks) markNearest(e.clientX, e.clientY)
      }
      return
    }
    dragRef.current = null
  }

  function resetTransform(label: string) {
    setTransforms((prev) => {
      const next = { ...prev }
      delete next[label]
      return next
    })
  }

  // Keep the peak dot + its value inside the plot area even when the line is scaled.
  const peakDispY = peak ? clamp(applyTf(peak.norm, peak.label) ?? peak.norm, 0.06, 0.94) : 0

  return (
    <section
      className={cn(
        "overflow-hidden border border-border bg-card/60",
        fullscreen ? "fixed inset-0 z-50 flex flex-col rounded-none" : "rounded-xl",
      )}
    >
      <header className="flex items-center justify-between gap-3 px-4 py-3">
        <h3 className="text-sm font-semibold text-foreground">Analysis Plot</h3>
        <div className="flex items-center gap-2">
          <span className="mr-1 hidden font-mono text-[11px] text-muted-foreground lg:inline">
            {focusKey ? `Focused: ${focusKey}` : "focus a line to scale it"}
          </span>
          <button
            type="button"
            onClick={() =>
              setMarkPeaks((v) => {
                if (v) setHighlightI(null)
                return !v
              })
            }
            aria-pressed={markPeaks}
            title="Mark the focused line's peak"
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] transition-colors",
              markPeaks ? "border-primary bg-primary/15 text-foreground" : "border-border bg-card text-muted-foreground hover:bg-secondary",
            )}
          >
            <TrendingUp className="size-3.5" />
            Mark peaks
          </button>
          <button
            type="button"
            onClick={() => setFullscreen((v) => !v)}
            aria-pressed={fullscreen}
            title={fullscreen ? "Exit fullscreen (Esc)" : "Fullscreen plot"}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-secondary"
          >
            {fullscreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
            {fullscreen ? "Exit" : "Fullscreen"}
          </button>
        </div>
      </header>

      <div className={cn("flex border-t border-border", fullscreen && "min-h-0 flex-1")}>
        {/* Plot */}
        <div
          ref={wrapRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          className={cn(
            "relative min-w-0 flex-1 touch-none select-none px-2",
            fullscreen ? "h-full" : "h-[26rem]",
            annotateMode ? "cursor-crosshair" : markPeaks ? "cursor-pointer" : "cursor-ew-resize",
          )}
        >
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={rows} margin={{ top: PLOT_TOP, right: RIGHT, left: 4, bottom: 4 }}>
              {display.showGrid && (
                <CartesianGrid stroke="var(--muted-foreground)" strokeOpacity={0.22} strokeDasharray="2 4" vertical horizontal />
              )}
              <XAxis
                dataKey="t"
                type="number"
                domain={domain}
                allowDataOverflow
                tickLine={false}
                axisLine={{ stroke: "var(--border)" }}
                tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                minTickGap={40}
                unit={timeUnit}
              />
              <YAxis width={LEFT} domain={[0, 1]} allowDataOverflow tickLine={false} axisLine={false} tick={false} />
              {sync && cursorT != null && (
                <ReferenceLine x={cursorT} stroke="var(--muted-foreground)" strokeOpacity={0.7} strokeDasharray="4 3" />
              )}
              {shownAnnotations.map((a) => (
                <ReferenceLine
                  key={a.id}
                  x={a.t}
                  stroke={colorForType(a.type)}
                  strokeWidth={1.5}
                  label={{ value: a.type, position: "insideTopLeft", fontSize: 10, fill: colorForType(a.type) }}
                />
              ))}
              {keys.map((key, i) => {
                const label = series[i].signal.label
                const focused = focusKey === label
                return (
                  <Area
                    key={key}
                    type={display.curve}
                    dataKey={(d: Record<string, number | null>) => applyTf(d[key] ?? null, label)}
                    name={label}
                    stroke={plotColor(i)}
                    strokeWidth={focused ? display.lineWidth + 1 : display.lineWidth}
                    strokeOpacity={focusKey == null || focused || !display.focusDim ? 1 : 0.22}
                    fill="none"
                    dot={false}
                    activeDot={false}
                    isAnimationActive={false}
                    connectNulls
                  />
                )
              })}
              {peak && (
                <ReferenceDot
                  x={peak.t}
                  y={peakDispY}
                  r={5}
                  fill={peak.color}
                  stroke="var(--background)"
                  strokeWidth={2}
                  isFront
                  label={{
                    value: `▲ ${fmt(peak.value, peak.decimals)}${peak.unit !== "—" ? " " + peak.unit : ""}`,
                    position: peakDispY > 0.6 ? "bottom" : "top",
                    fontSize: 11,
                    fontWeight: 600,
                    fill: peak.color,
                  }}
                />
              )}
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Collapsible value/scale dock */}
        {dockOpen ? (
          <aside className="flex w-56 shrink-0 flex-col border-l border-border">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <span className="font-mono text-[11px] text-muted-foreground">
                {cursorT != null ? `t = ${fmt(cursorT, 2)}${timeUnit}` : "Channels"}
              </span>
              <button
                type="button"
                onClick={() => setDockOpen(false)}
                aria-label="Collapse panel"
                className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-secondary hover:text-foreground"
              >
                <ChevronRight className="size-4" />
              </button>
            </div>
            <ul className="flex-1 overflow-y-auto py-1">
              {series.map((s, i) => {
                const label = s.signal.label
                const focused = focusKey === label
                const t = transforms[label]
                const v = cursorT != null ? nearest(s.signal.data, cursorT).value : null
                return (
                  <li key={s.id}>
                    <div
                      className={cn(
                        "flex items-center gap-2 px-3 py-1.5 transition-colors",
                        focused ? "bg-secondary" : "hover:bg-secondary/50",
                      )}
                    >
                      <button type="button" onClick={() => setFocusKey(focused ? null : label)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                        <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: plotColor(i) }} />
                        <span className={cn("min-w-0 flex-1 truncate text-xs", focused ? "text-foreground" : "text-muted-foreground")}>{label}</span>
                      </button>
                      {t && (
                        <button
                          type="button"
                          onClick={() => resetTransform(label)}
                          title={`Scale ×${t.gain.toFixed(1)} — reset`}
                          className="inline-flex shrink-0 items-center gap-0.5 rounded px-1 text-[10px] font-mono text-primary hover:bg-secondary"
                        >
                          ×{t.gain.toFixed(1)}
                          <RotateCcw className="size-3" />
                        </button>
                      )}
                      <span className="w-14 shrink-0 text-right font-mono text-[11px] tabular-nums" style={{ color: focused ? plotColor(i) : undefined }}>
                        {v == null ? "—" : fmt(v, s.signal.decimals)}
                      </span>
                    </div>
                  </li>
                )
              })}
            </ul>
            <div className="border-t border-border px-3 py-2 text-[10px] leading-relaxed text-muted-foreground">
              Click a channel or press <kbd className="font-mono">[</kbd>/<kbd className="font-mono">]</kbd> to focus. Shift+scroll
              scales it; Shift+drag moves it.
            </div>
          </aside>
        ) : (
          <button
            type="button"
            onClick={() => setDockOpen(true)}
            aria-label="Expand panel"
            className="flex w-7 shrink-0 items-center justify-center border-l border-border text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <ChevronLeft className="size-4" />
          </button>
        )}
      </div>
    </section>
  )
}

export const CombinedChart = memo(CombinedChartImpl)
