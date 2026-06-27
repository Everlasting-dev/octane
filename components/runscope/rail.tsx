"use client"

import { GitCompare, HelpCircle, Info, LayoutList, LineChart, Settings } from "lucide-react"
import { cn } from "@/lib/utils"
import { OctaneLogo } from "./logo"

export type ViewMode = "matrix" | "plot" | "compare"

function RailButton({
  active,
  disabled,
  label,
  onClick,
  children,
}: {
  active?: boolean
  disabled?: boolean
  label: string
  onClick?: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "inline-flex size-9 items-center justify-center rounded-lg transition-colors",
        active ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-secondary hover:text-foreground",
        disabled && "cursor-not-allowed opacity-40 hover:bg-transparent",
      )}
    >
      {children}
    </button>
  )
}

export function Rail({
  view,
  canCompare,
  onHome,
  onSetView,
  onOpenMetadata,
  onOpenSettings,
  onOpenAbout,
}: {
  view: ViewMode
  canCompare: boolean
  onHome?: () => void
  onSetView: (v: ViewMode) => void
  onOpenMetadata: () => void
  onOpenSettings: () => void
  onOpenAbout: () => void
}) {
  return (
    <aside className="sticky top-0 flex h-screen w-14 shrink-0 flex-col items-center gap-1 border-r border-border bg-background py-3">
      <button
        type="button"
        onClick={onHome}
        title="Home"
        aria-label="Home"
        className="mb-2 inline-flex size-9 items-center justify-center rounded-lg bg-primary/15 text-primary transition-colors hover:bg-primary/25"
      >
        <OctaneLogo className="size-6" />
      </button>

      <RailButton active={view === "matrix"} label="Signal Matrix" onClick={() => onSetView("matrix")}>
        <LayoutList className="size-5" />
      </RailButton>
      <RailButton active={view === "plot"} label="Analysis Plot" onClick={() => onSetView("plot")}>
        <LineChart className="size-5" />
      </RailButton>
      <RailButton
        active={view === "compare"}
        disabled={!canCompare}
        label={canCompare ? "Compare runs" : "Compare runs (load 2+ logs)"}
        onClick={() => onSetView("compare")}
      >
        <GitCompare className="size-5" />
      </RailButton>

      <div className="mt-auto flex flex-col items-center gap-1">
        <RailButton label="File metadata" onClick={onOpenMetadata}>
          <Info className="size-5" />
        </RailButton>
        <RailButton label="Settings" onClick={onOpenSettings}>
          <Settings className="size-5" />
        </RailButton>
        <RailButton label="About Octane" onClick={onOpenAbout}>
          <HelpCircle className="size-5" />
        </RailButton>
      </div>
    </aside>
  )
}
