"use client"

import { Keyboard, Maximize2, MapPin, Minus, Plus, RotateCcw, Search } from "lucide-react"
import { Toggle } from "./toggle"
import { cn } from "@/lib/utils"

interface ToolbarProps {
  sync: boolean
  onSyncChange: (v: boolean) => void
  windowMode: boolean
  onWindowChange: (v: boolean) => void
  compare: boolean
  onCompareChange: (v: boolean) => void
  canCompare: boolean
  annotate: boolean
  onAnnotateChange: (v: boolean) => void
  zoom: number
  onZoomIn: () => void
  onZoomOut: () => void
  onReset: () => void
  onFit: () => void
  onShowShortcuts: () => void
  query: string
  onQueryChange: (v: string) => void
}

export function Toolbar({
  sync,
  onSyncChange,
  windowMode,
  onWindowChange,
  compare,
  onCompareChange,
  canCompare,
  annotate,
  onAnnotateChange,
  zoom,
  onZoomIn,
  onZoomOut,
  onReset,
  onFit,
  onShowShortcuts,
  query,
  onQueryChange,
}: ToolbarProps) {
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex flex-wrap items-center gap-2">
        <Toggle pressed={sync} onPressedChange={onSyncChange} label="Sync" />
        <Toggle pressed={windowMode} onPressedChange={onWindowChange} label="Window" />
        {canCompare && <Toggle pressed={compare} onPressedChange={onCompareChange} label="Compare" />}
        <button
          type="button"
          onClick={() => onAnnotateChange(!annotate)}
          aria-pressed={annotate}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm transition-colors",
            annotate
              ? "border-primary bg-primary/15 text-foreground"
              : "border-border bg-card text-foreground hover:bg-secondary",
          )}
        >
          <MapPin className="size-3.5" />
          Annotate
        </button>

        <div className="mx-1 hidden h-6 w-px bg-border sm:block" aria-hidden />

        <button
          type="button"
          onClick={onReset}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-sm text-foreground transition-colors hover:bg-secondary"
        >
          <RotateCcw className="size-3.5" />
          Reset
        </button>

        <div className="flex items-center gap-1 rounded-md border border-border bg-card p-0.5">
          <button
            type="button"
            onClick={onZoomOut}
            aria-label="Zoom out"
            className="inline-flex size-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <Minus className="size-4" />
          </button>
          <span className="min-w-12 text-center font-mono text-sm tabular-nums text-foreground">
            {Math.round(zoom)}%
          </span>
          <button
            type="button"
            onClick={onZoomIn}
            aria-label="Zoom in"
            className="inline-flex size-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <Plus className="size-4" />
          </button>
        </div>

        <button
          type="button"
          onClick={onFit}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-sm text-foreground transition-colors hover:bg-secondary"
        >
          <Maximize2 className="size-3.5" />
          Fit
        </button>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative w-full lg:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search signals…"
            className="h-9 w-full rounded-md border border-border bg-card pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
          />
        </div>
        <button
          type="button"
          onClick={onShowShortcuts}
          aria-label="Keyboard shortcuts"
          title="Keyboard shortcuts (?)"
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <Keyboard className="size-4" />
        </button>
      </div>
    </div>
  )
}
