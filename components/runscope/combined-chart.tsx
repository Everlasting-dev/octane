"use client"

import { memo, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react"
import { ChevronLeft, ChevronRight, Columns2, Maximize2, Minimize2, RotateCcw, Rows2, TrendingUp } from "lucide-react"
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
const AXIS_H = 28
const LEFT = 56
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
function applyTf(v: number | null, t: Transform): number | null {
  if (v == null) return null
  return (v - 0.5) * t.gain + 0.5 + t.offset
}

interface Peak {
  label: string
  t: number
  value: number
  norm: number
  unit: string
  decimals: number
  color: string
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
  const [highlightKey, setHighlightKey] = useState<string | null>(null)
  const [dockOpen, setDockOpen] = useState(true)
  const [fullscreen, setFullscreen] = useState(false)
  const [split, setSplit] = useState(false)
  const [plotAssign, setPlotAssign] = useState<Record<string, 0 | 1>>({})
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const bindings = useBindings()

  const labels = series.map((s) => s.signal.label)
  const colorOf = useMemo(() => {
    const m: Record<string, string> = {}
    series.forEach((s, i) => (m[s.signal.label] = plotColor(i)))
    return m
  }, [series])
  const seriesByLabel = useMemo(() => {
    const m: Record<string, ChartSeries> = {}
    series.forEach((s) => (m[s.signal.label] = s))
    return m
  }, [series])

  // Lines targeted by scale/move gestures: the multi-selection, else the focused line.
  const targetLabels = (): string[] => (selected.size ? [...selected] : focusKey ? [focusKey] : [])

  function applyGain(factor: number) {
    const targets = targetLabels()
    if (!targets.length) return
    setTransforms((prev) => {
      const next = { ...prev }
      for (const l of targets) {
        const t = next[l] ?? { gain: 1, offset: 0 }
        next[l] = { ...t, gain: +clamp(t.gain * factor, GAIN_MIN, GAIN_MAX).toFixed(3) }
      }
      return next
    })
  }
  function applyOffset(delta: number) {
    const targets = targetLabels()
    if (!targets.length) return
    setTransforms((prev) => {
      const next = { ...prev }
      for (const l of targets) {
        const t = next[l] ?? { gain: 1, offset: 0 }
        next[l] = { ...t, offset: +(t.offset + delta).toFixed(3) }
      }
      return next
    })
  }
  function resetTransform(label: string) {
    setTransforms((prev) => {
      const next = { ...prev }
      delete next[label]
      return next
    })
  }
  function toggleSelected(label: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(label)) next.delete(label)
      else next.add(label)
      return next
    })
  }

  // Windowed peak of the highlighted line.
  const peak = useMemo<Peak | null>(() => {
    if (!markPeaks || !highlightKey) return null
    const s = seriesByLabel[highlightKey]
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
      label: highlightKey,
      t: bt,
      value: bv,
      norm: (bv - s.signal.min) / range,
      unit: s.signal.unit,
      decimals: s.signal.decimals,
      color: colorOf[highlightKey],
    }
  }, [markPeaks, highlightKey, seriesByLabel, domain, colorOf])

  const shownAnnotations = useMemo(() => annotations.filter((a) => !a.channel), [annotations])

  function cycleFocus(dir: number) {
    if (!labels.length) return
    setFocusKey((prev) => {
      const idx = prev ? labels.indexOf(prev) : -1
      return labels[(idx + dir + labels.length) % labels.length]
    })
  }

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
        else {
          setFocusKey(null)
          setSelected(new Set())
        }
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [series, bindings, fullscreen]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (markPeaks && focusKey) setHighlightKey(focusKey)
  }, [focusKey, markPeaks])

  // Partition series into panes.
  const paneOf = (label: string): 0 | 1 => (split ? (plotAssign[label] ?? 0) : 0)
  const panes: ChartSeries[][] = split
    ? [series.filter((s) => paneOf(s.signal.label) === 0), series.filter((s) => paneOf(s.signal.label) === 1)]
    : [series]

  function paneAxisLabel(paneSeries: ChartSeries[]): string | null {
    if (focusKey && paneSeries.some((s) => s.signal.label === focusKey)) return focusKey
    return paneSeries[0]?.signal.label ?? null
  }
  const paneHeight = (count: number) =>
    fullscreen ? "min-h-0 flex-1" : count === 1 ? "h-[26rem]" : "h-[13rem]"

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
            {selected.size ? `${selected.size} selected` : focusKey ? `Focused: ${focusKey}` : "focus a line to scale it"}
          </span>
          <button
            type="button"
            onClick={() => setSplit((v) => !v)}
            aria-pressed={split}
            title={split ? "Single plot" : "Split into two plots"}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] transition-colors",
              split ? "border-primary bg-primary/15 text-foreground" : "border-border bg-card text-muted-foreground hover:bg-secondary",
            )}
          >
            {split ? <Rows2 className="size-3.5" /> : <Columns2 className="size-3.5" />}
            {split ? "2 plots" : "Split"}
          </button>
          <button
            type="button"
            onClick={() =>
              setMarkPeaks((v) => {
                if (v) setHighlightKey(null)
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
        <div className="flex min-w-0 flex-1 flex-col">
          {panes.map((paneSeries, p) => (
            <AnalysisPane
              key={p}
              paneSeries={paneSeries}
              domain={domain}
              sync={sync}
              cursorT={cursorT}
              display={display}
              timeUnit={timeUnit}
              transforms={transforms}
              focusKey={focusKey}
              selected={selected}
              colorOf={colorOf}
              seriesByLabel={seriesByLabel}
              axisLabel={paneAxisLabel(paneSeries)}
              peak={peak && paneSeries.some((s) => s.signal.label === peak.label) ? peak : null}
              annotateMode={annotateMode}
              markPeaks={markPeaks}
              shownAnnotations={shownAnnotations}
              heightClass={cn(paneHeight(panes.length), split && p > 0 && "border-t border-border")}
              onCursorChange={onCursorChange}
              onApplyGain={applyGain}
              onApplyOffset={applyOffset}
              onMarkNearest={setHighlightKey}
              onAddAnnotation={onAddAnnotation}
            />
          ))}
        </div>

        {/* Dock */}
        {dockOpen ? (
          <aside className="flex w-60 shrink-0 flex-col border-l border-border">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <span className="font-mono text-[11px] text-muted-foreground">
                {selected.size ? `${selected.size} selected` : cursorT != null ? `t = ${fmt(cursorT, 2)}${timeUnit}` : "Channels"}
              </span>
              <div className="flex items-center gap-1">
                {selected.size > 0 && (
                  <button
                    type="button"
                    onClick={() => setSelected(new Set())}
                    className="rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-secondary hover:text-foreground"
                  >
                    Clear
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setDockOpen(false)}
                  aria-label="Collapse panel"
                  className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-secondary hover:text-foreground"
                >
                  <ChevronRight className="size-4" />
                </button>
              </div>
            </div>
            <ul className="flex-1 overflow-y-auto py-1">
              {series.map((s) => {
                const label = s.signal.label
                const focused = focusKey === label
                const isSel = selected.has(label)
                const t = transforms[label]
                const v = cursorT != null ? nearest(s.signal.data, cursorT).value : null
                return (
                  <li
                    key={s.id}
                    className={cn("flex items-center gap-1.5 px-2 py-1.5 transition-colors", focused ? "bg-secondary" : "hover:bg-secondary/50")}
                  >
                    <button
                      type="button"
                      onClick={() => toggleSelected(label)}
                      aria-pressed={isSel}
                      title="Select for group scaling"
                      className={cn(
                        "flex size-4 shrink-0 items-center justify-center rounded border transition-colors",
                        isSel ? "border-primary bg-primary text-primary-foreground" : "border-border",
                      )}
                    >
                      {isSel && <span className="size-1.5 rounded-[1px] bg-primary-foreground" />}
                    </button>
                    <button type="button" onClick={() => setFocusKey(focused ? null : label)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                      <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: colorOf[label] }} />
                      <span className={cn("min-w-0 flex-1 truncate text-xs", focused ? "text-foreground" : "text-muted-foreground")}>{label}</span>
                    </button>
                    {split && (
                      <div className="flex shrink-0 overflow-hidden rounded border border-border text-[9px] font-mono">
                        {([0, 1] as const).map((pi) => (
                          <button
                            key={pi}
                            type="button"
                            onClick={() => setPlotAssign((prev) => ({ ...prev, [label]: pi }))}
                            className={cn("px-1", paneOf(label) === pi ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary")}
                          >
                            {pi + 1}
                          </button>
                        ))}
                      </div>
                    )}
                    {t && (
                      <button
                        type="button"
                        onClick={() => resetTransform(label)}
                        title={`Scale ×${t.gain.toFixed(1)} — reset`}
                        className="inline-flex shrink-0 items-center rounded px-1 text-[10px] font-mono text-primary hover:bg-secondary"
                      >
                        ×{t.gain.toFixed(1)}
                        <RotateCcw className="ml-0.5 size-3" />
                      </button>
                    )}
                    {!split && (
                      <span className="w-12 shrink-0 text-right font-mono text-[11px] tabular-nums" style={{ color: focused ? colorOf[label] : undefined }}>
                        {v == null ? "—" : fmt(v, s.signal.decimals)}
                      </span>
                    )}
                  </li>
                )
              })}
            </ul>
            <div className="border-t border-border px-3 py-2 text-[10px] leading-relaxed text-muted-foreground">
              Tick channels to scale several at once · Shift+scroll scales · Shift+drag moves · the left axis shows the focused line's real
              values.
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

function AnalysisPane({
  paneSeries,
  domain,
  sync,
  cursorT,
  display,
  timeUnit,
  transforms,
  focusKey,
  selected,
  colorOf,
  seriesByLabel,
  axisLabel,
  peak,
  annotateMode,
  markPeaks,
  shownAnnotations,
  heightClass,
  onCursorChange,
  onApplyGain,
  onApplyOffset,
  onMarkNearest,
  onAddAnnotation,
}: {
  paneSeries: ChartSeries[]
  domain: [number, number]
  sync: boolean
  cursorT: number | null
  display: DisplaySettings
  timeUnit: string
  transforms: Record<string, Transform>
  focusKey: string | null
  selected: Set<string>
  colorOf: Record<string, string>
  seriesByLabel: Record<string, ChartSeries>
  axisLabel: string | null
  peak: Peak | null
  annotateMode: boolean
  markPeaks: boolean
  shownAnnotations: Annotation[]
  heightClass: string
  onCursorChange: (t: number | null) => void
  onApplyGain: (factor: number) => void
  onApplyOffset: (delta: number) => void
  onMarkNearest: (label: string) => void
  onAddAnnotation: (t: number, channel: string) => void
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ moved: boolean } | null>(null)
  const clickRef = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  const offsetDragRef = useRef<{ startY: number } | null>(null)
  // latest gesture handlers (so the wheel listener binds once)
  const gainRef = useRef(onApplyGain)
  gainRef.current = onApplyGain

  const tf = (label: string): Transform => transforms[label] ?? { gain: 1, offset: 0 }

  const { rows, keys } = useMemo(() => {
    const map = new Map<number, Record<string, number | null>>()
    paneSeries.forEach((s, si) => {
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
    return { rows: [...map.values()].sort((a, b) => (a.t as number) - (b.t as number)), keys: paneSeries.map((_, i) => `k${i}`) }
  }, [paneSeries])

  // Shift+scroll → scale targeted lines (non-passive listener).
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    function onWheel(e: WheelEvent) {
      if (!e.shiftKey) return
      e.preventDefault()
      gainRef.current(e.deltaY < 0 ? 1.12 : 1 / 1.12)
    }
    el.addEventListener("wheel", onWheel, { passive: false })
    return () => el.removeEventListener("wheel", onWheel)
  }, [])

  function pointerToT(clientX: number) {
    const r = wrapRef.current!.getBoundingClientRect()
    const w = Math.max(1, r.width - LEFT - RIGHT)
    return +clamp(domain[0] + ((clientX - r.left - LEFT) / w) * (domain[1] - domain[0]), domain[0], domain[1]).toFixed(3)
  }
  function usableH() {
    return Math.max(1, (wrapRef.current?.getBoundingClientRect().height ?? 300) - AXIS_H - PLOT_TOP)
  }

  function markNearest(clientX: number, clientY: number) {
    const r = wrapRef.current!.getBoundingClientRect()
    const ratio = clamp(1 - (clientY - r.top - PLOT_TOP) / usableH(), 0, 1)
    const t = pointerToT(clientX)
    if (!rows.length) return
    const row = rows.reduce((best, x) => (Math.abs((x.t as number) - t) < Math.abs((best.t as number) - t) ? x : best), rows[0])
    let bestLabel = paneSeries[0]?.signal.label
    let bd = Infinity
    keys.forEach((k, i) => {
      const label = paneSeries[i].signal.label
      const disp = applyTf(row?.[k] ?? null, tf(label))
      if (disp == null) return
      const d = Math.abs(disp - ratio)
      if (d < bd) {
        bd = d
        bestLabel = label
      }
    })
    if (bestLabel) onMarkNearest(bestLabel)
  }

  function onPointerDown(e: React.PointerEvent) {
    if (!wrapRef.current) return
    if (e.shiftKey) {
      e.preventDefault()
      offsetDragRef.current = { startY: e.clientY }
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
    if (offsetDragRef.current) {
      const dy = e.clientY - offsetDragRef.current.startY
      offsetDragRef.current.startY = e.clientY
      onApplyOffset(-dy / usableH())
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
        if (annotateMode) onAddAnnotation(pointerToT(e.clientX), "")
        else if (markPeaks) markNearest(e.clientX, e.clientY)
      }
      return
    }
    dragRef.current = null
  }

  const activeSet = new Set(selected)
  if (focusKey) activeSet.add(focusKey)
  const hasActive = activeSet.size > 0

  // Real-units Y axis for the pane's axis channel.
  const axisSig = axisLabel ? seriesByLabel[axisLabel] : null
  const axisColor = axisLabel ? colorOf[axisLabel] : "var(--muted-foreground)"
  function realAt(y: number): string {
    if (!axisSig) return ""
    const t = tf(axisLabel!)
    const range = axisSig.signal.max - axisSig.signal.min || 1
    const norm = (y - 0.5 - t.offset) / t.gain + 0.5
    const real = axisSig.signal.min + range * norm
    return fmt(real, Math.abs(real) >= 100 ? 0 : axisSig.signal.decimals <= 1 ? 1 : 2)
  }

  const peakDispY = peak ? clamp(applyTf(peak.norm, tf(peak.label)) ?? peak.norm, 0.06, 0.94) : 0

  return (
    <div
      ref={wrapRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      className={cn(
        "relative w-full touch-none select-none px-2",
        heightClass,
        annotateMode ? "cursor-crosshair" : "cursor-ew-resize",
      )}
    >
      {axisLabel && axisSig && (
        <span className="pointer-events-none absolute left-2 top-1 z-10 font-mono text-[10px]" style={{ color: axisColor }}>
          {axisLabel}
          {axisSig.signal.unit !== "—" ? ` (${axisSig.signal.unit})` : ""}
        </span>
      )}
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
          <YAxis
            width={LEFT}
            domain={[0, 1]}
            allowDataOverflow
            ticks={[0, 0.25, 0.5, 0.75, 1]}
            tickLine={false}
            axisLine={false}
            tick={axisSig ? { fill: axisColor, fontSize: 10 } : false}
            tickFormatter={axisSig ? realAt : undefined}
          />
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
            const label = paneSeries[i].signal.label
            const isActive = activeSet.has(label)
            return (
              <Area
                key={key}
                type={display.curve}
                dataKey={(d: Record<string, number | null>) => applyTf(d[key] ?? null, tf(label))}
                name={label}
                stroke={colorOf[label]}
                strokeWidth={isActive ? display.lineWidth + 1 : display.lineWidth}
                strokeOpacity={!hasActive || isActive || !display.focusDim ? 1 : 0.22}
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
  )
}

export const CombinedChart = memo(CombinedChartImpl)
