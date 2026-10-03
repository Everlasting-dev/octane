"use client"

import { useEffect, useState } from "react"
import { ChevronLeft, ChevronRight, Keyboard, LogOut, RotateCcw, Search, X } from "lucide-react"
import { DisplayPanel, type DisplaySettings } from "./display-panel"
import { isDesktopAuth, logout } from "@/lib/auth"
import { getVinMode, setVinMode } from "@/lib/vin/settings"
import type { VinMode } from "@/lib/vin/types"
import {
  ACTION_GROUPS,
  ACTIONS,
  DEFAULT_BINDINGS,
  loadBindings,
  saveBindings,
  keyLabel,
  comboFromEvent,
  isModifierKey,
  sameCombo,
  type ActionId,
  type Bindings,
} from "@/lib/keybindings"
import { cn } from "@/lib/utils"
import { loadFailsafeTable, saveFailsafeTable, type FailsafeTable } from "@/lib/flag-decoders"
import { CURSOR_SPEEDS, loadCursorSpeed, saveCursorSpeed } from "@/lib/cursor-speed"

function ShortcutEditor() {
  const [bindings, setBindings] = useState<Bindings>(DEFAULT_BINDINGS)
  const [recording, setRecording] = useState<ActionId | null>(null)
  const [query, setQuery] = useState("")

  useEffect(() => setBindings(loadBindings()), [])

  useEffect(() => {
    if (!recording) return
    const action = recording
    function onKey(e: KeyboardEvent) {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === "Escape") {
        setRecording(null)
        return
      }
      // Wait for the real key while only Ctrl/Shift/Alt are held.
      if (isModifierKey(e.key)) return
      const combo = comboFromEvent(e)
      setBindings((prev) => {
        const next = { ...prev }
        const other = (Object.keys(next) as ActionId[]).find((id) => id !== action && sameCombo(next[id], combo))
        if (other) next[other] = prev[action] // swap to keep combos unique
        next[action] = combo
        saveBindings(next)
        return next
      })
      setRecording(null)
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [recording])

  function reset() {
    saveBindings(DEFAULT_BINDINGS)
    setBindings({ ...DEFAULT_BINDINGS })
  }

  function resetOne(id: ActionId) {
    setBindings((prev) => {
      const next = { ...prev }
      const def = DEFAULT_BINDINGS[id]
      const other = (Object.keys(next) as ActionId[]).find((x) => x !== id && sameCombo(next[x], def))
      if (other) next[other] = prev[id]
      next[id] = def
      saveBindings(next)
      return next
    })
  }

  const q = query.trim().toLowerCase()

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a shortcut…"
            className="h-8 w-full rounded-md border border-border bg-card pl-8 pr-2 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-ring"
          />
        </div>
        <button
          type="button"
          onClick={reset}
          className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-card px-2.5 text-[11px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <RotateCcw className="size-3" />
          Reset all
        </button>
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Click a key, then press the new key or combo (Ctrl / Shift / Alt + key). If another shortcut already uses it, the two swap. Esc cancels.
      </p>
      {ACTION_GROUPS.map((g) => {
        const items = ACTIONS.filter((a) => a.group === g.id && (!q || a.label.toLowerCase().includes(q) || keyLabel(bindings[a.id]).toLowerCase().includes(q)))
        if (!items.length) return null
        return (
          <section key={g.id} className="rounded-lg border border-border bg-card/40 px-3 py-2">
            <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-foreground">{g.title}</h4>
            <ul className="flex flex-col">
              {items.map((a) => {
                const changed = !sameCombo(bindings[a.id], DEFAULT_BINDINGS[a.id])
                return (
                  <li key={a.id} className="flex items-center justify-between gap-2 border-t border-border/50 py-1.5 first:border-t-0">
                    <span className="min-w-0 text-xs text-foreground">{a.label}</span>
                    <span className="flex shrink-0 items-center gap-1">
                      {changed && (
                        <button
                          type="button"
                          onClick={() => resetOne(a.id)}
                          title={`Back to ${keyLabel(DEFAULT_BINDINGS[a.id])}`}
                          aria-label="Reset this shortcut"
                          className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-secondary hover:text-foreground"
                        >
                          <RotateCcw className="size-3" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setRecording(a.id)}
                        className={cn(
                          "min-w-20 rounded-md border border-b-2 px-2 py-0.5 text-center font-mono text-[11px] transition-colors",
                          recording === a.id
                            ? "animate-pulse border-primary bg-primary/15 text-foreground"
                            : changed
                              ? "border-primary/50 bg-primary/10 text-foreground hover:border-primary"
                              : "border-border bg-secondary text-foreground hover:border-ring",
                        )}
                      >
                        {recording === a.id ? "press keys…" : keyLabel(bindings[a.id])}
                      </button>
                    </span>
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

export function SettingsModal({
  open,
  settings,
  onChange,
  onReset,
  onClose,
  initialPage = "main",
}: {
  open: boolean
  settings: DisplaySettings
  onChange: (next: DisplaySettings) => void
  onReset: () => void
  onClose: () => void
  initialPage?: "main" | "keys"
}) {
  const [page, setPage] = useState<"main" | "keys">(initialPage)
  const [cursorSpeed, setCursorSpeedState] = useState("slow")
  const [vinMode, setVinModeState] = useState<VinMode>("online")
  const [failsafeTable, setFailsafeTable] = useState<FailsafeTable>("phase6")
  // Always return to the main page each time the modal opens; sync VIN mode.
  useEffect(() => {
    if (open) {
      setPage(initialPage)
      setCursorSpeedState(loadCursorSpeed())
      setVinModeState(getVinMode())
      setFailsafeTable(loadFailsafeTable())
    }
  }, [open, initialPage])

  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[calc(100dvh-1rem)] min-h-0 w-full max-w-md flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-2xl sm:max-h-[min(90dvh,44rem)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3 sm:px-5 sm:py-4">
          <div className="flex items-center gap-2">
            {page === "keys" && (
              <button
                type="button"
                onClick={() => setPage("main")}
                aria-label="Back"
                className="inline-flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                <ChevronLeft className="size-4" />
              </button>
            )}
            <h3 className="text-sm font-semibold text-foreground">{page === "keys" ? "Key bindings" : "Settings"}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex size-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        {page === "main" ? (
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-5">
            <div className="flex flex-col gap-5">
            <DisplayPanel settings={settings} onChange={onChange} onReset={onReset} />

            <button
              type="button"
              onClick={() => setPage("keys")}
              className="hidden items-center justify-between rounded-md border border-border bg-card px-3 py-2.5 text-sm text-foreground transition-colors hover:bg-secondary lg:flex"
            >
              <span className="flex items-center gap-2">
                <Keyboard className="size-4 text-muted-foreground" />
                Key bindings
              </span>
              <ChevronRight className="size-4 text-muted-foreground" />
            </button>

            <div className="flex flex-col gap-2 border-t border-border pt-4">
              <span className="text-xs font-medium text-foreground">VIN decoding</span>
              <div className="flex rounded-lg border border-border bg-secondary/40 p-0.5">
                {(["online", "local", "off"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => {
                      setVinMode(m)
                      setVinModeState(m)
                    }}
                    className={cn(
                      "flex-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
                      vinMode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {m === "online" ? "Online" : m === "local" ? "Local only" : "Off"}
                  </button>
                ))}
              </div>
              <p className="text-[10px] leading-relaxed text-muted-foreground">
                Online uses the public NHTSA database; Local only decodes offline from the VIN; Off disables it.
              </p>
            </div>

            <div className="flex flex-col gap-2 border-t border-border pt-4">
              <span className="text-xs font-medium text-foreground">Cursor glide speed</span>
              <div className="flex rounded-lg border border-border bg-secondary/40 p-0.5">
                {CURSOR_SPEEDS.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      saveCursorSpeed(s.id)
                      setCursorSpeedState(s.id)
                    }}
                    className={cn(
                      "flex-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
                      cursorSpeed === s.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              <p className="text-[10px] leading-relaxed text-muted-foreground">
                How fast the value cursor moves while you hold the arrow key: it crosses the visible graph in{" "}
                {CURSOR_SPEEDS.find((s) => s.id === cursorSpeed)?.secondsPerScreen ?? 20} seconds. A tap always moves one sample. Zoom in to go slower through the data.
              </p>
            </div>

            <div className="flex flex-col gap-2 border-t border-border pt-4">
              <span className="text-xs font-medium text-foreground">Failsafe flag decoding</span>
              <div className="flex rounded-lg border border-border bg-secondary/40 p-0.5">
                {(["phase6", "current"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => {
                      saveFailsafeTable(m)
                      setFailsafeTable(m)
                    }}
                    className={cn(
                      "flex-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
                      failsafeTable === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {m === "phase6" ? "Phase 6 RaceROM" : "Newer RaceROM"}
                  </button>
                ))}
              </div>
              <p className="text-[10px] leading-relaxed text-muted-foreground">
                Phase 6 (RaceROM 5xxxx): 16 = low relative fuel pressure, 32 = lean AFR. Newer RaceROM per EcuTek&apos;s current guide: 16 = lean AFR, 32 = low relative fuel pressure. CSP and MIL decoding is the same for both.
              </p>
            </div>

            {isDesktopAuth() && (
              <div className="border-t border-border pt-4">
                <button
                  type="button"
                  onClick={async () => {
                    await logout()
                    window.location.reload()
                  }}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-secondary"
                >
                  <LogOut className="size-3.5" />
                  Sign out
                </button>
              </div>
            )}
            </div>
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-5">
            <ShortcutEditor />
          </div>
        )}
      </div>
    </div>
  )
}
