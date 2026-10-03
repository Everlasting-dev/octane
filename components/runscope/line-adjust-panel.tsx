"use client"

import { useState, type Dispatch, type SetStateAction } from "react"
import { ChevronDown, ChevronUp, Minus, Plus, RotateCcw, Wand2, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { paletteChoices } from "@/lib/palette"
import {
  GAIN_MAX,
  GAIN_MIN,
  WIDTH_MAX,
  WIDTH_MIN,
  lineRange,
  niceStep,
  type LineStyle,
} from "@/lib/line-style"
import type { ChartSeries } from "./signal-chart"

interface LineAdjustPanelProps {
  series: ChartSeries[]
  colorOf: Record<string, string>
  styles: Record<string, LineStyle>
  setStyles: Dispatch<SetStateAction<Record<string, LineStyle>>>
  focusKey: string | null
  onFocus: (label: string | null) => void
  cursorValue: (s: ChartSeries) => number | null
  defaultWidth: number
  mobile: boolean
  onClose: () => void
}

function fmtNum(v: number) {
  const abs = Math.abs(v)
  const d = abs >= 1000 ? 0 : abs >= 100 ? 1 : abs >= 10 ? 2 : 3
  return v.toFixed(d)
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v))
}

export function LineAdjustPanel({
  series,
  colorOf,
  styles,
  setStyles,
  focusKey,
  onFocus,
  cursorValue,
  defaultWidth,
  mobile,
  onClose,
}: LineAdjustPanelProps) {
  const [pickerFor, setPickerFor] = useState<string | null>(null)

  function update(label: string, fn: (s: LineStyle) => LineStyle) {
    setStyles((prev) => {
      const cur = prev[label] ?? { gain: 1, offset: 0 }
      return { ...prev, [label]: fn(cur) }
    })
  }

  function resetLine(label: string) {
    setStyles((prev) => {
      const next = { ...prev }
      const keep = next[label]?.color
      delete next[label]
      if (keep) next[label] = { gain: 1, offset: 0, color: keep }
      return next
    })
  }

  function autoScaleAll() {
    setStyles((prev) => {
      const next = { ...prev }
      for (const s of series) {
        const cur = next[s.signal.label]
        if (!cur) continue
        next[s.signal.label] = { gain: 1, offset: 0, color: cur.color, width: cur.width }
      }
      return next
    })
  }

  function resetAll() {
    setStyles((prev) => {
      const next = { ...prev }
      for (const s of series) delete next[s.signal.label]
      return next
    })
  }

  const usedColors = new Set(series.map((s) => (colorOf[s.signal.label] ?? "").toLowerCase()))
  const btn = mobile ? "size-10" : "size-8"
  const field = mobile ? "h-10 text-sm" : "h-8 text-xs"

  return (
    <aside
      className={cn(
        "octane-line-adjust z-40 flex flex-col border-border bg-popover/95 shadow-2xl backdrop-blur",
        mobile
          ? "fixed inset-x-0 bottom-0 max-h-[78dvh] rounded-t-2xl border-t pb-[env(safe-area-inset-bottom,0px)]"
          : "absolute inset-y-0 right-0 w-[23rem] border-l",
      )}
      role="dialog"
      aria-label="Line adjust"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">Lines</h3>
          <p className="truncate text-[11px] text-muted-foreground">
            {focusKey ? `Selected: ${focusKey}` : "Tap a line to select it"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={autoScaleAll}
            title="Auto scale: smart range for every line (keeps colours and weights)"
            className={cn("inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 font-medium text-foreground hover:bg-secondary", field)}
          >
            <Wand2 className="size-3.5" />
            Auto scale
          </button>
          <button
            type="button"
            onClick={resetAll}
            title="Reset every line (scale, colour, weight)"
            className={cn("inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 font-medium text-muted-foreground hover:bg-secondary hover:text-foreground", field)}
          >
            <RotateCcw className="size-3.5" />
            Reset all
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close line adjust"
            className={cn("inline-flex items-center justify-center rounded-md border border-border bg-card text-muted-foreground hover:bg-secondary hover:text-foreground", btn)}
          >
            <X className="size-4" />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
        {series.length === 0 && <p className="px-2 py-8 text-center text-sm text-muted-foreground">No lines on the plot.</p>}
        {series.map((s) => {
          const label = s.signal.label
          const style = styles[label] ?? { gain: 1, offset: 0 }
          const range = lineRange(s.signal, style)
          const step = niceStep(range.hi - range.lo)
          const color = colorOf[label] ?? "var(--muted-foreground)"
          const focused = focusKey === label
          const width = style.width ?? defaultWidth
          const v = cursorValue(s)
          const unit = s.signal.unit && s.signal.unit !== "—" ? s.signal.unit : ""
          return (
            <div
              key={s.id}
              className={cn(
                "mb-2 rounded-lg border p-2 transition-colors",
                focused ? "border-primary bg-primary/10" : "border-border bg-card/50",
              )}
            >
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPickerFor((cur) => (cur === label ? null : label))}
                  aria-label={`Change colour of ${label}`}
                  className={cn("shrink-0 rounded-md border-2 border-white/20", mobile ? "size-10" : "size-8")}
                  style={{ backgroundColor: color }}
                />
                <button
                  type="button"
                  onClick={() => onFocus(focused ? null : label)}
                  className={cn("flex min-w-0 flex-1 flex-col text-left", mobile ? "min-h-10 justify-center" : "")}
                >
                  <span className={cn("truncate font-medium", mobile ? "text-sm" : "text-xs", focused ? "text-foreground" : "text-muted-foreground")}>
                    {label}
                  </span>
                  <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                    {v == null ? "--" : fmtNum(v)} {unit}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => resetLine(label)}
                  title="Reset this line"
                  className={cn("inline-flex shrink-0 items-center justify-center rounded-md border border-border bg-card px-2 text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground", mobile ? "h-10" : "h-8")}
                >
                  Reset
                </button>
              </div>

              {pickerFor === label && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {paletteChoices().map((c) => {
                    const taken = usedColors.has(c.toLowerCase()) && c.toLowerCase() !== color.toLowerCase()
                    return (
                      <button
                        key={c}
                        type="button"
                        disabled={taken}
                        title={taken ? "Used by another line" : c}
                        onClick={() => {
                          update(label, (cur) => ({ ...cur, color: c }))
                          setPickerFor(null)
                        }}
                        className={cn(
                          "rounded-md border-2 transition-transform disabled:cursor-not-allowed disabled:opacity-20",
                          mobile ? "size-9" : "size-7",
                          c.toLowerCase() === color.toLowerCase() ? "border-white" : "border-transparent hover:scale-110",
                        )}
                        style={{ backgroundColor: c }}
                      />
                    )
                  })}
                </div>
              )}

              <div className="mt-2 grid grid-cols-2 gap-2">
                <RangeField
                  label="Scale min"
                  value={range.lo}
                  step={step}
                  mobile={mobile}
                  onChange={(n) => update(label, (cur) => ({ ...cur, rangeMin: n, rangeMax: cur.rangeMax ?? range.hi }))}
                />
                <RangeField
                  label="Scale max"
                  value={range.hi}
                  step={step}
                  mobile={mobile}
                  onChange={(n) => update(label, (cur) => ({ ...cur, rangeMax: n, rangeMin: cur.rangeMin ?? range.lo }))}
                />
              </div>

              <div className="mt-2 grid grid-cols-3 gap-2">
                <Stepper
                  label="Gain"
                  value={`×${style.gain.toFixed(2)}`}
                  mobile={mobile}
                  onDown={() => update(label, (cur) => ({ ...cur, gain: +clamp(cur.gain / 1.15, GAIN_MIN, GAIN_MAX).toFixed(3) }))}
                  onUp={() => update(label, (cur) => ({ ...cur, gain: +clamp(cur.gain * 1.15, GAIN_MIN, GAIN_MAX).toFixed(3) }))}
                />
                <Stepper
                  label="Shift"
                  value={`${style.offset >= 0 ? "+" : ""}${Math.round(style.offset * 100)}%`}
                  mobile={mobile}
                  vertical
                  onDown={() => update(label, (cur) => ({ ...cur, offset: +(cur.offset - 0.05).toFixed(3) }))}
                  onUp={() => update(label, (cur) => ({ ...cur, offset: +(cur.offset + 0.05).toFixed(3) }))}
                />
                <Stepper
                  label="Weight"
                  value={`${width.toFixed(1)}px`}
                  mobile={mobile}
                  onDown={() => update(label, (cur) => ({ ...cur, width: +clamp((cur.width ?? defaultWidth) - 0.5, WIDTH_MIN, WIDTH_MAX).toFixed(1) }))}
                  onUp={() => update(label, (cur) => ({ ...cur, width: +clamp((cur.width ?? defaultWidth) + 0.5, WIDTH_MIN, WIDTH_MAX).toFixed(1) }))}
                />
              </div>
            </div>
          )
        })}
      </div>

      {!mobile && (
        <div className="shrink-0 border-t border-border px-3 py-2 text-[10px] leading-relaxed text-muted-foreground">
          <kbd className="font-mono">[</kbd> <kbd className="font-mono">]</kbd> select line · <kbd className="font-mono">Ctrl +/-</kbd> scale ·{" "}
          <kbd className="font-mono">Ctrl ↑/↓</kbd> shift · <kbd className="font-mono">Ctrl+Shift +/-</kbd> weight · <kbd className="font-mono">Ctrl 0</kbd> reset ·{" "}
          <kbd className="font-mono">T</kbd> close
        </div>
      )}
    </aside>
  )
}

function RangeField({
  label,
  value,
  step,
  mobile,
  onChange,
}: {
  label: string
  value: number
  step: number
  mobile: boolean
  onChange: (n: number) => void
}) {
  const shown = fmtNum(value)
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <div className="flex items-stretch gap-1">
        <input
          key={shown}
          defaultValue={shown}
          inputMode="decimal"
          onBlur={(e) => {
            const n = Number(e.currentTarget.value)
            if (Number.isFinite(n) && e.currentTarget.value.trim() !== "" && fmtNum(n) !== shown) onChange(n)
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur()
          }}
          className={cn(
            "min-w-0 flex-1 rounded-md border border-border bg-background px-2 font-mono tabular-nums text-foreground outline-none focus:border-ring",
            mobile ? "h-10 text-base" : "h-8 text-xs",
          )}
        />
        <div className="flex flex-col">
          <button
            type="button"
            onClick={() => onChange(+(value + step).toPrecision(10))}
            aria-label={`${label} up`}
            className={cn("inline-flex flex-1 items-center justify-center rounded-t-md border border-border bg-card text-muted-foreground hover:bg-secondary hover:text-foreground", mobile ? "w-10" : "w-7")}
          >
            <ChevronUp className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onChange(+(value - step).toPrecision(10))}
            aria-label={`${label} down`}
            className={cn("inline-flex flex-1 items-center justify-center rounded-b-md border border-t-0 border-border bg-card text-muted-foreground hover:bg-secondary hover:text-foreground", mobile ? "w-10" : "w-7")}
          >
            <ChevronDown className="size-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}

function Stepper({
  label,
  value,
  mobile,
  vertical = false,
  onDown,
  onUp,
}: {
  label: string
  value: string
  mobile: boolean
  vertical?: boolean
  onDown: () => void
  onUp: () => void
}) {
  const b = cn(
    "inline-flex min-w-0 flex-1 items-center justify-center rounded-md border border-border bg-card text-muted-foreground hover:bg-secondary hover:text-foreground active:bg-secondary",
    mobile ? "h-10" : "h-7",
  )
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="flex items-baseline justify-between gap-1">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
        <span className="truncate font-mono text-[11px] tabular-nums text-foreground">{value}</span>
      </span>
      <div className="flex items-center gap-1">
        <button type="button" onClick={onDown} aria-label={`${label} down`} className={b}>
          {vertical ? <ChevronDown className="size-4" /> : <Minus className="size-4" />}
        </button>
        <button type="button" onClick={onUp} aria-label={`${label} up`} className={b}>
          {vertical ? <ChevronUp className="size-4" /> : <Plus className="size-4" />}
        </button>
      </div>
    </div>
  )
}
