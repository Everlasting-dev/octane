"use client"

import { useMemo } from "react"
import { TriangleAlert } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Signal } from "@/lib/telemetry"
import {
  decodeValue,
  decoderFor,
  describe,
  stepValueAt,
  tripTimes,
  useFlagDecoders,
  type FlagDecoder,
  type FlagSeverity,
} from "@/lib/flag-decoders"

const ORDER: FlagDecoder["id"][] = ["failsafe", "failsafeStored", "mil", "csp"]

function tone(severity: FlagSeverity | null, zero: boolean, id: FlagDecoder["id"]): string {
  if (zero) return id === "failsafe" ? "text-emerald-400/80" : "text-muted-foreground/70"
  if (severity === "alert") return id === "failsafeStored" ? "text-amber-300" : "text-red-400"
  if (severity === "warn") return "text-amber-300"
  return "text-foreground/85"
}

/**
 * Subtle decoded ECU-flag line under the plots: Failsafe, Failsafe Stored,
 * MIL Source and CSP Flags at the cursor (or at the end of the window when no
 * cursor is placed). Failsafe trips in the log are listed as jump buttons.
 */
export function FlagStrip({
  signals,
  cursorT,
  domain,
  timeUnit,
  onJump,
}: {
  signals: Signal[]
  cursorT: number | null
  domain: [number, number]
  timeUnit: string
  onJump: (t: number) => void
}) {
  const decoders = useFlagDecoders()
  const channels = useMemo(() => {
    const found: { dec: FlagDecoder; signal: Signal }[] = []
    for (const signal of signals) {
      const dec = decoderFor(signal.label, decoders)
      if (dec && !found.some((f) => f.dec.id === dec.id)) found.push({ dec, signal })
    }
    return found.sort((a, b) => ORDER.indexOf(a.dec.id) - ORDER.indexOf(b.dec.id))
  }, [signals, decoders])

  const trips = useMemo(() => {
    const fs = channels.find((c) => c.dec.id === "failsafe")
    if (!fs) return []
    return tripTimes(fs.signal.data).map((t) => {
      const d = decodeValue(fs.dec, stepValueAt(fs.signal.data, t))
      return { t, text: describe(fs.dec, d, true) }
    })
  }, [channels])

  if (!channels.length) return null
  const atCursor = cursorT != null
  const t = cursorT ?? domain[1]

  return (
    <div
      className="octane-flag-strip flex h-8 shrink-0 items-center gap-4 overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden border-t border-border bg-card/50 px-3 font-mono text-[11px] text-muted-foreground sm:px-5"
      aria-label="Decoded ECU flags"
    >
      <span className="shrink-0 tabular-nums text-muted-foreground/70" title={atCursor ? "Decoded at the cursor" : "No cursor: decoded at the end of the window"}>
        {atCursor ? "@" : "end"} {t.toFixed(2)}
        {timeUnit}
      </span>
      {trips.length > 0 && (
        <span className="flex shrink-0 items-center gap-1.5">
          {trips.slice(0, 3).map((trip) => (
            <button
              key={trip.t}
              type="button"
              onClick={() => onJump(trip.t)}
              title={`Failsafe tripped: ${trip.text}. Jump to ${trip.t.toFixed(2)}${timeUnit}`}
              className="inline-flex items-center gap-1 rounded border border-red-500/30 bg-red-500/10 px-1.5 py-0.5 text-red-300 transition-colors hover:bg-red-500/20"
            >
              <TriangleAlert className="size-3" />
              {trip.text} @ {trip.t.toFixed(2)}
              {timeUnit}
            </button>
          ))}
          {trips.length > 3 && <span className="text-red-300/80">+{trips.length - 3}</span>}
        </span>
      )}
      {channels.map(({ dec, signal }) => {
        const d = decodeValue(dec, stepValueAt(signal.data, t))
        const zero = !d || d.value === 0
        const full = describe(dec, d)
        const compact = describe(dec, d, true)
        return (
          <span key={dec.id} className="flex shrink-0 items-center gap-1.5" title={`${signal.label} = ${d?.value ?? "--"}: ${full}`}>
            <span className="text-muted-foreground/60">{dec.short}</span>
            <span className={cn(tone(d?.severity ?? null, zero, dec.id))}>
              {dec.id === "csp" && d && d.value !== 0 ? <span className="mr-1 text-muted-foreground/60">{d.value}</span> : null}
              {compact}
            </span>
          </span>
        )
      })}
    </div>
  )
}
