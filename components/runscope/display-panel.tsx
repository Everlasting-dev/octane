"use client"

import { cn } from "@/lib/utils"

export type CurveType = "monotone" | "linear" | "step"
export type ChartHeight = "mini" | "compact" | "normal" | "tall"

export interface DisplaySettings {
  lineWidth: number
  curve: CurveType
  showGrid: boolean
  height: ChartHeight
  focusDim: boolean
}

export const DEFAULT_DISPLAY: DisplaySettings = {
  lineWidth: 0.5,
  curve: "monotone",
  showGrid: true,
  height: "normal",
  focusDim: true,
}

interface DisplayPanelProps {
  settings: DisplaySettings
  onChange: (next: DisplaySettings) => void
  onReset: () => void
}

function Field({ label, value, children }: { label: string; value?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-foreground">{label}</span>
        {value != null && <span className="font-mono text-[11px] text-muted-foreground">{value}</span>}
      </div>
      {children}
    </div>
  )
}

function Slider({
  min,
  max,
  step,
  value,
  onChange,
}: {
  min: number
  max: number
  step: number
  value: number
  onChange: (v: number) => void
}) {
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-secondary accent-primary"
    />
  )
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { label: string; value: T }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div className="flex rounded-lg border border-border bg-secondary/40 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "flex-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
            value === o.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function SwitchRow({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex items-center justify-between gap-3 text-left"
    >
      <span className="text-xs font-medium text-foreground">{label}</span>
      <span
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
          checked ? "bg-primary" : "bg-secondary",
        )}
      >
        <span
          className={cn(
            "inline-block size-4 transform rounded-full bg-background shadow transition-transform",
            checked ? "translate-x-4" : "translate-x-0.5",
          )}
        />
      </span>
    </button>
  )
}

export function DisplayPanel({ settings, onChange, onReset }: DisplayPanelProps) {
  const set = <K extends keyof DisplaySettings>(key: K, value: DisplaySettings[K]) =>
    onChange({ ...settings, [key]: value })

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">Display</h2>
        <button
          type="button"
          onClick={onReset}
          className="rounded px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          Reset
        </button>
      </div>

      <Field label="Line thickness" value={`${settings.lineWidth.toFixed(2)} px`}>
        <Slider min={0.5} max={4} step={0.25} value={settings.lineWidth} onChange={(v) => set("lineWidth", v)} />
      </Field>

      <Field label="Curve">
        <Segmented
          value={settings.curve}
          onChange={(v) => set("curve", v)}
          options={[
            { label: "Smooth", value: "monotone" },
            { label: "Linear", value: "linear" },
            { label: "Step", value: "step" },
          ]}
        />
      </Field>

      <Field label="Chart height" value="more rows = smaller">
        <Segmented
          value={settings.height}
          onChange={(v) => set("height", v)}
          options={[
            { label: "Mini", value: "mini" },
            { label: "Compact", value: "compact" },
            { label: "Normal", value: "normal" },
            { label: "Tall", value: "tall" },
          ]}
        />
      </Field>

      <div className="flex flex-col gap-3 border-t border-border pt-4">
        <SwitchRow label="Grid lines" checked={settings.showGrid} onChange={(v) => set("showGrid", v)} />
        <SwitchRow
          label="Dim unfocused lines (Analysis Plot)"
          checked={settings.focusDim}
          onChange={(v) => set("focusDim", v)}
        />
      </div>
    </div>
  )
}
