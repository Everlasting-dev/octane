"use client"

// Decoders for EcuTek RaceROM (Nissan GT-R ECM) bitfield channels.
//
// Sources:
// - CSP Flags, MIL Source: EcuTek "GT-R RaceROM Tuning Guide" (support wiki).
// - Failsafe (Limp Mode) Flags: EcuTek "ProECU Nissan GT-R Phase 6 RaceROM
//   Manual" (14-Feb-2018), p.29 — and the current "GT-R RaceROM Failsafes" wiki
//   page, which swaps 16/32 and adds bits 256+ for newer RaceROM.
//   Logs from RaceROM 50011/50021 trip 16 with rich AFR and sagging relative
//   fuel pressure, i.e. the Phase 6 manual ordering, so that's the default.

import { useEffect, useState } from "react"
import type { SignalSample } from "./telemetry"

export type FlagSeverity = "info" | "warn" | "alert"

export interface FlagBit {
  value: number
  label: string
  /** compact label for tight spaces (readouts, phone strip) */
  short: string
  severity: FlagSeverity
}

export interface FlagDecoder {
  id: "csp" | "failsafe" | "failsafeStored" | "mil"
  title: string
  short: string
  match: RegExp
  bits: FlagBit[]
  /** whole-value meanings that are not a plain sum of bits */
  exact?: Record<number, string>
  /** what to say when the value is 0 */
  zero: string
}

const b = (value: number, label: string, short: string, severity: FlagSeverity = "info"): FlagBit => ({ value, label, short, severity })

const CSP_BITS: FlagBit[] = [
  b(1, "Outside upshift exclusion time", "outside upshift excl. time"),
  b(2, "Minimum slip condition met", "min slip"),
  b(4, "Minimum input shaft speed condition met", "min input speed"),
  b(8, "Minimum load condition met", "min load"),
  b(16, "Minimum slip error condition met", "min slip error"),
  b(32, "Minimum vehicle speed condition met", "min vehicle speed"),
  b(128, "Clutch slip control is active", "CSP ACTIVE", "alert"),
]

const FAILSAFE_COMMON_LOW: FlagBit[] = [
  b(1, "Knock retard", "knock retard", "alert"),
  b(2, "Low oil pressure", "low oil pressure", "alert"),
  b(4, "High oil temperature", "high oil temp", "alert"),
  b(8, "High short term fuel trim", "high fuel trim", "alert"),
]
const FAILSAFE_COMMON_HIGH: FlagBit[] = [
  b(64, "High coolant pressure", "high coolant pressure", "alert"),
  b(128, "Custom maps limp mode", "custom maps limp", "alert"),
  b(256, "Ethanol input error", "ethanol input error", "alert"),
  b(512, "CAN input failure", "CAN input failure", "alert"),
  b(1024, "CAN error received", "CAN error", "alert"),
  b(2048, "Secondary injection error", "secondary injection error", "alert"),
  b(4096, "CAN output failure", "CAN output failure", "alert"),
  b(8192, "Tuner specified failsafe", "tuner failsafe", "alert"),
]

/** Phase 6 manual: 16 = low relative fuel pressure, 32 = lean AFR. */
const FAILSAFE_PHASE6: FlagBit[] = [
  ...FAILSAFE_COMMON_LOW,
  b(16, "Low relative fuel pressure", "low fuel pressure", "alert"),
  b(32, "Lean AFR", "lean AFR", "alert"),
  ...FAILSAFE_COMMON_HIGH,
]
/** Current EcuTek wiki: 16 = lean AFR, 32 = low relative fuel pressure. */
const FAILSAFE_CURRENT: FlagBit[] = [
  ...FAILSAFE_COMMON_LOW,
  b(16, "Lean AFR", "lean AFR", "alert"),
  b(32, "Low relative fuel pressure", "low fuel pressure", "alert"),
  ...FAILSAFE_COMMON_HIGH,
]

const MIL_BITS: FlagBit[] = [
  b(1, "Failsafe", "failsafe", "alert"),
  b(2, "Knock warning", "knock warning", "alert"),
  b(4, "Clutch slip", "clutch slip", "warn"),
  b(8, "Custom sensor voltage out of range", "custom sensor fault", "warn"),
  b(64, "Live tuning", "live tuning", "info"),
  b(128, "Custom maps failsafe", "custom maps failsafe", "alert"),
]

export type FailsafeTable = "phase6" | "current"

export function buildDecoders(table: FailsafeTable): FlagDecoder[] {
  const fs = table === "current" ? FAILSAFE_CURRENT : FAILSAFE_PHASE6
  return [
    { id: "csp", title: "CSP", short: "CSP", match: /^csp flags$/i, bits: CSP_BITS, zero: "no conditions met" },
    // "Stored" first so the plain failsafe regex doesn't swallow it.
    { id: "failsafeStored", title: "Stored", short: "Stored", match: /^(failsafe|limp mode) stored flags$/i, bits: fs, zero: "none" },
    { id: "failsafe", title: "Failsafe", short: "Failsafe", match: /^(failsafe|limp mode) flags$/i, bits: fs, zero: "OK" },
    { id: "mil", title: "MIL", short: "MIL", match: /^mil source$/i, bits: MIL_BITS, exact: { 31: "All sources", 48: "Beta (reserved)" }, zero: "off" },
  ]
}

export function decoderFor(label: string, decoders: FlagDecoder[]): FlagDecoder | null {
  const l = label.trim()
  return decoders.find((d) => d.match.test(l)) ?? null
}

export interface Decoded {
  value: number
  active: FlagBit[]
  /** bits set that this table doesn't know */
  unknown: number
  exact?: string
  severity: FlagSeverity | null
}

export function decodeValue(dec: FlagDecoder, raw: number | null | undefined): Decoded | null {
  if (raw == null || !Number.isFinite(raw)) return null
  const value = Math.round(raw)
  const exact = dec.exact?.[value]
  if (exact) return { value, active: [], unknown: 0, exact, severity: "warn" }
  const active = dec.bits.filter((bit) => (value & bit.value) !== 0)
  const known = dec.bits.reduce((m, bit) => m | bit.value, 0)
  const unknown = value & ~known
  const rank = { info: 0, warn: 1, alert: 2 } as const
  const severity = active.reduce<FlagSeverity | null>((s, bit) => (s == null || rank[bit.severity] > rank[s] ? bit.severity : s), null)
  return { value, active, unknown, severity }
}

export function describe(dec: FlagDecoder, d: Decoded | null, compact = false): string {
  if (!d) return "--"
  if (d.exact) return d.exact
  if (d.value === 0) return dec.zero
  const parts = d.active.map((bit) => (compact ? bit.short : bit.label))
  if (d.unknown) parts.push(`unknown bits ${d.unknown}`)
  return parts.join(" + ")
}

/** Flags are discrete: value of the last sample at or before t (no interpolation). */
export function stepValueAt(data: SignalSample[], t: number): number | null {
  if (!data.length) return null
  if (t < data[0].t) return data[0].value
  let lo = 0
  let hi = data.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (data[mid].t <= t) lo = mid
    else hi = mid - 1
  }
  return data[lo].value
}

/** Times where the value changes from 0 to non-zero (first sample of each trip). */
export function tripTimes(data: SignalSample[]): number[] {
  const out: number[] = []
  let prev = 0
  for (const d of data) {
    const v = d.value ?? 0
    if (v && !prev) out.push(d.t)
    prev = v
  }
  return out
}

// ---------------------------------------------------------------------------
// Which failsafe table to use (Settings). Phase 6 manual order by default.

const TABLE_KEY = "octane:failsafe-table"
const TABLE_EVT = "octane:failsafe-table-changed"

export function loadFailsafeTable(): FailsafeTable {
  if (typeof window === "undefined") return "phase6"
  try {
    return window.localStorage.getItem(TABLE_KEY) === "current" ? "current" : "phase6"
  } catch {
    return "phase6"
  }
}

export function saveFailsafeTable(t: FailsafeTable) {
  try {
    window.localStorage.setItem(TABLE_KEY, t)
    window.dispatchEvent(new Event(TABLE_EVT))
  } catch {
    /* ignore */
  }
}

export function useFlagDecoders(): FlagDecoder[] {
  const [table, setTable] = useState<FailsafeTable>("phase6")
  useEffect(() => {
    setTable(loadFailsafeTable())
    const h = () => setTable(loadFailsafeTable())
    window.addEventListener(TABLE_EVT, h)
    return () => window.removeEventListener(TABLE_EVT, h)
  }, [])
  const [decoders, setDecoders] = useState(() => buildDecoders("phase6"))
  useEffect(() => setDecoders(buildDecoders(table)), [table])
  return decoders
}
