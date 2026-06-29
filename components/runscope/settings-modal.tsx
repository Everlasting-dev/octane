"use client"

import { useEffect, useState } from "react"
import { ChevronLeft, ChevronRight, Keyboard, LogOut, X } from "lucide-react"
import { DisplayPanel, type DisplaySettings } from "./display-panel"
import { isDesktopAuth, logout } from "@/lib/auth"
import { getVinMode, setVinMode } from "@/lib/vin/settings"
import type { VinMode } from "@/lib/vin/types"
import {
  ACTIONS,
  DEFAULT_BINDINGS,
  loadBindings,
  saveBindings,
  keyLabel,
  type ActionId,
  type Bindings,
} from "@/lib/keybindings"
import { cn } from "@/lib/utils"

function ShortcutEditor() {
  const [bindings, setBindings] = useState<Bindings>(DEFAULT_BINDINGS)
  const [recording, setRecording] = useState<ActionId | null>(null)

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
      const key = e.key
      setBindings((prev) => {
        const next = { ...prev }
        const other = (Object.keys(next) as ActionId[]).find(
          (id) => id !== action && next[id].toLowerCase() === key.toLowerCase(),
        )
        if (other) next[other] = prev[action] // swap to keep keys unique
        next[action] = key
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

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={reset}
          className="rounded px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          Reset to defaults
        </button>
      </div>
      <ul className="flex flex-col divide-y divide-border">
        {ACTIONS.map((a) => (
          <li key={a.id} className="flex items-center justify-between gap-3 py-1.5">
            <span className="text-xs text-foreground">{a.label}</span>
            <button
              type="button"
              onClick={() => setRecording(a.id)}
              className={cn(
                "min-w-16 rounded border px-2 py-0.5 text-center font-mono text-[11px] transition-colors",
                recording === a.id
                  ? "animate-pulse border-primary bg-primary/15 text-foreground"
                  : "border-border bg-secondary text-muted-foreground hover:text-foreground",
              )}
            >
              {recording === a.id ? "press a key…" : keyLabel(bindings[a.id])}
            </button>
          </li>
        ))}
      </ul>
      <p className="text-[10px] leading-relaxed text-muted-foreground">
        Single keys only · Esc cancels · Ctrl+O / Ctrl+K / ? stay fixed.
      </p>
    </div>
  )
}

export function SettingsModal({
  open,
  settings,
  onChange,
  onReset,
  onClose,
}: {
  open: boolean
  settings: DisplaySettings
  onChange: (next: DisplaySettings) => void
  onReset: () => void
  onClose: () => void
}) {
  const [page, setPage] = useState<"main" | "keys">("main")
  const [vinMode, setVinModeState] = useState<VinMode>("online")
  // Always return to the main page each time the modal opens; sync VIN mode.
  useEffect(() => {
    if (open) {
      setPage("main")
      setVinModeState(getVinMode())
    }
  }, [open])

  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-sm flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
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
          <div className="flex flex-col gap-5 overflow-y-auto p-5">
            <DisplayPanel settings={settings} onChange={onChange} onReset={onReset} />

            <button
              type="button"
              onClick={() => setPage("keys")}
              className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2.5 text-sm text-foreground transition-colors hover:bg-secondary"
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
        ) : (
          <div className="overflow-y-auto p-5">
            <ShortcutEditor />
          </div>
        )}
      </div>
    </div>
  )
}
