"use client"

import { memo, useMemo, useRef, type CSSProperties } from "react"
import { ChevronDown, Crosshair, MapPin } from "lucide-react"
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceDot,
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
}

function fmt(v: number, decimals: number) {
  return v.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
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
}: SignalChartProps) {
  const isCompare = series.length > 1
  const primary = series[0]

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

  // Nearest real sample to the snapped cursor (full-resolution readout).
  const cursorValue = useMemo(() => {
    if (cursorT == null || !primary) return null
    let best = primary.signal.data[0]
    let bestDist = Infinity
    for (const d of primary.signal.data) {
      const dist = Math.abs(d.t - cursorT)
      if (dist < bestDist) {
        bestDist = dist
        best = d
      }
    }
    return best
  }, [cursorT, primary])

  function handleClick(state: { activeLabel?: string | number } | null) {
    if (state?.activeLabel == null) return
    const t = Number(state.activeLabel)
    if (annotateMode) onAddAnnotation(t, label)
    else onCursorChange(t)
  }

  // Click-drag to scrub the cursor (no text highlight thanks to select-none).
  const draggingRef = useRef(false)
  function handleMouseDown(state: { activeLabel?: string | number } | null) {
    if (annotateMode || state?.activeLabel == null) return
    draggingRef.current = true
    onCursorChange(Number(state.activeLabel))
  }
  function handleMouseMove(state: { activeLabel?: string | number } | null) {
    if (!draggingRef.current || state?.activeLabel == null) return
    onCursorChange(Number(state.activeLabel))
  }
  function endDrag() {
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

  return (
    <section
      id={domId}
      style={cvStyle}
      className={cn(
        "overflow-hidden rounded-xl border border-border bg-card/60 transition-colors hover:border-border/80",
        annotateMode && "ring-1 ring-primary/40",
      )}
    >
      <header className="flex items-center justify-between gap-3 px-4 py-3">
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
              <dl className="hidden items-center gap-4 font-mono text-xs sm:flex">
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
            className={cn(
              "w-full select-none px-2",
              HEIGHT_CLASS[display.height],
              annotateMode ? "cursor-crosshair" : "cursor-ew-resize",
            )}
          >
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={rows}
                margin={{ top: 8, right: 16, left: 4, bottom: 4 }}
                onClick={handleClick}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={endDrag}
                onMouseLeave={endDrag}
              >
                {display.showGrid && (
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
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
                  width={44}
                  tickLine={false}
                  axisLine={false}
                  domain={["auto", "auto"]}
                  tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                  tickFormatter={(v) => fmt(Number(v), decimals <= 1 ? 0 : 1)}
                />
                {sync && cursorT != null && (
                  <ReferenceLine x={cursorT} stroke={primary?.color} strokeOpacity={0.7} strokeDasharray="4 3" />
                )}
                {cursorValue && cursorValue.value != null && (
                  <ReferenceDot
                    x={cursorValue.t}
                    y={cursorValue.value}
                    r={3}
                    fill={primary?.color}
                    stroke="var(--background)"
                    strokeWidth={2}
                    isFront
                  />
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
          </div>

          <footer className="flex items-center justify-between border-t border-border px-4 py-2.5 font-mono text-xs">
            {cursorValue ? (
              <span className="flex items-center gap-2 text-foreground">
                <Crosshair className="size-3.5 text-primary" />
                <span className="text-muted-foreground">t =</span>
                <span className="tabular-nums">
                  {fmt(cursorValue.t, 2)}
                  {timeUnit}
                </span>
                <span className="text-border">·</span>
                <span className="tabular-nums" style={{ color: primary?.color }}>
                  {cursorValue.value == null ? "—" : fmt(cursorValue.value, decimals)} {unit !== "—" ? unit : ""}
                </span>
              </span>
            ) : (
              <span className="flex items-center gap-2 text-muted-foreground">
                {annotateMode ? (
                  <>
                    <MapPin className="size-3.5 text-primary" />
                    Click the plot to drop an annotation
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
