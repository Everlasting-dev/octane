"use client"

import { useMemo, useRef, useState, type CSSProperties } from "react"
import { Crosshair, GripHorizontal, Lock, LockOpen, RotateCcw, X } from "lucide-react"
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from "recharts"
import { lttb } from "@/lib/downsample"
import { calculateDiff } from "@/lib/compare"
import { cn } from "@/lib/utils"
import type { ParsedLog } from "@/lib/csv"
import type { SignalSample } from "@/lib/telemetry"
import type { Template } from "@/lib/templates"
import type { DisplaySettings } from "./display-panel"

const RENDER_POINTS = 600
const MAX_FILES = 3
const MAX_CH = 3
const FILE_COLORS = ["#4aa8ff", "#4cd397", "#ffb454"]
const LEFT = 52
const RIGHT = 16

export interface CompareViewProps {
  logs: ParsedLog[]
  areas: string[][]
  offsets: Record<string, number>
  activeFile: string | null
  domain: [number, number]
  display: DisplaySettings
  sync: boolean
  cursorT: number | null
  templates: Template[]
  onSetActiveFile: (name: string) => void
  onSetOffset: (name: string, offset: number) => void
  onResetOffsets: () => void
  onSetAreaChannels: (areaIdx: number, channels: string[]) => void
  onApplyTemplateAll: (t: Template) => void
  locked: boolean
  onToggleLock: () => void
  onCursorChange: (t: number | null) => void
}

function fmt(v: number, decimals: number) {
  return v.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

function nearest(data: SignalSample[], t: number): number | null {
  let best: number | null = null
  let bestDist = Infinity
  for (const d of data) {
    if (d.value == null) continue
    const dist = Math.abs(d.t - t)
    if (dist < bestDist) {
      bestDist = dist
      best = d.value
    }
  }
  return best
}

function shift(data: SignalSample[], off: number): SignalSample[] {
  return data.map((d) => ({ t: d.t + off, value: d.value }))
}

export function CompareView(props: CompareViewProps) {
  const { logs, offsets, activeFile, templates, locked, onSetActiveFile, onSetOffset, onResetOffsets, onApplyTemplateAll, onToggleLock } = props
  const files = logs.slice(0, MAX_FILES)

  const allLabels = useMemo(() => {
    const set = new Set<string>()
    for (const l of files) for (const s of l.signals) set.add(s.label)
    return [...set].sort()
  }, [files])

  return (
    <div className="flex flex-col gap-4 pb-4">
      {/* Alignment bar */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card/60 px-4 py-3">
        <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          <GripHorizontal className="size-3.5" /> Align
        </span>
        {files.map((l, fi) => {
          const active = activeFile === l.fileName
          const off = offsets[l.fileName] ?? 0
          return (
            <div
              key={l.fileName}
              className={cn(
                "flex items-center gap-1 rounded-md border px-1.5 py-1 transition-colors",
                active ? "border-primary bg-primary/10" : "border-border bg-card",
              )}
            >
              <button type="button" onClick={() => onSetActiveFile(l.fileName)} className="flex items-center gap-1.5 px-1">
                <span className="size-2.5 rounded-full" style={{ backgroundColor: FILE_COLORS[fi] }} />
                <span className="max-w-[140px] truncate text-xs text-foreground" title={l.fileName}>
                  {l.fileName.replace(/\.[^.]+$/, "")}
                </span>
                {active && <span className="text-[10px] font-medium text-primary">ref</span>}
              </button>
              <button
                type="button"
                onClick={() => onSetOffset(l.fileName, +(off - 0.1).toFixed(3))}
                className="inline-flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-secondary hover:text-foreground"
                aria-label="Shift earlier"
              >
                −
              </button>
              <span className="w-12 text-center font-mono text-[11px] tabular-nums text-muted-foreground">
                {off >= 0 ? "+" : ""}
                {off.toFixed(2)}s
              </span>
              <button
                type="button"
                onClick={() => onSetOffset(l.fileName, +(off + 0.1).toFixed(3))}
                className="inline-flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-secondary hover:text-foreground"
                aria-label="Shift later"
              >
                +
              </button>
            </div>
          )
        })}
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={onToggleLock}
            aria-pressed={locked}
            title={locked ? "Alignment locked — drag reads values" : "Drag a trace to align; lock to read values safely"}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors",
              locked ? "border-primary bg-primary/15 text-foreground" : "border-border bg-card text-muted-foreground hover:bg-secondary",
            )}
          >
            {locked ? <Lock className="size-3" /> : <LockOpen className="size-3" />}
            {locked ? "Locked" : "Align"}
          </button>
          {templates.length > 0 && (
            <select
              value=""
              onChange={(e) => {
                const t = templates.find((x) => x.id === e.target.value)
                if (t) onApplyTemplateAll(t)
              }}
              title="Fill all 3 plots from a template (3 channels each)"
              className="h-7 max-w-[190px] rounded-md border border-border bg-card px-1.5 text-xs text-muted-foreground focus:border-ring focus:outline-none"
            >
              <option value="">Template → all plots…</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={onResetOffsets}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <RotateCcw className="size-3" /> Reset offsets
          </button>
        </div>
        <p className="w-full text-[11px] text-muted-foreground">
          Click a file to make it the active reference, then drag its trace on any plot to align it. Δ compares against it.
        </p>
      </div>

      {props.areas.map((channels, areaIdx) => (
        <CompareArea key={areaIdx} areaIdx={areaIdx} channels={channels} files={files} allLabels={allLabels} {...props} />
      ))}
    </div>
  )
}

function CompareArea({
  areaIdx,
  channels,
  files,
  allLabels,
  offsets,
  activeFile,
  domain,
  display,
  sync,
  cursorT,
  templates,
  locked,
  onSetOffset,
  onSetAreaChannels,
  onCursorChange,
}: CompareViewProps & { areaIdx: number; channels: string[]; files: ParsedLog[]; allLabels: string[] }) {
  const [mode, setMode] = useState<"values" | "diff">("values")
  const refName = activeFile && files.some((f) => f.fileName === activeFile) ? activeFile : files[0]?.fileName ?? null
  const refLog = files.find((f) => f.fileName === refName) ?? null
  const available = allLabels.filter((l) => !channels.includes(l))

  function addChannel(label: string) {
    if (!label || channels.length >= MAX_CH || channels.includes(label)) return
    onSetAreaChannels(areaIdx, [...channels, label])
  }
  function applyTemplate(id: string) {
    const t = templates.find((x) => x.id === id)
    if (t) onSetAreaChannels(areaIdx, t.channels.slice(0, MAX_CH))
  }

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card/60">
      <header className="flex flex-wrap items-center gap-2 px-4 py-3">
        <h3 className="text-sm font-semibold text-foreground">Plot {areaIdx + 1}</h3>
        <div className="flex flex-wrap items-center gap-1.5">
          {channels.map((label) => (
            <span key={label} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary px-2 py-0.5 text-xs text-foreground">
              {label}
              <button
                type="button"
                onClick={() => onSetAreaChannels(areaIdx, channels.filter((c) => c !== label))}
                aria-label={`Remove ${label}`}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {channels.length > 0 && (
            <div className="flex rounded-md border border-border bg-secondary/40 p-0.5 text-[11px]">
              {(["values", "diff"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={cn(
                    "rounded px-2 py-0.5 font-medium transition-colors",
                    mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {m === "values" ? "Values" : "Δ Diff"}
                </button>
              ))}
            </div>
          )}
          {channels.length < MAX_CH && available.length > 0 && (
            <select
              value=""
              onChange={(e) => addChannel(e.target.value)}
              className="h-7 max-w-[150px] rounded-md border border-border bg-card px-1.5 text-xs text-foreground focus:border-ring focus:outline-none"
            >
              <option value="">+ Add channel…</option>
              {available.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          )}
          {templates.length > 0 && (
            <select
              value=""
              onChange={(e) => applyTemplate(e.target.value)}
              className="h-7 max-w-[140px] rounded-md border border-border bg-card px-1.5 text-xs text-muted-foreground focus:border-ring focus:outline-none"
            >
              <option value="">Template…</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          )}
        </div>
      </header>

      {channels.length === 0 ? (
        <div className="px-4 pb-6 pt-2 text-sm text-muted-foreground">
          Add up to {MAX_CH} channels — each gets its own readable chart with every file overlaid.
        </div>
      ) : (
        <div className="flex flex-col divide-y divide-border border-t border-border">
          {channels.map((label) => (
            <ChannelFacet
              key={label}
              label={label}
              files={files}
              refLog={refLog}
              offsets={offsets}
              activeFile={activeFile}
              domain={domain}
              display={display}
              sync={sync}
              cursorT={cursorT}
              mode={mode}
              locked={locked}
              onSetOffset={onSetOffset}
              onCursorChange={onCursorChange}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function ChannelFacet({
  label,
  files,
  refLog,
  offsets,
  activeFile,
  domain,
  display,
  sync,
  cursorT,
  mode,
  locked,
  onSetOffset,
  onCursorChange,
}: {
  label: string
  files: ParsedLog[]
  refLog: ParsedLog | null
  offsets: Record<string, number>
  activeFile: string | null
  domain: [number, number]
  display: DisplaySettings
  sync: boolean
  cursorT: number | null
  mode: "values" | "diff"
  locked: boolean
  onSetOffset: (name: string, offset: number) => void
  onCursorChange: (t: number | null) => void
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ startX: number; startOffset: number; moved: boolean; width: number } | null>(null)
  const cursorRef = useRef(false)

  const present = files.filter((l) => l.signals.some((s) => s.label === label))
  const sample = present[0]?.signals.find((s) => s.label === label)
  const unit = sample?.unit ?? "—"
  const decimals = sample?.decimals ?? 1
  const isDiff = mode === "diff" && refLog != null

  const { rows, lines, zero } = useMemo(() => {
    const map = new Map<number, Record<string, number | null>>()
    const lineDefs: { key: string; color: string; fileName: string }[] = []

    if (isDiff && refLog) {
      const refSig = refLog.signals.find((x) => x.label === label)
      const refOff = offsets[refLog.fileName] ?? 0
      files.forEach((l, fi) => {
        if (l.fileName === refLog.fileName) return
        const s = l.signals.find((x) => x.label === label)
        if (!s || !refSig) return
        const diff = calculateDiff(shift(lttb(s.data, RENDER_POINTS), offsets[l.fileName] ?? 0), shift(lttb(refSig.data, RENDER_POINTS), refOff))
        if (!diff) return
        const key = `f${fi}`
        lineDefs.push({ key, color: FILE_COLORS[fi], fileName: l.fileName })
        diff.time.forEach((t, i) => {
          let row = map.get(t)
          if (!row) {
            row = { t }
            map.set(t, row)
          }
          row[key] = diff.diff[i]
        })
      })
      return { rows: [...map.values()].sort((a, b) => (a.t as number) - (b.t as number)), lines: lineDefs, zero: true }
    }

    files.forEach((l, fi) => {
      const s = l.signals.find((x) => x.label === label)
      if (!s) return
      const off = offsets[l.fileName] ?? 0
      const key = `f${fi}`
      lineDefs.push({ key, color: FILE_COLORS[fi], fileName: l.fileName })
      for (const d of lttb(s.data, RENDER_POINTS)) {
        const t = +(d.t + off).toFixed(4)
        let row = map.get(t)
        if (!row) {
          row = { t }
          map.set(t, row)
        }
        row[key] = d.value
      }
    })
    return { rows: [...map.values()].sort((a, b) => (a.t as number) - (b.t as number)), lines: lineDefs, zero: false }
  }, [files, label, offsets, isDiff, refLog])

  function pointerToT(clientX: number) {
    const r = wrapRef.current!.getBoundingClientRect()
    const w = Math.max(1, r.width - LEFT - RIGHT)
    return +Math.min(domain[1], Math.max(domain[0], domain[0] + ((clientX - r.left - LEFT) / w) * (domain[1] - domain[0]))).toFixed(3)
  }

  function onPointerDown(e: React.PointerEvent) {
    if (!wrapRef.current) return
    e.preventDefault()
    wrapRef.current.setPointerCapture(e.pointerId)
    // Unlocked + an active file → drag aligns it. Locked (or no active) → scrub cursor.
    if (!locked && activeFile) {
      const rect = wrapRef.current.getBoundingClientRect()
      dragRef.current = { startX: e.clientX, startOffset: offsets[activeFile] ?? 0, moved: false, width: rect.width }
    } else {
      cursorRef.current = true
      onCursorChange(pointerToT(e.clientX))
    }
  }
  function onPointerMove(e: React.PointerEvent) {
    const d = dragRef.current
    if (d && activeFile) {
      const dx = e.clientX - d.startX
      if (Math.abs(dx) > 3) d.moved = true
      if (d.moved) {
        const span = domain[1] - domain[0]
        const plotW = Math.max(1, d.width - LEFT - RIGHT)
        onSetOffset(activeFile, +(d.startOffset + (dx / plotW) * span).toFixed(3))
      }
      return
    }
    if (cursorRef.current) onCursorChange(pointerToT(e.clientX))
  }
  function onPointerUp(e: React.PointerEvent) {
    const d = dragRef.current
    dragRef.current = null
    if (d) {
      if (!d.moved) onCursorChange(pointerToT(e.clientX)) // click = read value
      return
    }
    cursorRef.current = false
  }

  const refSig = refLog?.signals.find((x) => x.label === label)
  const refOff = refLog ? offsets[refLog.fileName] ?? 0 : 0
  const refVal = cursorT != null && refSig ? nearest(refSig.data, cursorT - refOff) : null

  const facetStyle = { contentVisibility: "auto", containIntrinsicSize: "auto 230px" } as CSSProperties

  return (
    <div style={facetStyle} className="px-2 py-2">
      <div className="flex items-center justify-between gap-3 px-2">
        <div className="flex items-center gap-2">
          {locked && <Lock className="size-3 shrink-0 text-primary" aria-label="Alignment locked" />}
          <span className="text-sm font-medium text-foreground">{label}</span>
          <span className="font-mono text-[11px] text-muted-foreground">
            {isDiff ? `Δ ${unit !== "—" ? unit : ""} vs ${refLog?.fileName.replace(/\.[^.]+$/, "")}` : unit !== "—" ? unit : ""}
          </span>
        </div>
        {/* Per-file value + Δ at the cursor */}
        {cursorT != null && (
          <div className="flex flex-wrap items-center justify-end gap-x-3 font-mono text-[11px]">
            {files.map((l, fi) => {
              const s = l.signals.find((x) => x.label === label)
              if (!s) return null
              const v = nearest(s.data, cursorT - (offsets[l.fileName] ?? 0))
              const isRef = l.fileName === refLog?.fileName
              const delta = v != null && refVal != null && !isRef ? v - refVal : null
              return (
                <span key={fi} className="tabular-nums" style={{ color: FILE_COLORS[fi] }}>
                  {v == null ? "—" : fmt(v, s.decimals)}
                  {delta != null && (
                    <span className="text-muted-foreground">
                      {" "}
                      Δ{delta >= 0 ? "+" : ""}
                      {fmt(delta, s.decimals)}
                    </span>
                  )}
                </span>
              )
            })}
          </div>
        )}
      </div>

      <div
        ref={wrapRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className={cn(
          "h-40 w-full touch-none select-none",
          locked ? "cursor-crosshair" : activeFile ? "cursor-ew-resize" : "cursor-pointer",
        )}
      >
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={rows} margin={{ top: 8, right: RIGHT, left: 4, bottom: 4 }}>
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
              unit="s"
            />
            <YAxis
              width={LEFT}
              domain={["auto", "auto"]}
              tickLine={false}
              axisLine={false}
              tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
              tickFormatter={(v) => fmt(Number(v), Math.abs(Number(v)) < 10 ? Math.min(decimals, 2) : 0)}
            />
            {zero && <ReferenceLine y={0} stroke="var(--border)" />}
            {sync && cursorT != null && (
              <ReferenceLine x={cursorT} stroke="var(--muted-foreground)" strokeOpacity={0.7} strokeDasharray="4 3" />
            )}
            {lines.map((ln) => (
              <Area
                key={ln.key}
                type={display.curve}
                dataKey={ln.key}
                stroke={ln.color}
                strokeWidth={display.lineWidth}
                strokeOpacity={!activeFile || ln.fileName === activeFile ? 1 : 0.4}
                fill="none"
                dot={false}
                activeDot={false}
                isAnimationActive={false}
                connectNulls
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
