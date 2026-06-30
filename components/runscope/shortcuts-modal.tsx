"use client"

import { X } from "lucide-react"
import { ACTIONS, keyLabel, useBindings, type ActionContext } from "@/lib/keybindings"
import { cn } from "@/lib/utils"
import type { ViewMode } from "./rail"

const GROUPS: { context: ActionContext; title: string }[] = [
  { context: "plot", title: "Analysis Plot" },
  { context: "matrix", title: "Signal Matrix" },
  { context: "compare", title: "Compare" },
  { context: "global", title: "General" },
]

const FIXED: { combo: string; label: string }[] = [
  { combo: "Ctrl+O", label: "Open log" },
  { combo: "Ctrl+K", label: "Search channels" },
  { combo: "?", label: "Toggle this cheat-sheet" },
  { combo: "Esc", label: "Close / exit current mode" },
]

function viewContext(view: ViewMode): ActionContext {
  return view === "plot" ? "plot" : view === "compare" ? "compare" : "matrix"
}

function Row({ combo, label }: { combo: string; label: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <span className="min-w-0 text-xs text-foreground">{label}</span>
      <kbd className="shrink-0 rounded border border-border bg-secondary px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
        {combo}
      </kbd>
    </div>
  )
}

export function ShortcutsModal({ open, view, onClose }: { open: boolean; view: ViewMode; onClose: () => void }) {
  const bindings = useBindings()
  if (!open) return null

  const active = viewContext(view)
  // The active view's shortcuts first, then the rest.
  const ordered = [...GROUPS].sort((a, b) => Number(b.context === active) - Number(a.context === active))

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h3 className="text-sm font-semibold text-foreground">Keyboard shortcuts</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex size-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="flex flex-col gap-4 overflow-y-auto p-5">
          {ordered.map((g) => {
            const items = ACTIONS.filter((a) => a.context === g.context)
            if (!items.length) return null
            return (
              <section key={g.context}>
                <h4
                  className={cn(
                    "mb-1 text-xs font-semibold uppercase tracking-wider",
                    g.context === active ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {g.title}
                  {g.context === active && <span className="ml-2 font-normal normal-case text-muted-foreground">current view</span>}
                </h4>
                <div className="divide-y divide-border">
                  {items.map((a) => (
                    <Row key={a.id} label={a.label} combo={keyLabel(bindings[a.id])} />
                  ))}
                </div>
              </section>
            )
          })}

          <section>
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Always</h4>
            <div className="divide-y divide-border">
              {FIXED.map((f) => (
                <Row key={f.combo} label={f.label} combo={f.combo} />
              ))}
            </div>
          </section>

          <p className="text-[10px] leading-relaxed text-muted-foreground">
            Single-key shortcuts are remappable in Settings → Key bindings.
          </p>
        </div>
      </div>
    </div>
  )
}
