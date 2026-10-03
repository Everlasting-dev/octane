"use client"

import { useMemo, useState } from "react"
import { Keyboard, Search, X } from "lucide-react"
import { ACTION_GROUPS, ACTION_PAIRS, ACTIONS, keyLabel, useBindings, type ActionGroup, type ActionId } from "@/lib/keybindings"
import { cn } from "@/lib/utils"
import type { ViewMode } from "./rail"

/** Groups to open with, per screen (the rest follow). */
function firstGroups(view: ViewMode): ActionGroup[] {
  if (view === "plot" || view === "channels") return ["time", "lines"]
  return ["time", "files"]
}

function Keys({ combos }: { combos: string[] }) {
  return (
    <span className="flex shrink-0 items-center gap-1">
      {combos.map((c, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && <span className="text-[10px] text-muted-foreground">/</span>}
          {c.split(" + ").map((part, j) => (
            <kbd
              key={j}
              className="min-w-6 rounded-md border border-border border-b-2 bg-secondary px-1.5 py-0.5 text-center font-mono text-[11px] font-medium text-foreground"
            >
              {part}
            </kbd>
          ))}
        </span>
      ))}
    </span>
  )
}

interface Row {
  id: string
  label: string
  combos: string[]
}

/** Keyboard shortcuts, grouped by task. Every shortcut can be changed in Settings. */
export function ShortcutsModal({
  open,
  view,
  onClose,
  onEditBindings,
}: {
  open: boolean
  view: ViewMode
  onClose: () => void
  onEditBindings?: () => void
}) {
  const bindings = useBindings()
  const [query, setQuery] = useState("")

  const groups = useMemo(() => {
    const paired = new Set<ActionId>()
    const rows: Record<ActionGroup, Row[]> = { time: [], lines: [], views: [], files: [], tools: [] }
    for (const action of ACTIONS) {
      if (paired.has(action.id)) continue
      const pair = ACTION_PAIRS.find((p) => p.a === action.id || p.b === action.id)
      if (pair) {
        paired.add(pair.a)
        paired.add(pair.b)
        rows[action.group].push({ id: pair.a, label: pair.label, combos: [keyLabel(bindings[pair.a]), keyLabel(bindings[pair.b])] })
      } else {
        rows[action.group].push({ id: action.id, label: action.label, combos: [keyLabel(bindings[action.id])] })
      }
    }
    rows.tools.push({ id: "esc", label: "Close / cancel (always Esc)", combos: ["Esc"] })
    const order = [...firstGroups(view), ...ACTION_GROUPS.map((g) => g.id).filter((g) => !firstGroups(view).includes(g))]
    const q = query.trim().toLowerCase()
    return order
      .map((id) => {
        const meta = ACTION_GROUPS.find((g) => g.id === id)!
        const list = q ? rows[id].filter((r) => r.label.toLowerCase().includes(q) || r.combos.join(" ").toLowerCase().includes(q)) : rows[id]
        return { ...meta, rows: list }
      })
      .filter((g) => g.rows.length > 0)
  }, [bindings, query, view])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Keyboard shortcuts"
      >
        <div className="flex items-center gap-3 border-b border-border px-5 py-3">
          <Keyboard className="size-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">Keyboard shortcuts</h3>
          <div className="relative ml-auto w-56">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a shortcut…"
              className="h-8 w-full rounded-md border border-border bg-card pl-8 pr-2 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-ring"
            />
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 gap-3 overflow-y-auto p-4 md:grid-cols-2">
          {groups.map((g, gi) => (
            <section key={g.id} className={cn("rounded-lg border border-border bg-card/50 p-3", gi < 2 && "border-primary/30")}>
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-foreground">{g.title}</h4>
                <span className="text-[10px] text-muted-foreground">{g.hint}</span>
              </div>
              <div className="flex flex-col">
                {g.rows.map((r) => (
                  <div key={r.id} className="flex items-center justify-between gap-3 border-t border-border/50 py-1.5 first:border-t-0">
                    <span className="min-w-0 text-xs text-foreground">{r.label}</span>
                    <Keys combos={r.combos} />
                  </div>
                ))}
              </div>
            </section>
          ))}
          {groups.length === 0 && <p className="col-span-full py-10 text-center text-sm text-muted-foreground">No shortcut matches “{query}”.</p>}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border bg-card/40 px-5 py-2.5">
          <span className="text-[11px] text-muted-foreground">Tip: click a graph first, then use the keys. Hold the cursor key to glide.</span>
          {onEditBindings && (
            <button
              type="button"
              onClick={onEditBindings}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            >
              Change shortcuts
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
