"use client"

import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from "react"
import { ChevronDown, Crosshair, MapPin } from "lucide-react"
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts"
import { cn } from "@/lib/utils"
import type { Signal } from "@/lib/telemetry"
import type { DisplaySettings } from "./display-panel"
import type { DiffStats } from "@/lib/compare"
import { lttb } from "@/lib/downsample"
import { colorForType, type Annotation } from "@/lib/annotations"
import { decodeValue, decoderFor, describe, stepValueAt, useFlagDecoders } from "@/lib/flag-decoders"

const HEIGHT_CLASS: Record<DisplaySettings["height"], string> = {
  mini: "h-20 sm:h-24",
  compact: "h-32 sm:h-36",
  normal: "h-44 sm:h-52",
  tall: "h-60 sm:h-72",
}

// Max points rendered per series. LTTB keeps the visual shape.
const RENDER_POINTS = 700

// Approx card heights so off-screen charts reserve space (content-visibility).
const INTRINSIC: Record<DisplaySettings["height"], number> = { mini: 170, compact: 230, normal: 300, tall: 360 }
export const CHART_INTRINSIC_HEIGHT = INTRINSIC
/** Minimum horizontal drag (px) before a window-mode drag counts. */
const WINDOW_DRAG_PX = 6
// Plot-area geometry, matching the AreaChart below: wrapper px-2 (8px),
// margins top 8 / right 16 / left 4 / bottom 4, x-axis band 30px.
const PAD_X = 8
const M_TOP = 8
const M_RIGHT = 16
const M_LEFT = 4
const AXIS_BAND = 30 + 4

export interface ChartSeries {
  id: string
  name: string
  color: string
  signal: Signal
}

interface SignalChartProps {
  channelKey: string
  domId?: string
  label: string
  unit: string
  decimals: number
  series: ChartSeries[]
  domain: [number, number]
  sync: boolean
  cursorT: number | null
  collapsed: boolean
  display: DisplaySettings
  timeUnit: string
  annotations: Annotation[]
  annotateMode: boolean
  diffStats?: DiffStats | null
  onToggleCollapse: (key: string) => void
  onCursorChange: (t: number | null) => void
  onAddAnnotation: (t: number, channel: string) => void
  /** Window mode: drag across the plot to set the shared time window. */
  windowMode?: boolean
  onWindowSelect?: (start: number, end: number) => void
  onWindowReset?: () => void
}

function fmt(v: number, decimals: number) {
  return v.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v))
}

function unitText(unit: string) {
  return unit && unit !== "—" && unit !== "â€”" ? unit : ""
}

function nearest(data: Signal["data"], t: number) {
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

function sampleAt(data: Signal["data"], t: number): { t: number; value: number | null } | null {
  if (!data.length) return null
  if (t <= data[0].t) return data[0]
  const last = data[data.length - 1]
  if (t >= last.t) return last

  let lo = 0
  let hi = data.length - 1
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2)
    const mt = data[mid].t
    if (mt === t) return data[mid]
    if (mt < t) lo = mid + 1
    else hi = mid - 1
  }

  const left = data[Math.max(0, hi)]
  const right = data[Math.min(data.length - 1, lo)]
  if (left.value == null || right.value == null || right.t === left.t) return nearest(data, t)
  const ratio = (t - left.t) / (right.t - left.t)
  return { t, value: left.value + (right.value - left.value) * ratio }
}

function SignalChartImpl({
  channelKey,
  domId,
  label,
  unit,
  decimals,
  series,
  domain,
  sync,
  cursorT,
  collapsed,
  display,
  timeUnit,
  annotations,
  annotateMode,
  diffStats,
  onToggleCollapse,
  onCursorChange,
  onAddAnnotation,
  windowMode = false,
  onWindowSelect,
  onWindowReset,
}: SignalChartProps) {
  const isCompare = series.length > 1
  const primary = series[0]
  const chartRef = useRef<HTMLDivElement>(null)
  const [localCursorT, setLocalCursorT] = useState<number | null>(null)
  const winRef = useRef<{ startX: number; t0: number; moved: boolean } | null>(null)
  const [winSel, setWinSel] = useState<[number, number] | null>(null)
  const effectiveCursorT = sync ? cursorT : localCursorT
  const yAxisWidth = unitText(unit) ? 58 : 44

  // Explicit y range, rounded out to clean steps (like Recharts' "auto"), so the
  // cursor overlay can place its dot without asking Recharts; the chart itself
  // never re-renders for cursor moves.
  const { yDomain, yTicks } = useMemo(() => {
    let lo = Infinity
    let hi = -Infinity
    for (const s of series) {
      if (Number.isFinite(s.signal.min)) lo = Math.min(lo, s.signal.min)
      if (Number.isFinite(s.signal.max)) hi = Math.max(hi, s.signal.max)
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { yDomain: [0, 1] as [number, number], yTicks: [0, 0.5, 1] }
    if (hi === lo) {
      lo -= 1
      hi += 1
    }
    const raw = (hi - lo) / 4
    const pow = Math.pow(10, Math.floor(Math.log10(raw)))
    const m = raw / pow
    const step = (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * pow
    const a = Math.floor(lo / step) * step
    const b = Math.ceil(hi / step) * step
    const ticks: number[] = []
    for (let v = a; v <= b + step / 2; v += step) ticks.push(+v.toPrecision(12))
    return { yDomain: [a, b] as [number, number], yTicks: ticks }
  }, [series])

  const [box, setBox] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = chartRef.current
    if (!el || typeof ResizeObserver === "undefined") return
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect()
      setBox((b) => (Math.abs(b.w - r.width) < 0.5 && Math.abs(b.h - r.height) < 0.5 ? b : { w: r.width, h: r.height }))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [collapsed])

  const shownAnnotations = useMemo(
    () => annotations.filter((a) => !a.channel || a.channel === label),
    [annotations, label],
  )

  // Downsample each series, then merge onto one dataset keyed k0, k1, …
  const { rows, keys } = useMemo(() => {
    const reduced = series.map((s) => lttb(s.signal.data, RENDER_POINTS))
    if (reduced.length === 1) {
      return { rows: reduced[0].map((d) => ({ t: d.t, k0: d.value })), keys: ["k0"] }
    }
    const map = new Map<number, Record<string, number | null>>()
    reduced.forEach((data, si) => {
      const key = `k${si}`
      for (const d of data) {
        let row = map.get(d.t)
        if (!row) {
          row = { t: d.t }
          map.set(d.t, row)
        }
        row[key] = d.value
      }
    })
    const merged = [...map.values()].sort((a, b) => (a.t as number) - (b.t as number))
    return { rows: merged, keys: series.map((_, i) => `k${i}`) }
  }, [series])

  // Cursor-time readout from full-resolution data. Interpolating keeps the dot
  // visually aligned with the vertical cursor line.
  const cursorValue = useMemo(() => {
    if (effectiveCursorT == null || !primary) return null
    return sampleAt(primary.signal.data, effectiveCursorT)
  }, [effectiveCursorT, primary])
  // ECU bitfield channels (CSP / Failsafe / MIL): exact step value + decoded text.
  const decoders = useFlagDecoders()
  const flagDec = useMemo(() => decoderFor(label, decoders), [label, decoders])
  const flag = useMemo(() => {
    if (!flagDec || effectiveCursorT == null || !primary) return null
    const raw = stepValueAt(primary.signal.data, effectiveCursorT)
    return { raw, text: describe(flagDec, decodeValue(flagDec, raw)) }
  }, [flagDec, effectiveCursorT, primary])
  // Compare: every file's value at the cursor.
  const compareValues = useMemo(() => {
    if (!isCompare || effectiveCursorT == null) return null
    return series.map((s) => ({ id: s.id, name: s.name, color: s.color, value: sampleAt(s.signal.data, effectiveCursorT)?.value ?? null }))
  }, [isCompare, effectiveCursorT, series])

  function setCursorTime(t: number) {
    if (sync) onCursorChange(t)
    else setLocalCursorT(t)
  }

  function pointerToT(clientX: number) {
    const rect = chartRef.current?.getBoundingClientRect()
    if (!rect) return domain[0]
    const left = PAD_X + yAxisWidth + M_LEFT
    const right = PAD_X + M_RIGHT
    const width = Math.max(1, rect.width - left - right)
    return +clamp(domain[0] + ((clientX - rect.left - left) / width) * (domain[1] - domain[0]), domain[0], domain[1]).toFixed(3)
  }

  function handleClick(state: { activeLabel?: string | number } | null) {
    if (windowMode && !annotateMode) return
    if (state?.activeLabel == null) return
    const t = Number(state.activeLabel)
    if (annotateMode) onAddAnnotation(t, label)
    else setCursorTime(t)
  }

  // Click/touch-drag to scrub the cursor (no text highlight thanks to select-none).
  const draggingRef = useRef(false)
  const touchStartRef = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  function handleMouseDown(state: { activeLabel?: string | number } | null) {
    if (windowMode || annotateMode || state?.activeLabel == null) return
    draggingRef.current = true
    const t = Number(state.activeLabel)
    setCursorTime(t)
  }
  function handleMouseMove(state: { activeLabel?: string | number } | null) {
    if (!draggingRef.current || state?.activeLabel == null) return
    const t = Number(state.activeLabel)
    setCursorTime(t)
  }
  function endDrag() {
    draggingRef.current = false
  }
  const handlersRef = useRef({ handleClick, handleMouseDown, handleMouseMove, endDrag })
  handlersRef.current = { handleClick, handleMouseDown, handleMouseMove, endDrag }
  type ChartState = { activeLabel?: string | number } | null
  const onChartClick = useCallback((s: ChartState) => handlersRef.current.handleClick(s), [])
  const onChartDown = useCallback((s: ChartState) => handlersRef.current.handleMouseDown(s), [])
  const onChartMove = useCallback((s: ChartState) => handlersRef.current.handleMouseMove(s), [])
  const onChartUp = useCallback(() => handlersRef.current.endDrag(), [])

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (windowMode && !annotateMode) {
      if (!chartRef.current) return
      if (event.pointerType === "mouse" && event.button !== 0) return
      winRef.current = { startX: event.clientX, t0: pointerToT(event.clientX), moved: false }
      setWinSel(null)
      event.currentTarget.setPointerCapture(event.pointerId)
      if (event.pointerType === "mouse") event.preventDefault()
      return
    }
    if (event.pointerType === "mouse") return
    if (!chartRef.current) return
    touchStartRef.current = { x: event.clientX, y: event.clientY, moved: false }
    event.currentTarget.setPointerCapture(event.pointerId)
    if (annotateMode) return
    event.preventDefault()
    draggingRef.current = true
    setCursorTime(pointerToT(event.clientX))
  }
  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (winRef.current) {
      if (Math.abs(event.clientX - winRef.current.startX) >= WINDOW_DRAG_PX) winRef.current.moved = true
      if (winRef.current.moved) {
        event.preventDefault()
        setWinSel([winRef.current.t0, pointerToT(event.clientX)])
      }
      return
    }
    if (event.pointerType === "mouse") return
    if (touchStartRef.current) {
      if (Math.abs(event.clientX - touchStartRef.current.x) > 3 || Math.abs(event.clientY - touchStartRef.current.y) > 3) {
        touchStartRef.current.moved = true
      }
    }
    if (!draggingRef.current || annotateMode) return
    event.preventDefault()
    setCursorTime(pointerToT(event.clientX))
  }
  function handlePointerUp(event: PointerEvent<HTMLDivElement>) {
    if (winRef.current) {
      const w = winRef.current
      winRef.current = null
      setWinSel(null)
      const t1 = pointerToT(event.clientX)
      if (w.moved && t1 !== w.t0) onWindowSelect?.(Math.min(w.t0, t1), Math.max(w.t0, t1))
      else setCursorTime(t1)
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
      return
    }
    if (event.pointerType === "mouse") return
    if (annotateMode && touchStartRef.current && !touchStartRef.current.moved) onAddAnnotation(pointerToT(event.clientX), label)
    touchStartRef.current = null
    draggingRef.current = false
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  function handlePointerCancel(event: PointerEvent<HTMLDivElement>) {
    winRef.current = null
    setWinSel(null)
    if (event.pointerType === "mouse") return
    touchStartRef.current = null
    draggingRef.current = false
  }

  const cvStyle = (
    collapsed
      ? undefined
      : {
          contentVisibility: "auto",
          containIntrinsicSize: `auto ${INTRINSIC[display.height] + (isCompare ? 28 : 0)}px`,
        }
  ) as CSSProperties | undefined

  // The chart only re-renders when its data, range or styling change — not when
  // the cursor moves (arrow keys / scrubbing redraw just the overlay below).
  const chartEl = useMemo(
    () => (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={rows}
                margin={{ top: 8, right: 16, left: 4, bottom: 4 }}
                onClick={onChartClick}
                onMouseDown={onChartDown}
                onMouseMove={onChartMove}
                onMouseUp={onChartUp}
                onMouseLeave={onChartUp}
              >
                {display.showGrid && (
                  <CartesianGrid stroke="var(--muted-foreground)" strokeOpacity={0.18} strokeDasharray="2 4" vertical horizontal />
                )}
                <XAxis
                  dataKey="t"
                  type="number"
                  domain={domain}
                  allowDataOverflow
                  tickLine={false}
                  axisLine={{ stroke: "var(--border)" }}
                  tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                  tickFormatter={(v) => `${v}`}
                  minTickGap={40}
                  unit={timeUnit}
                />
                <YAxis
                  width={yAxisWidth}
                  tickLine={false}
                  axisLine={false}
                  domain={yDomain}
                  ticks={yTicks}
                  tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                  tickFormatter={(v) => {
                    const value = fmt(Number(v), decimals <= 1 ? 0 : 1)
                    const suffix = unitText(unit)
                    return suffix ? `${value}${suffix}` : value
                  }}
                />
                {shownAnnotations.map((a) => (
                  <ReferenceLine
                    key={a.id}
                    x={a.t}
                    stroke={colorForType(a.type)}
                    strokeWidth={1.5}
                    label={{ value: a.type, position: "insideTopLeft", fontSize: 10, fill: colorForType(a.type) }}
                  />
                ))}
                {winSel && (
                  <ReferenceArea
                    x1={Math.min(winSel[0], winSel[1])}
                    x2={Math.max(winSel[0], winSel[1])}
                    stroke="#ffffff"
                    strokeOpacity={0.85}
                    strokeDasharray="4 3"
                    fill="#ffffff"
                    fillOpacity={0.06}
                  />
                )}
                {winSel && <ReferenceLine x={winSel[0]} stroke="#ffffff" strokeWidth={3} strokeOpacity={0.9} />}
                {winSel && <ReferenceLine x={winSel[1]} stroke="#ffffff" strokeWidth={3} strokeOpacity={0.9} />}
                {keys.map((key, i) => (
                  <Area
                    key={key}
                    type={display.curve}
                    dataKey={key}
                    stroke={series[i].color}
                    strokeWidth={display.lineWidth}
                    fill="none"
                    fillOpacity={0}
                    dot={false}
                    activeDot={false}
                    isAnimationActive={false}
                    connectNulls
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handlers are stable ref wrappers
    [rows, keys, series, display, domain, yDomain, yTicks, yAxisWidth, decimals, unit, timeUnit, shownAnnotations, winSel],
  )

  const plotW = Math.max(0, box.w - PAD_X * 2 - M_LEFT - M_RIGHT - yAxisWidth)
  const plotH = Math.max(0, box.h - M_TOP - AXIS_BAND)
  const span = domain[1] - domain[0]
  const cursorX =
    effectiveCursorT != null && span > 0 && plotW > 0 && effectiveCursorT >= domain[0] && effectiveCursorT <= domain[1]
      ? PAD_X + M_LEFT + yAxisWidth + ((effectiveCursorT - domain[0]) / span) * plotW
      : null
  const cursorY =
    cursorX != null && cursorValue?.value != null && yDomain[1] > yDomain[0]
      ? M_TOP + (1 - (cursorValue.value - yDomain[0]) / (yDomain[1] - yDomain[0])) * plotH
      : null
  const cursorOverlay =
    cursorX == null ? null : (
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div
          className="absolute w-0 border-l border-dashed"
          style={{ left: cursorX, top: M_TOP, height: plotH, borderColor: primary?.color, opacity: sync ? 0.75 : 0.45 }}
        />
        {cursorY != null && cursorY >= M_TOP - 1 && cursorY <= M_TOP + plotH + 1 && (
          <div
            className="absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-background"
            style={{ left: cursorX, top: cursorY, backgroundColor: primary?.color }}
          />
        )}
      </div>
    )

  return (
    <section
      id={domId}
      style={cvStyle}
      className={cn(
        "overflow-hidden rounded-xl border border-border bg-card/60 transition-colors hover:border-border/80",
        annotateMode && "ring-1 ring-primary/40",
      )}
    >
      <header className="flex flex-wrap items-center justify-between gap-2 px-3 py-3 sm:flex-nowrap sm:px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="size-2.5 rounded-full" style={{ backgroundColor: primary?.color }} aria-hidden />
          <h3 className="truncate text-sm font-semibold text-foreground">{label}</h3>
          <span className="font-mono text-[11px] text-muted-foreground">{unit}</span>
        </div>
        <div className="flex items-center gap-4">
          {isCompare && diffStats ? (
            <dl className="hidden items-center gap-4 font-mono text-xs sm:flex">
              <div className="flex items-center gap-1.5">
                <dt className="text-muted-foreground">Δavg</dt>
                <dd className="tabular-nums text-foreground">{fmt(diffStats.avgDiff, decimals)}</dd>
              </div>
              <div className="flex items-center gap-1.5">
                <dt className="text-muted-foreground">Δmax</dt>
                <dd className="tabular-nums text-foreground">{fmt(diffStats.maxDiff, decimals)}</dd>
              </div>
              <div className="flex items-center gap-1.5">
                <dt className="text-muted-foreground">σ</dt>
                <dd className="tabular-nums text-foreground">{fmt(diffStats.stdDev, decimals)}</dd>
              </div>
            </dl>
          ) : (
            primary && (
              <dl className="octane-desktop-signal-stats hidden items-center gap-4 font-mono text-xs lg:flex">
                <div className="flex items-center gap-1.5">
                  <dt className="text-muted-foreground">Max</dt>
                  <dd className="tabular-nums text-foreground">{fmt(primary.signal.max, decimals)}</dd>
                </div>
                <div className="flex items-center gap-1.5">
                  <dt className="text-muted-foreground">Min</dt>
                  <dd className="tabular-nums text-foreground">{fmt(primary.signal.min, decimals)}</dd>
                </div>
                <div className="flex items-center gap-1.5">
                  <dt className="text-muted-foreground">Avg</dt>
                  <dd className="tabular-nums text-foreground">{fmt(primary.signal.avg, decimals)}</dd>
                </div>
              </dl>
            )
          )}
          <button
            type="button"
            onClick={() => onToggleCollapse(channelKey)}
            aria-label={collapsed ? "Expand chart" : "Collapse chart"}
            aria-expanded={!collapsed}
            className="inline-flex size-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <ChevronDown className={cn("size-4 transition-transform", collapsed && "-rotate-90")} />
          </button>
        </div>
      </header>

      {isCompare && (
        <div className="flex flex-wrap items-center gap-3 px-4 pb-2">
          {series.map((s) => (
            <span key={s.id} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="h-0.5 w-3 rounded" style={{ backgroundColor: s.color }} />
              <span className="max-w-[180px] truncate" title={s.name}>
                {s.name}
              </span>
            </span>
          ))}
        </div>
      )}

      {!collapsed && (
        <>
          <div
            ref={chartRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
            onDoubleClick={windowMode ? () => onWindowReset?.() : undefined}
            className={cn(
              "relative w-full touch-pan-y select-none px-2",
              HEIGHT_CLASS[display.height],
              annotateMode || windowMode ? "cursor-crosshair" : "cursor-ew-resize",
            )}
          >
            {chartEl}
            {cursorOverlay}
          </div>

          <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2.5 font-mono text-xs sm:px-4">
            {compareValues ? (
              <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-foreground">
                <Crosshair className="size-3.5 text-primary" />
                <span className="tabular-nums">
                  {fmt(effectiveCursorT ?? 0, 2)}
                  {timeUnit}
                </span>
                {compareValues.map((row) => (
                  <span key={row.id} className="tabular-nums" style={{ color: row.color }} title={row.name}>
                    {row.value == null ? "—" : fmt(row.value, decimals)}
                  </span>
                ))}
                {compareValues.length > 1 && compareValues[0].value != null && compareValues[1].value != null && (
                  <span className="tabular-nums text-muted-foreground">Δ {fmt(compareValues[0].value - compareValues[1].value, decimals)}</span>
                )}
              </span>
            ) : cursorValue ? (
              <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-foreground">
                <Crosshair className="size-3.5 text-primary" />
                <span className="text-muted-foreground">t =</span>
                <span className="tabular-nums">
                  {fmt(cursorValue.t, 2)}
                  {timeUnit}
                </span>
                <span className="text-border">·</span>
                <span className="tabular-nums" style={{ color: primary?.color }}>
                  {flag ? (flag.raw ?? "—") : cursorValue.value == null ? "—" : fmt(cursorValue.value, decimals)} {unit !== "—" ? unit : ""}
                </span>
                {flag && (
                  <span className="min-w-0 text-muted-foreground" title={flag.text}>
                    · {flag.text}
                  </span>
                )}
              </span>
            ) : (
              <span className="flex items-center gap-2 text-muted-foreground">
                {annotateMode ? (
                  <>
                    <MapPin className="size-3.5 text-primary" />
                    Click the plot to drop an annotation
                  </>
                ) : windowMode ? (
                  <>
                    <Crosshair className="size-3.5 text-primary" />
                    Drag across the plot to set the shared time window
                  </>
                ) : (
                  <>
                    <Crosshair className="size-3.5" />
                    Click the plot to snap to the nearest value
                  </>
                )}
              </span>
            )}
          </footer>
        </>
      )}
    </section>
  )
}

export const SignalChart = memo(SignalChartImpl)
