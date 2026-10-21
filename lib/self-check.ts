// Self check: scans a loaded log for conditions worth a second look
// (clutch slip, lean AFR under boost, fuel pressure sag, shift flare, coolant
// pressure, wheel slip, ...). Pure functions only, so it runs the same in the
// app and in scripts/self-check-report.mjs.
//
// Thresholds are defaults, not gospel: every rule exposes its parameters so
// they can be tuned from the Self check panel. Reference values come from the
// Nissan GT-R (R35, VR38DETT) service manual section EC ("FSM EC-xxx"),
// EcuTek RaceROM documentation and common GT-R tuning practice; each rule
// lists its references.
//
// Channel units are normalised before checking: pressures to bar, temperatures
// to °C, speeds to km/h. AFR is EcuTek's gasoline-scale AFR (λ × 14.7) on every
// fuel, including E85.

import type { ParsedLog } from "./csv"
import type { Signal } from "./telemetry"
import { buildDecoders, decodeValue, describe, type FailsafeTable } from "./flag-decoders"

export type CheckSeverity = "info" | "warn" | "critical"
export type CheckSystem =
  | "Transmission"
  | "Fuel"
  | "Ignition"
  | "Boost"
  | "Air & throttle"
  | "Cooling"
  | "Oil"
  | "Electrical"
  | "Traction"
  | "Engine"
  | "ECU"

/** plot shading colours per severity */
export const SEVERITY_FILL: Record<CheckSeverity, string> = { critical: "#f87171", warn: "#fcd34d", info: "#7dd3fc" }

export const SYSTEM_ORDER: CheckSystem[] = [
  "ECU",
  "Transmission",
  "Fuel",
  "Ignition",
  "Boost",
  "Air & throttle",
  "Cooling",
  "Oil",
  "Traction",
  "Electrical",
  "Engine",
]

export interface CheckParam {
  key: string
  label: string
  unit: string
  default: number
  step?: number
}

export interface Finding {
  id: string
  ruleId: string
  system: CheckSystem
  severity: CheckSeverity
  title: string
  detail: string
  start: number
  end: number
  /** time of the worst sample, where "Jump" lands */
  peak: number
  /** labels of the channels worth plotting for this finding */
  channels: string[]
}

export interface RuleDef {
  id: string
  title: string
  system: CheckSystem
  /** what the rule looks for, one sentence */
  summary: string
  /** likely causes and what to check */
  advice: string
  refs: string[]
  dtc?: string[]
  params: CheckParam[]
  /** off by default (noisy or stock-only checks) */
  defaultOff?: boolean
  run: (c: Ctx, p: Record<string, number>, emit: Emit) => void | string
}

export interface RuleResult {
  ruleId: string
  /** channels missing / rule disabled; null when it ran */
  skipped: string | null
  findings: Finding[]
}

export interface CheckReport {
  results: RuleResult[]
  findings: Finding[]
  counts: Record<CheckSeverity, number>
  /** shift events detected (for context in the panel) */
  shifts: number
  sampleRate: number
}

export interface SelfCheckConfig {
  disabled: string[]
  enabled: string[]
  params: Record<string, Record<string, number>>
}

export const EMPTY_CONFIG: SelfCheckConfig = { disabled: [], enabled: [], params: {} }

type EmitInput = {
  severity: CheckSeverity
  title: string
  detail: string
  /** sample indices */
  s: number
  e: number
  peak: number
  channels: (Ch | null | undefined | string)[]
}
type Emit = (f: EmitInput) => void

// ---------------------------------------------------------------------------
// Channels and units

type Kind = "pressure" | "temp" | "speed" | "raw"

export interface Ch {
  label: string
  unit: string
  v: Float64Array
}

const PSI_TO_BAR = 0.0689476
const BAR_TO_PSI = 14.5038

function unitFactor(kind: Kind, unit: string): (x: number) => number {
  const u = unit.toLowerCase()
  if (kind === "pressure") {
    if (/psi/.test(u)) return (x) => x * PSI_TO_BAR
    if (/kpa/.test(u)) return (x) => x / 100
    if (/mbar|hpa/.test(u)) return (x) => x / 1000
    return (x) => x
  }
  if (kind === "temp") {
    // the degree sign is sometimes mis-encoded (e.g. "�C"), so only treat
    // explicit Fahrenheit units as °F
    if (/f$/.test(u) && !/c/.test(u)) return (x) => ((x - 32) * 5) / 9
    return (x) => x
  }
  if (kind === "speed") {
    if (/mph/.test(u)) return (x) => x * 1.60934
    return (x) => x
  }
  return (x) => x
}

/** Not fitted channels log a constant 0; treat those as absent. */
function hasData(s: Signal): boolean {
  for (const d of s.data) {
    if (d.value == null || !Number.isFinite(d.value)) continue
    if (d.value !== 0) return true
  }
  return false
}

export const fmtBar = (bar: number) => `${bar.toFixed(2)} bar (${(bar * BAR_TO_PSI).toFixed(1)} psi)`
const fmt0 = (v: number) => Math.round(v).toLocaleString("en-US")
const fmt1 = (v: number) => v.toFixed(1)
const fmt2 = (v: number) => v.toFixed(2)
const ord = (g: number) => {
  const n = Math.round(g)
  return n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`
}

// ---------------------------------------------------------------------------
// Context: aligned arrays plus derived masks (running, shifting, fuel cut)

export interface ShiftEvent {
  /** index where Gear Desired asked for the new gear */
  start: number
  /** index where Gear reports the new gear */
  engage: number
  /** end of the settling window */
  end: number
  from: number
  to: number
  up: boolean
  pedal: number
}

export class Ctx {
  readonly n: number
  readonly t: Float64Array
  readonly dt: number
  readonly signals: Signal[]
  readonly failsafeTable: FailsafeTable

  readonly rpm: Ch | null
  readonly pedal: Ch | null
  readonly gear: Ch | null
  readonly gearDesired: Ch | null
  readonly speed: Ch | null
  readonly atm: Ch | null
  /** gauge boost (bar) per sample, NaN when unknown */
  readonly boostGauge: Float64Array | null
  /** pedal reading with the foot off (GT-R pedal channels often rest at ~15%) */
  readonly pedalRest: number
  readonly running: Uint8Array
  readonly shifting: Uint8Array
  readonly fuelCut: Uint8Array
  readonly shifts: ShiftEvent[]

  private cache = new Map<string, Ch | null>()

  constructor(log: ParsedLog, opts: { failsafeTable?: FailsafeTable; shiftSettle?: number } = {}) {
    this.signals = log.signals
    this.failsafeTable = opts.failsafeTable ?? "phase6"
    const base = log.signals[0]?.data ?? []
    this.n = base.length
    this.t = Float64Array.from(base, (d) => d.t)
    const steps: number[] = []
    for (let i = 1; i < this.n; i++) {
      const d = this.t[i] - this.t[i - 1]
      if (d > 0 && Number.isFinite(d)) steps.push(d)
    }
    steps.sort((a, b) => a - b)
    this.dt = steps.length ? steps[steps.length >> 1] : 0.1

    this.rpm = this.find([/^engine speed$/i, /^engine rpm$/i, /^rpm$/i])
    this.pedal = this.find([/^accelerator pedal sensor #?1$/i, /^accel(erator)? pedal/i, /^accel position sensor 1$/i, /^throttle position$/i])
    this.gear = this.find([/^gear$/i, /^gear current$/i], "raw", /gear/i) ?? this.find([/^gear$/i])
    this.gearDesired = this.find([/^gear desired$/i], "raw", /gear/i)
    this.speed = this.find([/^vehicle speed$/i, /^vehicle speed 1$/i], "speed")
    this.atm = this.find([/^atmospheric pressure$/i, /^barometric pressure$/i], "pressure")

    const n = this.n
    this.running = new Uint8Array(n)
    if (this.rpm) for (let i = 0; i < n; i++) this.running[i] = this.rpm.v[i] > 400 ? 1 : 0
    {
      const ped = this.pedal ? Array.from(this.pedal.v).filter(Number.isFinite).sort((a, b) => a - b) : []
      this.pedalRest = ped.length ? ped[Math.floor(ped.length * 0.05)] : 0
    }

    // Fuel cut (overrun / shift cut): AFR pegged lean or injector pulse ~0.
    this.fuelCut = new Uint8Array(n)
    const afr = this.find([/^afr b(ank)? ?1$/i, /^afr$/i, /^lambda/i])
    const ipw = this.find([/^injector pulse width bank #?1$/i, /^injector effective pw$/i])
    for (let i = 0; i < n; i++) {
      if ((afr && afr.v[i] >= 20) || (ipw && ipw.v[i] < 0.4)) this.fuelCut[i] = 1
    }

    this.boostGauge = this.computeBoostGauge()
    this.shifts = this.detectShifts(opts.shiftSettle ?? 0.6)
    this.shifting = new Uint8Array(n)
    for (const s of this.shifts) for (let i = s.start; i <= s.end; i++) this.shifting[i] = 1
  }

  /** First present channel whose label matches, converted to canonical units. */
  find(patterns: RegExp[], kind: Kind = "raw", unitRe?: RegExp): Ch | null {
    const key = patterns.map((p) => p.source).join("|") + "@" + kind + (unitRe?.source ?? "")
    if (this.cache.has(key)) return this.cache.get(key)!
    let out: Ch | null = null
    for (const re of patterns) {
      const s = this.signals.find((sig) => re.test(sig.label.trim()) && (!unitRe || unitRe.test(sig.unit)) && hasData(sig))
      if (s) {
        const f = unitFactor(kind, s.unit)
        const v = new Float64Array(this.n)
        for (let i = 0; i < this.n; i++) {
          const x = s.data[i]?.value
          v[i] = x == null || !Number.isFinite(x) ? NaN : f(x)
        }
        out = { label: s.label, unit: s.unit, v }
        break
      }
    }
    this.cache.set(key, out)
    return out
  }

  /** Index count for a duration in seconds (at least 1). */
  samples(sec: number) {
    return Math.max(1, Math.round(sec / this.dt))
  }

  private heldCache = new Map<string, Uint8Array>()
  /**
   * 1 where the pedal has been at or above `min` for at least `sec` seconds
   * (so wideband lag and tip-in transients don't count as load). Without a
   * pedal channel everything counts as held.
   */
  pedalHeld(min: number, sec = 0.3): Uint8Array {
    const key = `${min}:${sec}`
    const hit = this.heldCache.get(key)
    if (hit) return hit
    const out = new Uint8Array(this.n)
    if (!this.pedal) out.fill(1)
    else {
      let since = -1
      for (let i = 0; i < this.n; i++) {
        if (this.pedal.v[i] >= min) {
          if (since < 0) since = i
          out[i] = this.t[i] - this.t[since] >= sec - 1e-9 ? 1 : 0
        } else since = -1
      }
    }
    this.heldCache.set(key, out)
    return out
  }

  private failsafeMask: Uint8Array | null = null
  /** 1 while Failsafe Flags is non-zero (power is being cut on purpose). */
  inFailsafe(i: number): boolean {
    if (!this.failsafeMask) {
      this.failsafeMask = new Uint8Array(this.n)
      const fs = this.find([/^(failsafe|limp mode) flags$/i])
      if (fs) for (let j = 0; j < this.n; j++) this.failsafeMask[j] = fs.v[j] > 0 ? 1 : 0
    }
    return this.failsafeMask[i] === 1
  }

  /** Gauge boost rise rate (bar/s) over the last `sec` seconds. */
  boostRate(i: number, sec = 0.3): number {
    const b = this.boostGauge
    if (!b) return NaN
    const j = Math.max(0, i - this.samples(sec))
    const dt = this.t[i] - this.t[j]
    return dt > 0 ? (b[i] - b[j]) / dt : 0
  }

  private computeBoostGauge(): Float64Array | null {
    const gauge = this.find([/^manifold gauge pressure$/i], "pressure")
    if (gauge) return gauge.v
    const b1 = this.find([/^boost bank ?1$/i, /^boost pressure$/i, /^boost$/i], "pressure")
    const map = this.find([/^manifold absolute pressure$/i], "pressure")
    const src = b1 ?? map
    if (!src) return null
    const out = new Float64Array(this.n)
    const atmMedian = this.atm ? median(Array.from(this.atm.v)) : 1.013
    // Absolute when the idle reading sits near atmospheric.
    const idle: number[] = []
    for (let i = 0; i < this.n; i++) if (this.running[i] && this.pedal && this.pedal.v[i] < 5) idle.push(src.v[i])
    const absolute = src === map || (idle.length > 0 && Math.abs(median(idle) - atmMedian) < 0.3)
    for (let i = 0; i < this.n; i++) {
      const atm = this.atm && Number.isFinite(this.atm.v[i]) ? this.atm.v[i] : atmMedian
      out[i] = absolute ? src.v[i] - atm : src.v[i]
    }
    return out
  }

  private detectShifts(settle: number): ShiftEvent[] {
    const g = this.gear?.v
    if (!g) return []
    const gd = this.gearDesired?.v
    const out: ShiftEvent[] = []
    const back = this.samples(1.5)
    const fallback = this.samples(0.3)
    const post = this.samples(settle)
    for (let k = 1; k < this.n; k++) {
      const a = g[k - 1]
      const b = g[k]
      if (!Number.isFinite(a) || !Number.isFinite(b) || a === b || a < 1 || b < 1 || b > 7) continue
      let start = Math.max(0, k - fallback)
      if (gd) {
        for (let j = k; j > Math.max(0, k - back); j--) {
          if (gd[j] === b && gd[j - 1] !== b) {
            start = j
            break
          }
        }
      }
      let pedal = 0
      if (this.pedal) for (let i = start; i <= k; i++) pedal = Math.max(pedal, this.pedal.v[i] || 0)
      out.push({ start, engage: k, end: Math.min(this.n - 1, k + post), from: a, to: b, up: b > a, pedal })
    }
    return out
  }
}

function median(values: number[]): number {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b)
  return v.length ? v[v.length >> 1] : NaN
}

/**
 * Index ranges where pred holds, bridging gaps shorter than `gap` seconds.
 * Duration counts one sample period so a single sample at 10 Hz is 0.1 s.
 */
export function spans(c: Ctx, pred: (i: number) => boolean, minDur: number, gap = 0.12): [number, number][] {
  const out: [number, number][] = []
  let s = -1
  let last = -1
  const close = () => {
    if (s >= 0 && c.t[last] - c.t[s] + c.dt >= minDur - 1e-9) out.push([s, last])
    s = -1
  }
  for (let i = 0; i < c.n; i++) {
    if (pred(i)) {
      if (s < 0) s = i
      last = i
    } else if (s >= 0 && c.t[i] - c.t[last] > gap) {
      close()
    }
  }
  close()
  return out
}

function argmax(s: number, e: number, f: (i: number) => number): number {
  let best = s
  let bv = -Infinity
  for (let i = s; i <= e; i++) {
    const v = f(i)
    if (Number.isFinite(v) && v > bv) {
      bv = v
      best = i
    }
  }
  return best
}

const sev = (v: number, crit: number): CheckSeverity => (v >= crit ? "critical" : "warn")
const dur = (c: Ctx, s: number, e: number) => `${(c.t[e] - c.t[s] + c.dt).toFixed(2)} s`
const fin = (x: number) => Number.isFinite(x)

// ---------------------------------------------------------------------------
// Rules

const p = (key: string, label: string, unit: string, def: number, step?: number): CheckParam => ({ key, label, unit, default: def, step })

export const RULES: RuleDef[] = [
  // ----------------------------------------------------------------- ECU
  {
    id: "failsafe",
    title: "ECU failsafe (limp mode) tripped",
    system: "ECU",
    summary: "Failsafe Flags went non-zero: RaceROM pulled power to protect the engine.",
    advice:
      "The decoded bits say why. Low fuel pressure or lean AFR: check the fuel pump, filter and injector duty. Knock: fuel quality and timing. Low oil pressure or high oil temperature: stop and check before driving on. High coolant pressure: look for a head gasket or combustion leak. Fix the cause, then clear the flag by cycling the ignition.",
    refs: ["EcuTek GT-R RaceROM Failsafes", "RaceROM Phase 6 manual p.29"],
    params: [],
    run(c, _p, emit) {
      const ch = c.find([/^(failsafe|limp mode) flags$/i])
      if (!ch) return "No Failsafe Flags channel"
      const dec = buildDecoders(c.failsafeTable).find((d) => d.id === "failsafe")!
      for (const [s, e] of spans(c, (i) => ch.v[i] > 0, 0, 0.3)) {
        const d = decodeValue(dec, ch.v[s])
        emit({
          severity: "critical",
          title: `Failsafe: ${describe(dec, d)}`,
          detail: `Failsafe Flags = ${ch.v[s]} for ${dur(c, s, e)}.`,
          s,
          e,
          peak: s,
          channels: [ch, c.rpm, c.pedal],
        })
      }
    },
  },
  {
    id: "failsafe-stored",
    title: "Stored failsafe from an earlier drive",
    system: "ECU",
    summary: "Failsafe Stored Flags is non-zero, so a failsafe tripped at some point before or during this log.",
    advice: "Find out what tripped it (decoded below) and when. The stored flag stays set until it is cleared, so a stored flag with a clean live flag can be old.",
    refs: ["EcuTek GT-R RaceROM Failsafes"],
    params: [],
    run(c, _p, emit) {
      const ch = c.find([/^(failsafe|limp mode) stored flags$/i])
      if (!ch) return "No Failsafe Stored Flags channel"
      const dec = buildDecoders(c.failsafeTable).find((d) => d.id === "failsafeStored")!
      const seen = new Set<number>()
      for (const [s, e] of spans(c, (i) => ch.v[i] > 0, 0, 0.3)) {
        if (seen.has(ch.v[s])) continue
        seen.add(ch.v[s])
        emit({
          severity: "warn",
          title: `Stored failsafe: ${describe(dec, decodeValue(dec, ch.v[s]))}`,
          detail: `Failsafe Stored Flags = ${ch.v[s]}${s === 0 ? " from the start of the log" : ` from ${c.t[s].toFixed(2)} s`}.`,
          s,
          e,
          peak: s,
          channels: [ch],
        })
      }
    },
  },
  {
    id: "mil",
    title: "MIL (check engine) requested",
    system: "ECU",
    summary: "MIL Source is non-zero: RaceROM is lighting the warning lamp.",
    advice: "The decoded source points at the system: failsafe, knock warning, clutch slip or a custom sensor out of range. Read stored DTCs as well (FSM EC section, DTC index).",
    refs: ["EcuTek GT-R RaceROM Tuning Guide"],
    params: [],
    run(c, _p, emit) {
      const ch = c.find([/^mil source$/i])
      if (!ch) return "No MIL Source channel"
      const dec = buildDecoders(c.failsafeTable).find((d) => d.id === "mil")!
      for (const [s, e] of spans(c, (i) => ch.v[i] > 0 && ch.v[i] !== 64, 0, 0.3)) {
        emit({
          severity: "warn",
          title: `MIL: ${describe(dec, decodeValue(dec, ch.v[s]))}`,
          detail: `MIL Source = ${ch.v[s]} for ${dur(c, s, e)}.`,
          s,
          e,
          peak: s,
          channels: [ch],
        })
      }
    },
  },

  // -------------------------------------------------------- Transmission
  {
    id: "clutch-slip-power",
    title: "Clutch slipping under power",
    system: "Transmission",
    summary:
      "Clutch Slip = Engine Speed − transmission input shaft speed (EcuTek), so rpm is the right unit. With a gear held under load EcuTek calls 0–15 rpm normal; this flags sustained positive slip outside shifts and launches.",
    advice:
      "The clutch pack is not holding the torque. 1) Torque Actual must be right: the TCM sets clutch pressure from the ECU's torque figure, so get fuel trims within ±10% and fix the Torque Actual map after intake or MAF changes (keep the K-factor stock). 2) Clutch pressure: the stock maximum is about 16.5–17.2 bar (the seal limit); built boxes run about 20–23 bar. 3) Run a TCM Clutch Gear Learn with coolant above 80 °C and gearbox oil above 65 °C. 4) If it still slips, the packs are worn or the torque is beyond their capacity (stock clutches start slipping around 650 whp). Reduce torque in the low gears or fit uprated clutch packs.",
    refs: [
      "EcuTek GT-R ECM Phase 6 RaceROM manual (Clutch Slip definition, CSP)",
      "EcuTek GT-R ProECU Tuning Guide (0–15 rpm normal in 4th)",
      "EcuTek GT-R TCM Tuning guide (clutch pressure, gear learn)",
    ],
    params: [
      p("warn", "Slip warning", "rpm", 150, 10),
      p("crit", "Slip critical", "rpm", 300, 10),
      p("minPedal", "Minimum pedal", "%", 40),
      p("minRpm", "Minimum engine speed", "rpm", 2000, 100),
      p("minSpeed", "Minimum vehicle speed", "km/h", 15),
      p("minDur", "Minimum duration", "s", 0.3, 0.05),
    ],
    run(c, q, emit) {
      const slip = c.find([/^clutch slip$/i])
      if (!slip || !c.rpm || !c.gear) return "Needs Clutch Slip, Engine Speed and Gear"
      const launch = c.find([/^launch control active$/i])
      const ok = (i: number) =>
        c.running[i] === 1 &&
        !c.shifting[i] &&
        c.gear!.v[i] >= 1 &&
        c.rpm!.v[i] >= q.minRpm &&
        (!c.pedal || c.pedal.v[i] >= q.minPedal) &&
        (!c.speed || c.speed.v[i] >= q.minSpeed) &&
        !(launch && launch.v[i] > 0)
      for (const [s, e] of spans(c, (i) => ok(i) && slip.v[i] >= q.warn, q.minDur)) {
        const k = argmax(s, e, (i) => slip.v[i])
        emit({
          severity: sev(slip.v[k], q.crit),
          title: `Clutch slip ${fmt0(slip.v[k])} rpm in ${ord(c.gear.v[k])}`,
          detail: `Peak +${fmt0(slip.v[k])} rpm slip at ${fmt0(c.rpm.v[k])} rpm${c.pedal ? `, ${fmt0(c.pedal.v[k])}% pedal` : ""}, for ${dur(c, s, e)} with the gear engaged (limit ${q.warn} rpm).`,
          s,
          e,
          peak: k,
          channels: [slip, c.rpm, c.gear, c.pedal],
        })
      }
    },
  },
  {
    id: "csp",
    title: "Clutch slip protection intervened",
    system: "Transmission",
    summary: "CSP Flags bit 128: RaceROM's clutch slip protection cut torque because slip exceeded its error limit.",
    advice: "This is the ECU confirming the clutch slip above. Treat it as clutch capacity or pressure trouble: relearn, check pressures, or reduce torque. A CSP setting that is too sensitive can also trigger it; review the CSP slip error table.",
    refs: ["EcuTek GT-R RaceROM Tuning Guide (CSP Flags)"],
    params: [],
    run(c, _p, emit) {
      const ch = c.find([/^csp flags$/i])
      if (!ch) return "No CSP Flags channel"
      const red = c.find([/^csp torque reduction$/i])
      for (const [s, e] of spans(c, (i) => (Math.round(ch.v[i]) & 128) !== 0, 0, 0.2)) {
        const k = red ? argmax(s, e, (i) => red.v[i]) : s
        emit({
          severity: "critical",
          title: "CSP active: torque cut for clutch slip",
          detail: `CSP active for ${dur(c, s, e)}${red ? `, torque reduction up to ${fmt0(red.v[k])}%` : ""}${c.gear ? ` in ${ord(c.gear.v[k])}` : ""}.`,
          s,
          e,
          peak: k,
          channels: [ch, red, c.find([/^clutch slip$/i]), c.rpm],
        })
      }
    },
  },
  {
    id: "shift-flare",
    title: "Engine flare as the gear engages",
    system: "Transmission",
    summary:
      "During a shift slip swings negative while the clutches swap, then the engine should lock to the new gear. A positive slip spike after the swap means the engine flared (rpm overshoot) before the oncoming clutch held it.",
    advice:
      "Flare on upshifts points to the oncoming clutch filling late or low: clutch wear, low clutch pressure or stale TCM learning. Do a clutch learn and compare clutch pressure with target during the shift. Flare on downshifts is usually the throttle blip overshooting. Very high torque during the shift needs more shift torque reduction or a TCM shift calibration.",
    refs: ["EcuTek GT-R TCM Tuning guide (shift ends when the oncoming clutch slip is ~0)", "Sample logs: +250–450 rpm post-swap spike at WOT"],
    params: [
      p("warn", "Flare warning", "rpm", 500, 10),
      p("crit", "Flare critical", "rpm", 900, 10),
      p("pre", "Look back before engage", "s", 0.3, 0.05),
      p("minPedal", "Minimum pedal (upshifts)", "%", 30),
      p("minSpeed", "Minimum vehicle speed", "km/h", 20),
    ],
    run(c, q, emit) {
      const slip = c.find([/^clutch slip$/i])
      if (!slip || !c.gear) return "Needs Clutch Slip and Gear"
      if (!c.shifts.length) return "No gear changes in this log"
      for (const ev of c.shifts) {
        if (ev.up && ev.pedal < q.minPedal) continue
        // rolling to a stop the clutch slips on purpose (creep control)
        if (c.speed && c.speed.v[ev.engage] < q.minSpeed) continue
        const s = Math.max(ev.start, ev.engage - c.samples(q.pre))
        const trough = argmax(s, ev.end, (i) => -slip.v[i])
        const from = slip.v[trough] < 0 ? trough : s
        const k = argmax(from, ev.end, (i) => slip.v[i])
        const peak = slip.v[k]
        if (!(peak >= q.warn)) continue
        const rpmTxt = c.rpm ? ` at ${fmt0(c.rpm.v[k])} rpm` : ""
        emit({
          severity: sev(peak, q.crit),
          title: `${ev.up ? "Upshift" : "Downshift"} ${ev.from}→${ev.to} flare +${fmt0(peak)} rpm`,
          detail: `Slip spiked to +${fmt0(peak)} rpm${rpmTxt} as ${ord(ev.to)} engaged (${fmt0(ev.pedal)}% pedal, limit ${q.warn} rpm).`,
          s: ev.start,
          e: ev.end,
          peak: k,
          channels: [slip, c.rpm, c.gear, c.gearDesired, c.pedal],
        })
      }
    },
  },
  {
    id: "shift-slow",
    title: "Slow or incomplete shift",
    system: "Transmission",
    summary: "Gear Desired and Gear disagree for too long: the shift took a long time or never completed.",
    advice: "Long shift times point to the TCM struggling to engage: low line pressure, sticky shift fork or sleeve, gear position sensor drift, or the TCM refusing the shift (over-rev or under-rev protection). Check the TCM DTCs and the sleeve positions, then run a full TCM learn.",
    refs: ["Sample logs: WOT upshifts complete in ~0.35 s"],
    params: [p("warn", "Warning after", "s", 1.5, 0.1), p("crit", "Critical after", "s", 3.0, 0.1), p("minSpeed", "Minimum vehicle speed", "km/h", 5)],
    run(c, q, emit) {
      if (!c.gear || !c.gearDesired) return "Needs Gear and Gear Desired"
      const g = c.gear.v
      const gd = c.gearDesired.v
      const ok = (i: number) =>
        c.running[i] === 1 && fin(g[i]) && fin(gd[i]) && g[i] >= 1 && gd[i] >= 1 && g[i] !== gd[i] && (!c.speed || c.speed.v[i] >= q.minSpeed)
      for (const [s, e] of spans(c, ok, q.warn, 0.05)) {
        const len = c.t[e] - c.t[s] + c.dt
        emit({
          severity: sev(len, q.crit),
          title: `Shift to ${ord(gd[s])} took ${len.toFixed(1)} s`,
          detail: `Gear stayed at ${ord(g[s])} while ${ord(gd[s])} was requested for ${len.toFixed(2)} s.`,
          s,
          e,
          peak: s,
          channels: [c.gear, c.gearDesired, c.rpm, c.speed],
        })
      }
    },
  },
  {
    id: "trans-temp",
    title: "Transmission fluid hot",
    system: "Transmission",
    summary: "GR6 fluid temperature above the warning limit.",
    advice: "Hot fluid thins out and slips the clutches. The TCM also starts protecting itself, with softer shifts and torque limits. Check the transmission cooler and its airflow, and look for a fluid level or condition problem. Launches and traffic heat-soak the fluid quickly.",
    refs: ["HKS DCT cooler notes (factory fail-safe at 140–145 °C)"],
    params: [p("warn", "Warning", "°C", 120), p("crit", "Critical", "°C", 140)],
    run(c, q, emit) {
      const ch = c.find([/^fluid temperature$/i, /^(trans(mission)?|gearbox|tcm) (fluid|oil) temp/i], "temp")
      if (!ch) return "No transmission fluid temperature channel"
      for (const [s, e] of spans(c, (i) => ch.v[i] >= q.warn, 1)) {
        const k = argmax(s, e, (i) => ch.v[i])
        emit({ severity: sev(ch.v[k], q.crit), title: `Transmission fluid ${fmt0(ch.v[k])} °C`, detail: `Peaked at ${fmt1(ch.v[k])} °C (limit ${q.warn} °C) for ${dur(c, s, e)}.`, s, e, peak: k, channels: [ch] })
      }
    },
  },
  {
    id: "trans-pressure",
    title: "Transmission pressure not following target",
    system: "Transmission",
    summary: "Line or clutch pressure stays well below its target outside shifts.",
    advice: "A pressure that can't reach its target points to the solenoid, a leak in that circuit, a worn pump or low fluid. Compare the S/V commanded and monitored current: if those match but pressure is low, the problem is hydraulic.",
    refs: ["TCM data channels (Line / Clutch A / Clutch B pressure vs target)"],
    params: [p("warn", "Error warning", "bar", 2, 0.1), p("crit", "Error critical", "bar", 4, 0.1), p("minDur", "Minimum duration", "s", 0.5, 0.05)],
    run(c, q, emit) {
      const pairs: [RegExp, RegExp][] = [
        [/^line pressure$/i, /^line pressure target$/i],
        [/^clutch a pressure$/i, /^clutch a pressure target$/i],
        [/^clutch b pressure$/i, /^clutch b pressure target$/i],
      ]
      let any = false
      for (const [a, b] of pairs) {
        const act = c.find([a], "pressure")
        const tgt = c.find([b], "pressure")
        if (!act || !tgt) continue
        any = true
        const err = (i: number) => tgt.v[i] - act.v[i]
        for (const [s, e] of spans(c, (i) => c.running[i] === 1 && !c.shifting[i] && err(i) >= q.warn, q.minDur)) {
          const k = argmax(s, e, err)
          emit({
            severity: sev(err(k), q.crit),
            title: `${act.label} ${fmt2(err(k))} bar under target`,
            detail: `${fmtBar(act.v[k])} against a ${fmtBar(tgt.v[k])} target, for ${dur(c, s, e)}.`,
            s,
            e,
            peak: k,
            channels: [act, tgt, c.gear],
          })
        }
      }
      if (!any) return "No transmission pressure + target channels"
    },
  },
  {
    id: "clutch-pressure-limit",
    title: "Clutch pressure past the stock limit",
    system: "Transmission",
    summary: "Clutch pressure target above what stock seals hold (~17.2 bar), or line pressure not above the clutch target (clutch pressure can never exceed line pressure).",
    advice: "On a stock gearbox, keep the clutch pressure targets at or below about 17.2 bar: above that the clutch seals cannot hold. Built transmissions can run about 20–23 bar. If line pressure is at or below the clutch target, raise Min Target Line Pressure, or the clutch can't get the pressure it is asking for.",
    refs: ["EcuTek GT-R TCM Tuning guide (stock 16.5–17.2 bar; line ≥ clutch)", "EcuTek GT-R TCM Clutch Pressure Tuning", "COBB: ~20 bar sensor limit on DBA"],
    params: [p("max", "Clutch target above", "bar", 17.2, 0.1), p("margin", "Line must exceed clutch target by", "bar", 0, 0.1), p("minDur", "Minimum duration", "s", 0.2, 0.05)],
    run(c, q, emit) {
      const line = c.find([/^line pressure$/i], "pressure")
      const tg = [c.find([/^clutch a pressure target$/i], "pressure"), c.find([/^clutch b pressure target$/i], "pressure")].filter(Boolean) as Ch[]
      if (!tg.length) return "No clutch pressure target channels (TCM logging)"
      for (const ch of tg) {
        for (const [s, e] of spans(c, (i) => ch.v[i] > q.max, q.minDur)) {
          const k = argmax(s, e, (i) => ch.v[i])
          emit({ severity: "info", title: `${ch.label} ${fmtBar(ch.v[k])}`, detail: `Above ${q.max} bar for ${dur(c, s, e)}. That is fine on a built gearbox but over the stock seal limit.`, s, e, peak: k, channels: [ch, line] })
        }
        if (!line) continue
        for (const [s, e] of spans(c, (i) => c.running[i] === 1 && ch.v[i] > 1 && line.v[i] <= ch.v[i] + q.margin, q.minDur)) {
          const k = argmax(s, e, (i) => ch.v[i] - line.v[i])
          emit({ severity: "warn", title: `Line pressure not above ${ch.label}`, detail: `Line ${fmtBar(line.v[k])} vs clutch target ${fmtBar(ch.v[k])} for ${dur(c, s, e)}.`, s, e, peak: k, channels: [line, ch] })
        }
      }
    },
  },

  // ---------------------------------------------------------------- Fuel
  {
    id: "lean-load",
    title: "Lean under boost",
    system: "Fuel",
    summary: "AFR leaner than the safe limit, or well leaner than target, under load and boost. Shift cuts and fuel cut are ignored.",
    advice:
      "Lean at full load is the fastest way to hurt a VR38. In order of likelihood: fuel delivery (see the fuel pressure check, pump voltage, filter), maxed injectors (duty), a MAF or scaling problem (MAF voltage pegged, SD calibration), or ethanol content changing under a flex-fuel tune. If only one bank is lean, suspect that bank's injectors, a boost leak or the wideband sensor.",
    refs: [
      "DSPORT R35 fuel test: λ 0.71–0.81 pump fuel, 0.78–0.85 E85 at power",
      "EcuTek GT-R Live Data: factory wideband reads leaner than actual at full load",
      "FSM EC-285 / EC-289 (P0171/P0174 too lean)",
    ],
    dtc: ["P0171", "P0174"],
    params: [
      p("warnAfr", "Lean warning (AFR)", "afr", 12.5, 0.1),
      p("critAfr", "Lean critical (AFR)", "afr", 13.0, 0.1),
      p("warnErr", "Over target warning", "afr", 0.6, 0.1),
      p("critErr", "Over target critical", "afr", 1.0, 0.1),
      p("minBoost", "Minimum boost (gauge)", "bar", 0.5, 0.05),
      p("minPedal", "Minimum pedal", "%", 70),
      p("minDur", "Minimum duration", "s", 0.3, 0.05),
    ],
    run(c, q, emit) {
      const banks = [c.find([/^afr b(ank)? ?#?1$/i, /^afr$/i]), c.find([/^afr b(ank)? ?#?2$/i])].filter(Boolean) as Ch[]
      if (!banks.length) return "No AFR channel"
      const tgts = [c.find([/^afr target final b1$/i, /^afr target base$/i, /^afr target$/i]), c.find([/^afr target final b2$/i, /^afr target base$/i, /^afr target$/i])]
      const boost = c.boostGauge
      // wideband lags the tip-in, so the pedal must have been held a moment
      const held = c.pedalHeld(q.minPedal, 0.3)
      banks.forEach((afr, bi) => {
        const tgt = tgts[bi] ?? tgts[0]
        const load = (i: number) =>
          c.running[i] === 1 &&
          !c.shifting[i] &&
          !c.fuelCut[i] &&
          afr.v[i] < 20 &&
          held[i] === 1 &&
          (!c.rpm || c.rpm.v[i] >= 2500) &&
          (!boost || boost[i] >= q.minBoost)
        const excess = (i: number) => {
          const abs = afr.v[i] >= q.warnAfr
          const err = tgt && fin(tgt.v[i]) && tgt.v[i] < 14 ? afr.v[i] - tgt.v[i] >= q.warnErr : false
          return abs || err
        }
        for (const [s, e] of spans(c, (i) => load(i) && excess(i), q.minDur)) {
          const k = argmax(s, e, (i) => (load(i) ? afr.v[i] : -Infinity))
          const err = tgt && fin(tgt.v[k]) ? afr.v[k] - tgt.v[k] : NaN
          const critical = afr.v[k] >= q.critAfr || (fin(err) && err >= q.critErr)
          emit({
            severity: critical ? "critical" : "warn",
            title: `${afr.label} ${fmt2(afr.v[k])} (λ ${(afr.v[k] / 14.7).toFixed(2)}) under boost`,
            detail: `Peak ${fmt2(afr.v[k])} AFR${fin(err) ? ` against ${fmt2(tgt!.v[k])} target (${err >= 0 ? "+" : ""}${fmt2(err)})` : ""}${boost ? ` at ${fmtBar(boost[k])} boost` : ""}${c.rpm ? `, ${fmt0(c.rpm.v[k])} rpm` : ""}, for ${dur(c, s, e)}.`,
            s,
            e,
            peak: k,
            channels: [afr, tgt, c.find([/^manifold gauge pressure$/i, /^boost bank ?1$/i]), c.find([/^fuel pressure \(relative\)$/i]), c.rpm],
          })
        }
      })
    },
  },
  {
    id: "afr-bank-split",
    title: "AFR bank-to-bank difference",
    system: "Fuel",
    summary: "Bank 1 and bank 2 AFR disagree under load.",
    advice: "A consistent split points at one bank: injector flow or a sticking injector, a boost or exhaust leak before that bank's wideband, a tired wideband, or (on a MAF car) one MAF reading differently. Swap injectors between banks or compare the MAF voltages to narrow it down.",
    refs: ["GT-R tuning practice", "FSM EC-512 (P219A/P219B A/F imbalance)"],
    dtc: ["P219A", "P219B"],
    params: [p("warn", "Difference warning", "afr", 0.8, 0.1), p("crit", "Difference critical", "afr", 1.5, 0.1), p("minPedal", "Minimum pedal", "%", 50), p("minDur", "Minimum duration", "s", 0.5, 0.05)],
    run(c, q, emit) {
      const a = c.find([/^afr b(ank)? ?#?1$/i])
      const b = c.find([/^afr b(ank)? ?#?2$/i])
      if (!a || !b) return "Needs AFR B1 and AFR B2"
      const d = (i: number) => Math.abs(a.v[i] - b.v[i])
      const held = c.pedalHeld(q.minPedal, 0.5)
      const ok = (i: number) =>
        c.running[i] === 1 && !c.shifting[i] && !c.fuelCut[i] && a.v[i] < 20 && b.v[i] < 20 && held[i] === 1 && (!c.rpm || c.rpm.v[i] >= 2500)
      for (const [s, e] of spans(c, (i) => ok(i) && d(i) >= q.warn, q.minDur)) {
        const k = argmax(s, e, (i) => (ok(i) ? d(i) : -Infinity))
        emit({
          severity: sev(d(k), q.crit),
          title: `AFR banks ${fmt2(d(k))} apart`,
          detail: `B1 ${fmt2(a.v[k])} vs B2 ${fmt2(b.v[k])}${c.rpm ? ` at ${fmt0(c.rpm.v[k])} rpm` : ""}, for ${dur(c, s, e)}.`,
          s,
          e,
          peak: k,
          channels: [a, b, c.rpm],
        })
      }
    },
  },
  {
    id: "fuel-pressure",
    title: "Fuel pressure drops at full load",
    system: "Fuel",
    summary:
      "Relative fuel pressure at WOT falls well below the pressure the same log holds at light load (FSM spec: ~3.5 bar / 51 psi at idle, returnless system).",
    advice:
      "The pump or its supply can't keep up. Check pump voltage under load (wiring, relay, battery voltage dropping), the fuel filter, and the pump itself. With extra pumps check the sub pump stage activates (FSM EC-432, P062A). On E85 the fuel demand is about 30% higher, so stock pumps run out early. Don't keep pulling on it: lean AFR usually follows.",
    refs: [
      "FSM EC-637 (fuel pressure 350 kPa at idle)",
      "FSM EC-432 (P062A sub fuel pump)",
      "EcuTek GT-R ProECU guide: relative pressure should stay constant with boost",
      "RaceROM failsafe: low relative fuel pressure",
    ],
    dtc: ["P062A"],
    params: [
      p("warnDrop", "Drop warning", "bar", 0.3, 0.05),
      p("critDrop", "Drop critical", "bar", 0.5, 0.05),
      p("floor", "Absolute floor", "bar", 2.8, 0.05),
      p("minPedal", "Minimum pedal", "%", 70),
      p("minRpm", "Minimum engine speed", "rpm", 3000, 100),
      p("minDur", "Minimum duration", "s", 0.3, 0.05),
    ],
    run(c, q, emit) {
      const fp = c.find([/^fuel pressure \(relative\)$/i, /^fuel pressure relative$/i, /^fuel rail pressure$/i, /^fuel line gauge pressure$/i, /^fuel pressure$/i], "pressure")
      if (!fp || !c.rpm) return "Needs relative fuel pressure and Engine Speed"
      const light: number[] = []
      for (let i = 0; i < c.n; i++) if (c.running[i] && c.rpm.v[i] < 3500 && (!c.pedal || c.pedal.v[i] < 25) && fin(fp.v[i])) light.push(fp.v[i])
      const base = light.length >= 5 ? median(light) : 3.5
      const warnAt = Math.max(q.floor, base - q.warnDrop)
      const critAt = base - q.critDrop
      const ok = (i: number) => c.running[i] === 1 && c.rpm!.v[i] >= q.minRpm && (!c.pedal || c.pedal.v[i] >= q.minPedal) && !c.fuelCut[i]
      for (const [s, e] of spans(c, (i) => ok(i) && fp.v[i] < warnAt, q.minDur)) {
        const k = argmax(s, e, (i) => -fp.v[i])
        const drop = ((base - fp.v[k]) / base) * 100
        emit({
          severity: fp.v[k] <= critAt || fp.v[k] < q.floor * 0.85 ? "critical" : "warn",
          title: `Fuel pressure sagged to ${fmtBar(fp.v[k])}`,
          detail: `${fmt2(base - fp.v[k])} bar (${fmt0(drop)}%) below the ${fmtBar(base)} held at light load${light.length < 5 ? " (FSM idle spec used, no light-load samples)" : ""}, at ${fmt0(c.rpm.v[k])} rpm, for ${dur(c, s, e)}.`,
          s,
          e,
          peak: k,
          channels: [fp, c.rpm, c.pedal, c.find([/^injector duty b1$/i]), c.find([/^battery voltage$/i, /^battey voltage$/i])],
        })
      }
    },
  },
  {
    id: "injector-duty",
    title: "Injectors near maximum duty",
    system: "Fuel",
    summary: "Injector duty above ~85% leaves no headroom; at 100% the injectors are static and the mixture goes lean.",
    advice: "The injectors are too small for the power, or fuel pressure is low so the ECU holds them open longer. Check the fuel pressure check first. If pressure holds, the fix is larger injectors (and new injector scaling), or less boost/fuel demand. E85 needs about 30% more injector.",
    refs: ["GT-R tuning practice (85% sustained duty limit)"],
    params: [p("warn", "Warning", "%", 85), p("crit", "Critical", "%", 95), p("minDur", "Minimum duration", "s", 0.2, 0.05)],
    run(c, q, emit) {
      const chs = [c.find([/^injector duty b1$/i, /^injector duty( cycle)?$/i]), c.find([/^injector duty b2$/i])].filter(Boolean) as Ch[]
      if (!chs.length) return "No injector duty channel"
      for (const ch of chs) {
        for (const [s, e] of spans(c, (i) => ch.v[i] >= q.warn, q.minDur)) {
          const k = argmax(s, e, (i) => ch.v[i])
          emit({ severity: sev(ch.v[k], q.crit), title: `${ch.label} ${fmt0(ch.v[k])}%`, detail: `Peak ${fmt1(ch.v[k])}% duty${c.rpm ? ` at ${fmt0(c.rpm.v[k])} rpm` : ""}, above ${q.warn}% for ${dur(c, s, e)}.`, s, e, peak: k, channels: [ch, c.rpm, c.find([/^afr b1$/i])] })
        }
      }
    },
  },
  {
    id: "fuel-trim",
    title: "Fuel trims out of range",
    system: "Fuel",
    summary: "Closed-loop fuel trims pulling or adding too much: the base fuelling (MAF scaling, injector data) is off, or there is a leak.",
    advice: "Positive trims (adding fuel) mean the engine is lean before correction: vacuum or boost leak after the MAF, a weak pump, dirty injectors or a MAF reading low. Negative trims (pulling fuel) mean rich: leaking injectors, a MAF reading high, or the wrong injector scaling. RaceROM can failsafe on high short-term trim.",
    refs: ["FSM EC-285 / EC-289 (P0171–P0175)", "EcuTek GT-R ProECU guide (±10% acceptable, ±5% well tuned)", "RaceROM failsafe: high short term fuel trim"],
    dtc: ["P0171", "P0172", "P0174", "P0175"],
    params: [p("stWarn", "Short term warning", "±%", 10), p("stCrit", "Short term critical", "±%", 20), p("ltWarn", "Long term warning", "±%", 10), p("ltCrit", "Long term critical", "±%", 20), p("minDur", "Minimum duration", "s", 2, 0.5)],
    run(c, q, emit) {
      const sets: [Ch | null, number, number][] = [
        [c.find([/^fuel trim short term bank #?1$/i]), q.stWarn, q.stCrit],
        [c.find([/^fuel trim short term bank #?2$/i]), q.stWarn, q.stCrit],
        [c.find([/^fuel trim long term bank #?1$/i]), q.ltWarn, q.ltCrit],
        [c.find([/^fuel trim long term bank #?2$/i]), q.ltWarn, q.ltCrit],
      ]
      if (!sets.some(([ch]) => ch)) return "No fuel trim channels"
      for (const [raw, warn, crit] of sets) {
        if (!raw) continue
        // GT-R RaceROM logs trims as a multiplier where 100 = no correction.
        const ch = median(Array.from(raw.v)) > 50 ? { ...raw, v: raw.v.map((x) => x - 100) } : raw
        // One finding per channel and direction: how long it sat out of range.
        for (const dir of [1, -1]) {
          const out = spans(c, (i) => c.running[i] === 1 && !c.fuelCut[i] && dir * ch.v[i] >= warn, q.minDur, 0.3)
          if (!out.length) continue
          let total = 0
          let worst = out[0][0]
          let longest = out[0]
          for (const [s, e] of out) {
            total += c.t[e] - c.t[s] + c.dt
            const k = argmax(s, e, (i) => dir * ch.v[i])
            if (dir * ch.v[k] > dir * ch.v[worst]) worst = k
            if (e - s > longest[1] - longest[0]) longest = [s, e]
          }
          let runTime = 0
          for (let i = 0; i < c.n; i++) if (c.running[i]) runTime += c.dt
          const v = ch.v[worst]
          emit({
            severity: sev(Math.abs(v), crit),
            title: `${ch.label} ${v > 0 ? "+" : ""}${fmt1(v)}%`,
            detail: `${v > 0 ? "Adding" : "Pulling"} fuel beyond ±${warn}% for ${total.toFixed(1)} s${runTime ? ` (${fmt0((total / runTime) * 100)}% of running time)` : ""} in ${out.length} stretch${out.length > 1 ? "es" : ""}, peak ${v > 0 ? "+" : ""}${fmt1(v)}%.`,
            s: longest[0],
            e: longest[1],
            peak: worst,
            channels: [raw, c.rpm, c.find([/^engine load$/i]), c.find([/^afr b1$/i])],
          })
        }
      }
    },
  },
  {
    id: "ethanol",
    title: "Ethanol reading unstable",
    system: "Fuel",
    summary: "Flex-fuel ethanol content jumped faster than fuel can actually blend, which points to a sensor or wiring glitch.",
    advice: "Real ethanol content changes slowly, after a fill-up. Jumps mean a flex sensor signal problem (connector, ground, sensor). It matters because a flex tune changes fuel and timing with that reading, so a false jump can lean the engine out or add timing. RaceROM can failsafe on ethanol input error.",
    refs: ["RaceROM failsafe: ethanol input error"],
    params: [p("jump", "Jump", "%", 10), p("window", "Within", "s", 2, 0.5)],
    run(c, q, emit) {
      const ch = c.find([/^flexfuel ethanol content$/i, /^ethanol( content)?$/i])
      if (!ch) return "No ethanol content channel"
      const w = c.samples(q.window)
      let last = -Infinity
      for (let i = w; i < c.n; i++) {
        const d = Math.abs(ch.v[i] - ch.v[i - w])
        if (d >= q.jump && c.t[i] - last > 5) {
          last = c.t[i]
          emit({ severity: d >= q.jump * 2 ? "critical" : "warn", title: `Ethanol jumped ${fmt0(d)}%`, detail: `${fmt1(ch.v[i - w])}% → ${fmt1(ch.v[i])}% within ${q.window} s.`, s: i - w, e: i, peak: i, channels: [ch] })
        }
      }
    },
  },

  // ------------------------------------------------------------- Ignition
  {
    id: "knock",
    title: "Knock retard",
    system: "Ignition",
    summary: "The ECU pulled timing for knock (negative Knock Correction). Positive values up to about +2° are the ECU adding timing at full load and are fine.",
    advice: "Check fuel first: octane, or ethanol lower than the tune expects. Then IAT and coolant (heat soak), and timing at that load cell. Repeated knock in the same rpm/load area means that cell has too much timing. A single event can be noise from shifts or bumps. Check per-cylinder knock to see whether it is one cylinder (injector, plug) or all of them.",
    refs: ["EcuTek GT-R ECM Phase 6 manual (Knock Correction, knock failsafe)", "FSM EC-328 (knock sensor circuits)"],
    params: [p("warn", "Retard warning", "°", 2, 0.5), p("crit", "Retard critical", "°", 4, 0.5)],
    run(c, q, emit) {
      const ch = c.find([/^knock correction$/i, /^knock retard$/i, /^knock$/i])
      if (!ch) return "No Knock Correction channel"
      for (const [s, e] of spans(c, (i) => -ch.v[i] >= q.warn, 0, 0.3)) {
        const k = argmax(s, e, (i) => -ch.v[i])
        emit({ severity: sev(-ch.v[k], q.crit), title: `Knock retard ${fmt1(-ch.v[k])}°`, detail: `${fmt1(ch.v[k])}°${c.rpm ? ` at ${fmt0(c.rpm.v[k])} rpm` : ""}, ${dur(c, s, e)}.`, s, e, peak: k, channels: [ch, c.find([/^ignition timing$/i]), c.rpm, c.find([/^intake air temperature$/i])] })
      }
    },
  },

  // ---------------------------------------------------------------- Boost
  {
    id: "overboost",
    title: "Overboost",
    system: "Boost",
    summary: "Boost above target by more than the margin (EcuTek Boost Error = actual − target).",
    advice: "Overboost means the wastegates can't bleed enough: sticking or weak wastegate actuators, a split or blocked wastegate line, a duty table that is too aggressive, or boost creep at high rpm on larger turbos. It can also be a boost sensor fault (FSM P0236/P0240). The ECU limits torque on overboost (FSM EC-589).",
    refs: ["FSM EC-311 (P0234 / P1334 overboost)", "FSM EC-589 (fail-safe: torque restricted)"],
    dtc: ["P0234", "P1334"],
    params: [p("warn", "Over target warning", "bar", 0.15, 0.01), p("crit", "Over target critical", "bar", 0.3, 0.01), p("minPedal", "Pedal held at or above", "%", 60), p("minDur", "Minimum duration", "s", 0.3, 0.05)],
    run(c, q, emit) {
      const err = boostError(c)
      if (!err) return "Needs Boost + Boost Target (or Boost Error)"
      // Target drops instantly on lift-off and in failsafe while real boost
      // decays, so only judge it with the pedal held.
      const held = c.pedalHeld(q.minPedal)
      const ok = (i: number) => c.running[i] === 1 && held[i] === 1 && !c.shifting[i] && !c.inFailsafe(i)
      for (const [s, e] of spans(c, (i) => ok(i) && err.v[i] >= q.warn, q.minDur)) {
        const k = argmax(s, e, (i) => err.v[i])
        emit({ severity: sev(err.v[k], q.crit), title: `Overboost +${fmt2(err.v[k])} bar`, detail: `${fmtBar(err.v[k])} over target${c.rpm ? ` at ${fmt0(c.rpm.v[k])} rpm` : ""}, for ${dur(c, s, e)}.`, s, e, peak: k, channels: err.channels.concat([c.find([/^wastegate duty$/i]), c.rpm]) })
      }
    },
  },
  {
    id: "underboost",
    title: "Boost not reaching target",
    system: "Boost",
    summary: "Boost well below target at full throttle after it has stopped climbing (spool-up lag on larger turbos is ignored).",
    advice: "Look for a boost leak first: intercooler pipes, couplers, the recirculation/diverter valves, and the throttle body O-rings. Then check the wastegate solenoid and its lines, actuators sticking open, and the turbos themselves. If wastegate duty is maxed and boost still falls short, the turbos are at their limit.",
    refs: ["FSM EC-466 (P2263 / P1263 turbo boost system performance)"],
    dtc: ["P2263", "P1263"],
    params: [
      p("warn", "Under target warning", "bar", 0.3, 0.05),
      p("crit", "Under target critical", "bar", 0.6, 0.05),
      p("minRpm", "From engine speed", "rpm", 4500, 100),
      p("minPedal", "Pedal held at or above", "%", 80),
      p("plateau", "Boost rising slower than", "bar/s", 0.5, 0.05),
      p("minDur", "Minimum duration", "s", 0.6, 0.1),
    ],
    run(c, q, emit) {
      const err = boostError(c)
      if (!err || !c.rpm) return "Needs Boost + Boost Target and Engine Speed"
      const held = c.pedalHeld(q.minPedal, 0.5)
      const ok = (i: number) =>
        c.running[i] === 1 &&
        held[i] === 1 &&
        !c.shifting[i] &&
        !c.inFailsafe(i) &&
        c.rpm!.v[i] >= q.minRpm &&
        !(c.boostRate(i) > q.plateau)
      for (const [s, e] of spans(c, (i) => ok(i) && -err.v[i] >= q.warn, q.minDur)) {
        const k = argmax(s, e, (i) => -err.v[i])
        emit({ severity: sev(-err.v[k], q.crit), title: `Underboost ${fmt2(err.v[k])} bar`, detail: `${fmtBar(-err.v[k])} below target at ${fmt0(c.rpm.v[k])} rpm, for ${dur(c, s, e)}.`, s, e, peak: k, channels: err.channels.concat([c.find([/^wastegate duty$/i]), c.rpm]) })
      }
    },
  },
  {
    id: "boost-bank-split",
    title: "Boost bank-to-bank difference",
    system: "Boost",
    summary: "Bank 1 and bank 2 boost disagree under boost.",
    advice: "The VR38 has one turbo per bank, so a split usually means one side has a leak (coupler, intercooler, recirc valve), a lazy wastegate actuator or wastegate line, a tired turbo, or a boost sensor out of calibration (FSM P0236/P0240).",
    refs: ["FSM EC-314 (P0236 / P0240 boost sensor range)"],
    dtc: ["P0236", "P0240"],
    params: [p("warn", "Difference warning", "bar", 0.15, 0.01), p("crit", "Difference critical", "bar", 0.3, 0.01), p("minBoost", "Minimum boost (gauge)", "bar", 0.5, 0.05), p("minDur", "Minimum duration", "s", 0.5, 0.05)],
    run(c, q, emit) {
      const a = c.find([/^boost bank ?1$/i], "pressure")
      const b = c.find([/^boost bank ?2$/i], "pressure")
      if (!a || !b) return "Needs Boost Bank 1 and Bank 2"
      const d = (i: number) => Math.abs(a.v[i] - b.v[i])
      const held = c.pedalHeld(60)
      const ok = (i: number) => c.running[i] === 1 && held[i] === 1 && !c.shifting[i] && (!c.boostGauge || c.boostGauge[i] >= q.minBoost)
      for (const [s, e] of spans(c, (i) => ok(i) && d(i) >= q.warn, q.minDur)) {
        const k = argmax(s, e, d)
        emit({ severity: sev(d(k), q.crit), title: `Boost banks ${fmt2(d(k))} bar apart`, detail: `B1 ${fmtBar(a.v[k])} vs B2 ${fmtBar(b.v[k])}, for ${dur(c, s, e)}.`, s, e, peak: k, channels: [a, b, c.rpm] })
      }
    },
  },
  {
    id: "wastegate-maxed",
    title: "Wastegate duty maxed while under target",
    system: "Boost",
    summary: "Wastegate solenoid at (near) full duty and boost still below target: there is nothing left to give.",
    advice: "Either there is a boost leak, or the turbos are at their limit for this target (common at high rpm on stock turbos and in thin air). Lower the target at that rpm, or find the leak.",
    refs: ["FSM EC-575 (stock BOOST S/V DUTY 30–60% above 3,000 rpm)"],
    params: [p("duty", "Duty at or above", "%", 95), p("under", "Under target by", "bar", 0.2, 0.05), p("minRpm", "From engine speed", "rpm", 4000, 100), p("minDur", "Minimum duration", "s", 0.5, 0.05)],
    run(c, q, emit) {
      const wg = c.find([/^wastegate duty$/i, /^boost s\/v duty$/i])
      const err = boostError(c)
      if (!wg || !err || !c.rpm) return "Needs Wastegate Duty, Boost Target and Engine Speed"
      const held = c.pedalHeld(80, 0.5)
      const ok = (i: number) =>
        c.running[i] === 1 && held[i] === 1 && !c.shifting[i] && !c.inFailsafe(i) && c.rpm!.v[i] >= q.minRpm && wg.v[i] >= q.duty && -err.v[i] >= q.under
      for (const [s, e] of spans(c, ok, q.minDur)) {
        const k = argmax(s, e, (i) => -err.v[i])
        emit({ severity: "warn", title: `WG ${fmt0(wg.v[k])}% and ${fmt2(-err.v[k])} bar under target`, detail: `At ${fmt0(c.rpm.v[k])} rpm, for ${dur(c, s, e)}.`, s, e, peak: k, channels: [wg, ...err.channels, c.rpm] })
      }
    },
  },

  {
    id: "sensor-flatline",
    title: "Sensor pegged / flat-lined",
    system: "Boost",
    summary:
      "A pressure reading sits perfectly flat at its maximum while the engine is clearly working: the sensor is at the end of its range (stock boost / MAP sensors stop at 2.80 bar absolute) or has failed (a flat ~120 psi oil pressure means a dead sender).",
    advice:
      "Above a saturated boost sensor the real boost is unknown, and boost control and fuelling are blind. Fit higher range sensors and rescale them. A flat oil pressure reading is a failed sender, not good oil pressure, so check with a mechanical gauge before trusting it.",
    refs: ["EcuTek GT-R Live Data (stock boost / MAP sensors read to 2.80 bar abs)", "COBB GT-R oil pressure gauge note (flat 120 psi = failed sensor)"],
    params: [p("minDur", "Flat for at least", "s", 0.5, 0.1), p("minRpmSpan", "While rpm moves by", "rpm", 500, 50)],
    run(c, q, emit) {
      const list = [
        c.find([/^boost bank ?1$/i], "pressure"),
        c.find([/^boost bank ?2$/i], "pressure"),
        c.find([/^manifold absolute pressure$/i], "pressure"),
        c.find([/^engine oil pressure$/i, /^oil pressure$/i], "pressure"),
      ].filter(Boolean) as Ch[]
      if (!list.length || !c.rpm) return "No boost, MAP or oil pressure channel"
      for (const ch of list) {
        let max = -Infinity
        for (let i = 0; i < c.n; i++) if (ch.v[i] > max) max = ch.v[i]
        const oil = /oil/i.test(ch.label)
        if (!fin(max) || (oil ? max < 6 : max < 2)) continue
        // one finding per channel: total time pegged, first and longest stretch
        let total = 0
        let count = 0
        let atIdle = false
        let first: [number, number] | null = null
        let longest: [number, number] | null = null
        let lo = Infinity
        let hi = -Infinity
        for (const [s, e] of spans(c, (i) => c.running[i] === 1 && ch.v[i] >= max - 1e-6, q.minDur, 0.04)) {
          let a = Infinity
          let b = -Infinity
          for (let i = s; i <= e; i++) {
            a = Math.min(a, c.rpm.v[i])
            b = Math.max(b, c.rpm.v[i])
          }
          if (b - a < q.minRpmSpan && b >= 1500) continue
          if (b < 1500) atIdle = true
          lo = Math.min(lo, a)
          hi = Math.max(hi, b)
          count++
          total += c.t[e] - c.t[s] + c.dt
          first ??= [s, e]
          if (!longest || e - s > longest[1] - longest[0]) longest = [s, e]
        }
        if (!first || !longest) continue
        // Oil pegged only at high rpm is the sender's range limit; pegged at
        // idle too means the sender is dead.
        const failed = oil && atIdle
        emit({
          severity: oil ? (failed ? "warn" : "info") : "critical",
          title: `${ch.label} pegged at ${fmtBar(max)}`,
          detail: `Flat at its maximum ${count}× for ${total.toFixed(1)} s in total (rpm ${fmt0(lo)}–${fmt0(hi)}). ${
            oil
              ? failed
                ? "It also sits there at idle, which points to a failed sender."
                : "Only at higher rpm, so this is most likely the sender's range limit: real pressure above it is not measured."
              : "Sensor range exceeded: the real boost is unknown."
          }`,
          s: first[0],
          e: longest[1],
          peak: longest[0],
          channels: [ch, c.rpm],
        })
      }
    },
  },

  // --------------------------------------------------------- Air & throttle
  {
    id: "maf-maxed",
    title: "MAF sensor maxed out",
    system: "Air & throttle",
    summary: "MAF voltage at the top of its range: the ECU can no longer measure the extra airflow, so fuelling is guessed.",
    advice: "The engine flows more air than the MAF housing can read. Fit larger MAF housings (with rescaling) or move to speed density (a MAP sensor kit). Until then, fuelling above this point relies on the scaling and is not measured.",
    refs: ["FSM EC-580 (MAF 0.9–1.2 V idle, 1.4–1.8 V at 2,500 rpm stock)"],
    params: [p("warn", "Voltage", "V", 4.9, 0.05), p("minDur", "Minimum duration", "s", 0.1, 0.05)],
    run(c, q, emit) {
      const chs = [c.find([/^mass airflow sensor bank #?1$/i]), c.find([/^mass airflow sensor bank #?2$/i])].filter(Boolean) as Ch[]
      if (!chs.length) return "No MAF voltage channel"
      for (const ch of chs) {
        for (const [s, e] of spans(c, (i) => ch.v[i] >= q.warn, q.minDur)) {
          const k = argmax(s, e, (i) => ch.v[i])
          emit({ severity: "warn", title: `${ch.label} at ${fmt2(ch.v[k])} V`, detail: `Above ${q.warn} V for ${dur(c, s, e)}${c.rpm ? ` from ${fmt0(c.rpm.v[s])} rpm` : ""}.`, s, e, peak: k, channels: [ch, c.rpm] })
        }
      }
    },
  },
  {
    id: "iat",
    title: "Intake air hot",
    system: "Air & throttle",
    summary: "Intake air temperature high under load (heat soak or intercooler limit). Timing comes out and knock risk goes up.",
    advice: "Let the car cool between pulls and check intercooler airflow. A sensor reading hot at idle but fine on the move is normal heat soak. Hot under sustained boost means the intercoolers are at their limit (upgrade, or methanol/water injection).",
    refs: ["Suggested limits (no published GT-R figure)"],
    params: [p("warn", "Warning", "°C", 50), p("crit", "Critical", "°C", 60), p("minPedal", "Minimum pedal", "%", 50)],
    run(c, q, emit) {
      const ch = c.find([/^intake air temperature$/i, /^iat$/i], "temp")
      if (!ch) return "No IAT channel"
      for (const [s, e] of spans(c, (i) => c.running[i] === 1 && (!c.pedal || c.pedal.v[i] >= q.minPedal) && ch.v[i] >= q.warn, 0.3, 0.5)) {
        const k = argmax(s, e, (i) => ch.v[i])
        emit({ severity: sev(ch.v[k], q.crit), title: `IAT ${fmt0(ch.v[k])} °C under load`, detail: `Peak ${fmt1(ch.v[k])} °C for ${dur(c, s, e)}.`, s, e, peak: k, channels: [ch, c.pedal] })
      }
    },
  },
  {
    id: "throttle-cut",
    title: "Throttle closing at full pedal",
    system: "Air & throttle",
    summary: "Pedal at full but the throttle plates are well short of open: a torque limit (TCM, VDC, traction, temperature protection) is closing them.",
    advice: "Look at the torque limit channels (TQ Active Source, TC / CSP reduction, Torque Limit TCM / VDC) at the same moment. Common reasons are traction control, TCM torque limits in low gears, overheating protection, and ETC fail-safe (throttle held at about 5° or limited to 20°, FSM EC-590).",
    refs: ["EcuTek GT-R Live Data (WOT: pedal 92–95%, throttle 72–74°)", "FSM EC-589 / EC-590 (ETC fail-safe)"],
    params: [p("pedal", "Pedal at or above", "%", 88), p("angle", "Throttle below", "°", 65), p("minRpm", "Minimum engine speed", "rpm", 3000, 100), p("minDur", "Minimum duration", "s", 0.5, 0.05)],
    run(c, q, emit) {
      const th = c.find([/^throttle angle bank #?1$/i, /^throttle angle$/i])
      if (!th || !c.pedal || !c.rpm) return "Needs Throttle Angle, pedal and Engine Speed"
      const ok = (i: number) => c.running[i] === 1 && !c.shifting[i] && c.pedal!.v[i] >= q.pedal && c.rpm!.v[i] >= q.minRpm && th.v[i] < q.angle
      const tq = [c.find([/^tc torque reduction$/i]), c.find([/^tq active source$/i]), c.find([/^torque limit tcm$/i]), c.find([/^torque limit vdc$/i])]
      for (const [s, e] of spans(c, ok, q.minDur)) {
        const k = argmax(s, e, (i) => -th.v[i])
        emit({ severity: "info", title: `Throttle at ${fmt0(th.v[k])}° with ${fmt0(c.pedal.v[k])}% pedal`, detail: `At ${fmt0(c.rpm.v[k])} rpm for ${dur(c, s, e)}. Something is limiting torque.`, s, e, peak: k, channels: [th, c.pedal, ...tq] })
      }
    },
  },
  {
    id: "sensor-correlation",
    title: "Throttle / pedal sensors disagree",
    system: "Air & throttle",
    summary: "The two pedal sensors, or the two throttle bodies, read differently.",
    advice: "Pedal sensors that disagree set P2138 and drop the car into ETC fail-safe. Throttle bodies that disagree point to a dirty or failing throttle body or a bad TPS. Clean the throttle bodies and redo idle air volume / closed throttle learning (FSM EC-22) before replacing parts.",
    refs: ["FSM EC-508 (P2138 APP range/performance)", "FSM EC-463 (P1239 / P2135 TP range/performance)"],
    dtc: ["P2138", "P2135", "P1239"],
    params: [p("app", "Pedal difference", "%", 5, 0.5), p("throttle", "Throttle bank difference", "°", 5, 0.5), p("minDur", "Minimum duration", "s", 0.3, 0.05)],
    run(c, q, emit) {
      const a1 = c.find([/^accel position sensor 1$/i])
      const a2 = c.find([/^accel position sensor 2$/i])
      const t1 = c.find([/^throttle angle bank #?1$/i])
      const t2 = c.find([/^throttle angle bank #?2$/i])
      if (!(a1 && a2) && !(t1 && t2)) return "Needs both pedal sensors or both throttle angles"
      const pairs: [Ch, Ch, number, string][] = []
      if (a1 && a2) pairs.push([a1, a2, q.app, "%"])
      if (t1 && t2) pairs.push([t1, t2, q.throttle, "°"])
      for (const [x, y, lim, u] of pairs) {
        const d = (i: number) => Math.abs(x.v[i] - y.v[i])
        for (const [s, e] of spans(c, (i) => c.running[i] === 1 && d(i) >= lim, q.minDur)) {
          const k = argmax(s, e, d)
          emit({ severity: d(k) >= lim * 2 ? "critical" : "warn", title: `${x.label} vs ${y.label}: ${fmt1(d(k))}${u} apart`, detail: `${fmt1(x.v[k])}${u} vs ${fmt1(y.v[k])}${u} for ${dur(c, s, e)}.`, s, e, peak: k, channels: [x, y] })
        }
      }
    },
  },

  // -------------------------------------------------------------- Cooling
  {
    id: "coolant-temp",
    title: "Coolant hot",
    system: "Cooling",
    summary: "Engine coolant above the warning limit. Above 110 °C the ECU restricts boost to protect the engine (FSM EC-629).",
    advice: "Check the coolant level and the cooling fans, and look for a blocked radiator or intercooler stack in front of it. If the coolant pressure check also fires, suspect a head gasket or combustion gas leak. Back off: the ECU will already be cutting boost above 110 °C.",
    refs: ["FSM EC-629 (boost restriction above 110 °C)", "FSM EC-443 (P1217 engine over temperature)"],
    dtc: ["P1217"],
    params: [p("warn", "Warning", "°C", 105), p("crit", "Critical", "°C", 110)],
    run(c, q, emit) {
      const ch = c.find([/^coolant temperature$/i, /^engine coolant temp/i, /^ect$/i], "temp")
      if (!ch) return "No coolant temperature channel"
      for (const [s, e] of spans(c, (i) => ch.v[i] >= q.warn, 1, 1)) {
        const k = argmax(s, e, (i) => ch.v[i])
        emit({ severity: sev(ch.v[k], q.crit), title: `Coolant ${fmt0(ch.v[k])} °C`, detail: `Peak ${fmt1(ch.v[k])} °C, above ${q.warn} °C for ${dur(c, s, e)}.`, s, e, peak: k, channels: [ch, c.find([/^coolant pressure$/i], "pressure")] })
      }
    },
  },
  {
    id: "coolant-pressure",
    title: "Coolant pressure high",
    system: "Cooling",
    summary:
      "Cooling system pressure above the cap's normal range, or pressure building while the engine is still cold (it should only rise as coolant heats up).",
    advice:
      "Pressure that builds fast under boost, or while the engine is cold, is the classic sign of combustion gas getting into the coolant: a head gasket or a cracked liner/head. Do a block (combustion leak) test and a cooling system pressure test. Also check the radiator cap rating and condition, and bleed trapped air. RaceROM can failsafe on high coolant pressure.",
    refs: ["EcuTek GT-R ECM Phase 6 manual: high coolant pressure is an early sign of head gasket failure", "Aftermarket caps 1.3–1.5 bar (suggested limits)"],
    params: [p("warn", "Warning", "bar", 1.3, 0.05), p("crit", "Critical", "bar", 1.6, 0.05), p("cold", "Cold-engine warning", "bar", 0.8, 0.05), p("coldTemp", "Cold below", "°C", 70)],
    run(c, q, emit) {
      const ch = c.find([/^coolant pressure$/i], "pressure")
      if (!ch) return "No coolant pressure sensor in this log"
      const ect = c.find([/^coolant temperature$/i], "temp")
      for (const [s, e] of spans(c, (i) => ch.v[i] >= q.warn, 0.3, 0.5)) {
        const k = argmax(s, e, (i) => ch.v[i])
        emit({ severity: sev(ch.v[k], q.crit), title: `Coolant pressure ${fmtBar(ch.v[k])}`, detail: `Above ${fmtBar(q.warn)} for ${dur(c, s, e)}${ect ? ` with coolant at ${fmt0(ect.v[k])} °C` : ""}.`, s, e, peak: k, channels: [ch, ect, c.boostGauge ? c.find([/^manifold gauge pressure$/i, /^boost bank ?1$/i]) : null, c.rpm] })
      }
      if (ect) {
        for (const [s, e] of spans(c, (i) => c.running[i] === 1 && ect.v[i] < q.coldTemp && ch.v[i] >= q.cold, 0.5, 0.5)) {
          const k = argmax(s, e, (i) => ch.v[i])
          emit({ severity: "warn", title: `Coolant pressurising while cold (${fmtBar(ch.v[k])})`, detail: `${fmtBar(ch.v[k])} with coolant at only ${fmt0(ect.v[k])} °C. Cold coolant should not build that much pressure.`, s, e, peak: k, channels: [ch, ect, c.rpm] })
        }
      }
    },
  },

  // ------------------------------------------------------------------ Oil
  {
    id: "oil-pressure",
    title: "Oil pressure low for the rpm",
    system: "Oil",
    summary: "Oil pressure below the rule of thumb of ~10 psi (0.69 bar) per 1,000 rpm, or below an absolute minimum at idle.",
    advice: "Stop and check the oil level first: the VR38 starves under sustained cornering when the oil is low. Then check the sender, the oil grade and temperature, bearing wear and the pickup. RaceROM can failsafe on low oil pressure. A single dip during hard cornering points to surge.",
    refs: ["GT-R community practice (10 psi per 1,000 rpm)", "RaceROM failsafe: low oil pressure"],
    params: [p("perK", "Per 1,000 rpm", "bar", 0.69, 0.01), p("cap", "Required above 5,000 rpm", "bar", 3.4, 0.1), p("idleMin", "Idle minimum", "bar", 0.7, 0.05), p("crit", "Critical below", "bar", 1.0, 0.05), p("minDur", "Minimum duration", "s", 0.5, 0.05)],
    run(c, q, emit) {
      const ch = c.find([/^engine oil pressure$/i, /^oil pressure$/i], "pressure")
      if (!ch || !c.rpm) return "Needs Engine Oil Pressure and Engine Speed"
      const need = (i: number) => Math.max(q.idleMin, Math.min(q.cap, (c.rpm!.v[i] / 1000) * q.perK))
      const ok = (i: number) => c.running[i] === 1 && c.rpm!.v[i] >= 600 && ch.v[i] < need(i)
      for (const [s, e] of spans(c, ok, q.minDur)) {
        const k = argmax(s, e, (i) => need(i) - ch.v[i])
        emit({
          severity: ch.v[k] < q.crit && c.rpm.v[k] >= 2000 ? "critical" : "warn",
          title: `Oil pressure ${fmtBar(ch.v[k])} at ${fmt0(c.rpm.v[k])} rpm`,
          detail: `Expected at least ${fmtBar(need(k))} at that rpm. Low for ${dur(c, s, e)}.`,
          s,
          e,
          peak: k,
          channels: [ch, c.rpm, c.find([/^g force lateral$/i])],
        })
      }
    },
  },

  // ------------------------------------------------------------- Traction
  {
    id: "wheel-slip",
    title: "Excessive wheel slip",
    system: "Traction",
    summary: "Wheel Slip Ratio above the limit while moving (shift moments ignored, the ratio spikes there).",
    advice: "Wheelspin wastes power and loads the driveline when the tyres bite again. Check tyre pressures and temperatures, the 4WD torque split (ATTESA) and the traction control setting. On a tuned car, reduce torque in the low gears or add boost-by-gear / traction control tables.",
    refs: ["EcuTek GT-R RaceROM Traction Control (ratio = 100 × (rear − front) / front; ~10% optimal straight line, ~2% cornering)"],
    params: [p("warn", "Warning", "%", 15), p("crit", "Critical", "%", 25), p("minSpeed", "Minimum vehicle speed", "km/h", 10), p("minDur", "Minimum duration", "s", 0.3, 0.05)],
    run(c, q, emit) {
      const ch = c.find([/^wheel slip ratio$/i])
      if (!ch) return "No Wheel Slip Ratio channel"
      const ok = (i: number) => !c.shifting[i] && (!c.speed || c.speed.v[i] >= q.minSpeed) && Math.abs(ch.v[i]) >= q.warn
      for (const [s, e] of spans(c, ok, q.minDur)) {
        const k = argmax(s, e, (i) => Math.abs(ch.v[i]))
        emit({ severity: sev(Math.abs(ch.v[k]), q.crit), title: `Wheel slip ${fmt0(ch.v[k])}%${c.gear ? ` in ${ord(c.gear.v[k])}` : ""}`, detail: `Peak ${fmt1(ch.v[k])}%${c.speed ? ` at ${fmt0(c.speed.v[k])} km/h` : ""}, for ${dur(c, s, e)}.`, s, e, peak: k, channels: [ch, c.find([/^wheel speed front$/i, /^wheel speed fl$/i]), c.find([/^wheel speed rear$/i, /^wheel speed rl$/i]), c.find([/^4wd torque split$/i]), c.find([/^tc torque reduction$/i])] })
      }
    },
  },
  {
    id: "tc-intervention",
    title: "Traction control cut torque",
    system: "Traction",
    summary: "TC Torque Reduction active: traction control pulled torque.",
    advice: "Expected occasionally. If it happens on every pull, the car is over-tyred for the torque or the TC tables are too sensitive. Compare with the wheel slip at the same time.",
    refs: ["EcuTek RaceROM traction control"],
    params: [p("min", "Reduction at or above", "%", 10), p("minDur", "Minimum duration", "s", 0.2, 0.05)],
    run(c, q, emit) {
      const ch = c.find([/^tc torque reduction$/i])
      if (!ch) return "No TC Torque Reduction channel"
      for (const [s, e] of spans(c, (i) => ch.v[i] >= q.min, q.minDur, 0.3)) {
        const k = argmax(s, e, (i) => ch.v[i])
        emit({ severity: "info", title: `TC reduced torque ${fmt0(ch.v[k])}%`, detail: `For ${dur(c, s, e)}${c.gear ? ` in ${ord(c.gear.v[k])}` : ""}.`, s, e, peak: k, channels: [ch, c.find([/^wheel slip ratio$/i])] })
      }
    },
  },
  {
    id: "speed-mismatch",
    title: "Vehicle speed vs wheel speed mismatch",
    system: "Traction",
    summary: "Vehicle speed and the average wheel speed disagree by more than 15 km/h for 5 s above 20 km/h (FSM P0500 logic).",
    advice: "A speed source is wrong: the output shaft speed sensor, a wheel speed sensor or the CAN source. It can also be sustained wheelspin. The ECM runs the cooling fan on high in this fail-safe (FSM EC-589).",
    refs: ["FSM EC-411 (P0500 VSS)"],
    dtc: ["P0500"],
    params: [p("diff", "Difference", "km/h", 15), p("minSpeed", "Above", "km/h", 20), p("minDur", "For", "s", 5, 0.5)],
    run(c, q, emit) {
      const f = c.find([/^wheel speed front$/i], "speed")
      const r = c.find([/^wheel speed rear$/i], "speed")
      const four = [c.find([/^wheel speed fl$/i], "speed"), c.find([/^wheel speed fr$/i], "speed"), c.find([/^wheel speed rl$/i], "speed"), c.find([/^wheel speed rr$/i], "speed")]
      if (!c.speed || (!(f && r) && four.some((x) => !x))) return "Needs Vehicle Speed and wheel speeds"
      const avg = (i: number) => (f && r ? (f.v[i] + r.v[i]) / 2 : four.reduce((a, x) => a + x!.v[i], 0) / 4)
      const d = (i: number) => Math.abs(c.speed!.v[i] - avg(i))
      for (const [s, e] of spans(c, (i) => c.speed!.v[i] >= q.minSpeed && d(i) >= q.diff, q.minDur)) {
        const k = argmax(s, e, d)
        emit({ severity: "warn", title: `Speed sources ${fmt0(d(k))} km/h apart`, detail: `Vehicle Speed ${fmt0(c.speed.v[k])} vs wheels ${fmt0(avg(k))} km/h for ${dur(c, s, e)}.`, s, e, peak: k, channels: [c.speed, f, r] })
      }
    },
  },

  // ----------------------------------------------------------- Electrical
  {
    id: "battery",
    title: "Battery / charging voltage",
    system: "Electrical",
    summary: "Voltage low or high with the engine running (FSM: 11–14 V at key-on, diagnosis needs 10–16 V at idle).",
    advice: "Low while running: the alternator isn't charging (belt, alternator, wiring, ground). Low voltage also slows the fuel pumps, so fuel pressure drops at WOT. High: the regulator is overcharging, which is hard on the ECU and the battery.",
    refs: ["FSM EC-570 (BATTERY VOLT 11–14 V)", "FSM EC-196 (10–16 V at idle)"],
    params: [p("low", "Low warning (running)", "V", 12.5, 0.1), p("lowCrit", "Low critical", "V", 11.5, 0.1), p("high", "High warning", "V", 15.0, 0.1), p("highCrit", "High critical", "V", 16.0, 0.1), p("minDur", "Minimum duration", "s", 2, 0.5)],
    run(c, q, emit) {
      const ch = c.find([/^battery voltage$/i, /^battey voltage$/i, /^system voltage$/i])
      if (!ch) return "No battery voltage channel"
      for (const [s, e] of spans(c, (i) => c.running[i] === 1 && ch.v[i] < q.low, q.minDur, 0.5)) {
        const k = argmax(s, e, (i) => -ch.v[i])
        emit({ severity: ch.v[k] < q.lowCrit ? "critical" : "warn", title: `Voltage low: ${fmt2(ch.v[k])} V`, detail: `Below ${q.low} V with the engine running for ${dur(c, s, e)}.`, s, e, peak: k, channels: [ch, c.rpm] })
      }
      for (const [s, e] of spans(c, (i) => ch.v[i] > q.high, q.minDur, 0.5)) {
        const k = argmax(s, e, (i) => ch.v[i])
        emit({ severity: ch.v[k] > q.highCrit ? "critical" : "warn", title: `Voltage high: ${fmt2(ch.v[k])} V`, detail: `Above ${q.high} V for ${dur(c, s, e)}.`, s, e, peak: k, channels: [ch, c.rpm] })
      }
    },
  },

  // --------------------------------------------------------------- Engine
  {
    id: "vvt",
    title: "Intake cam timing not following target",
    system: "Engine",
    summary: "VVT angle and VVT target differ for longer than a second (FSM P0011/P0021 logic: 1,200–3,175 rpm, coolant above 60 °C).",
    advice: "Check the oil level and grade first: VVT runs on oil pressure. Then the intake valve timing control solenoid and its connector, and the timing chain (stretch). A slow response only when cold is normal.",
    refs: ["FSM EC-196 (P0011 / P0021 IVT)"],
    dtc: ["P0011", "P0021"],
    params: [p("warn", "Error warning", "°", 5, 0.5), p("crit", "Error critical", "°", 10, 0.5), p("minDur", "Minimum duration", "s", 1, 0.1), p("minRpm", "From", "rpm", 1200, 100), p("maxRpm", "To", "rpm", 5000, 100)],
    run(c, q, emit) {
      const tgt = c.find([/^vvt target$/i])
      const banks = [c.find([/^vvt intake angle bank #?1$/i]), c.find([/^vvt intake angle bank #?2$/i])].filter(Boolean) as Ch[]
      if (!tgt || !banks.length || !c.rpm) return "Needs VVT Target, VVT angle and Engine Speed"
      const ect = c.find([/^coolant temperature$/i], "temp")
      for (const ch of banks) {
        const err = (i: number) => Math.abs(ch.v[i] - tgt.v[i])
        const ok = (i: number) => c.running[i] === 1 && c.rpm!.v[i] >= q.minRpm && c.rpm!.v[i] <= q.maxRpm && (!ect || ect.v[i] > 60) && err(i) >= q.warn
        for (const [s, e] of spans(c, ok, q.minDur)) {
          const k = argmax(s, e, err)
          emit({ severity: sev(err(k), q.crit), title: `${ch.label} ${fmt1(err(k))}° off target`, detail: `${fmt1(ch.v[k])}° vs ${fmt1(tgt.v[k])}° target at ${fmt0(c.rpm.v[k])} rpm, for ${dur(c, s, e)}.`, s, e, peak: k, channels: [ch, tgt, c.rpm] })
        }
      }
    },
  },
  {
    id: "rev-limit",
    title: "High engine speed",
    system: "Engine",
    summary: "Engine speed above the limit you set (e.g. limiter strikes, or flares on shifts).",
    advice:
      "Above 8,192 rpm the TCM's clutch speed maths overflows: it sets P0746 and releases the clutch, so keep the limiter and any shift flare below that. Repeated limiter hits on upshifts usually mean the shift points are too close to the limiter or a shift was late. Spikes during shifts are covered by the flare check. Set the warning to your car's rev limit.",
    refs: ["EcuTek GT-R TCM Clutch Pressure Tuning (8,192 rpm limit, P0746)"],
    dtc: ["P0746"],
    params: [p("warn", "Warning", "rpm", 7800, 100), p("crit", "Critical", "rpm", 8192, 1)],
    run(c, q, emit) {
      if (!c.rpm) return "No Engine Speed channel"
      for (const [s, e] of spans(c, (i) => c.rpm!.v[i] >= q.warn, 0, 0.2)) {
        const k = argmax(s, e, (i) => c.rpm!.v[i])
        emit({ severity: sev(c.rpm.v[k], q.crit), title: `${fmt0(c.rpm.v[k])} rpm${c.shifting[k] ? " during a shift" : ""}`, detail: `Above ${fmt0(q.warn)} rpm for ${dur(c, s, e)}${c.gear ? ` in ${ord(c.gear.v[k])}` : ""}.`, s, e, peak: k, channels: [c.rpm, c.gear, c.find([/^clutch slip$/i])] })
      }
    },
  },
  {
    id: "idle-reference",
    title: "Idle values outside the factory reference",
    system: "Engine",
    summary:
      "Warm idle (coolant above 70 °C, pedal released, stationary) compared with the FSM CONSULT reference values: idle 825 ± 50 rpm, timing 7–11°, MAF 0.9–1.2 V / 2–6 g/s, injector pulse 1.4–2.4 ms, load 5–35%, intake cam −5 to 5°.",
    advice: "These are stock reference values, so a tuned car with a raised idle or bigger MAF housings will differ on purpose. Use this as a sanity check: a stock car out of range here points to a vacuum leak (high MAF, low load), dirty throttle bodies (idle speed), or injector or MAF issues. An idle below target by 100 rpm or above it by 200 rpm sets P0506 / P0507.",
    refs: ["FSM EC-570 – EC-575 (CONSULT reference values)", "FSM EC-640 (SDS idle 825 ± 50 rpm)", "FSM EC-413 / EC-415 (P0506 / P0507)"],
    dtc: ["P0506", "P0507"],
    defaultOff: true,
    params: [p("minDur", "Warm idle at least", "s", 3, 0.5)],
    run(c, q, emit) {
      if (!c.rpm) return "No Engine Speed channel"
      const ect = c.find([/^coolant temperature$/i], "temp")
      const idle = (i: number) =>
        c.running[i] === 1 && c.rpm!.v[i] < 1500 && (!c.pedal || c.pedal.v[i] <= c.pedalRest + 2) && (!c.speed || c.speed.v[i] < 1) && (!ect || ect.v[i] > 70)
      const runs = spans(c, idle, q.minDur, 0.3)
      if (!runs.length) return "No warm idle in this log"
      const [s, e] = runs.reduce((a, b) => (b[1] - b[0] > a[1] - a[0] ? b : a))
      const med = (ch: Ch) => median(Array.from(ch.v.subarray(s, e + 1)))
      const target = c.find([/^engine idle speed$/i])
      const checks: [Ch | null, number, number, string][] = [
        [c.find([/^ignition timing$/i]), 7, 11, "°"],
        [c.find([/^mass airflow sensor bank #?1$/i]), 0.9, 1.2, " V"],
        [c.find([/^mass airflow measured/i]), 2, 6, " g/s"],
        [c.find([/^injector pulse width bank #?1$/i]), 1.4, 2.4, " ms"],
        [c.find([/^engine load$/i]), 5, 35, "%"],
        [c.find([/^vvt intake angle bank #?1$/i]), -5, 5, "°"],
        [c.find([/^throttle angle bank #?1$/i]), 1.5, 3.0, "°"],
      ]
      const rpm = med(c.rpm)
      if (target) {
        const tv = med(target)
        if (rpm < tv - 100 || rpm > tv + 200)
          emit({ severity: "warn", title: `Idle ${fmt0(rpm)} rpm vs target ${fmt0(tv)}`, detail: `Warm idle median ${fmt0(rpm)} rpm. The FSM sets P0506 at −100 rpm and P0507 at +200 rpm from target.`, s, e, peak: s, channels: [c.rpm, target] })
      } else if (rpm < 775 || rpm > 875) {
        emit({ severity: "info", title: `Idle ${fmt0(rpm)} rpm (FSM 825 ± 50)`, detail: `Warm idle median ${fmt0(rpm)} rpm.`, s, e, peak: s, channels: [c.rpm] })
      }
      for (const [ch, lo, hi, u] of checks) {
        if (!ch) continue
        const v = med(ch)
        if (fin(v) && (v < lo || v > hi)) emit({ severity: "info", title: `${ch.label} ${fmt2(v)}${u} at idle`, detail: `FSM reference ${lo}–${hi}${u} at warm idle; this log's median is ${fmt2(v)}${u}.`, s, e, peak: s, channels: [ch, c.rpm] })
      }
    },
  },
]

/**
 * Boost error (actual − target, bar). Prefers the ECU's own Boost Error
 * channel; otherwise the higher bank minus Boost Target.
 */
function boostError(c: Ctx): { v: Float64Array; channels: (Ch | null)[] } | null {
  const tgt = c.find([/^boost target$/i], "pressure")
  const b1 = c.find([/^boost bank ?1$/i], "pressure")
  const b2 = c.find([/^boost bank ?2$/i], "pressure")
  const own = c.find([/^boost error$/i], "pressure")
  if (own) return { v: own.v, channels: [b1, b2, tgt, own] }
  if (tgt && (b1 || b2)) {
    const v = new Float64Array(c.n)
    for (let i = 0; i < c.n; i++) {
      const a = b1 ? b1.v[i] : NaN
      const b = b2 ? b2.v[i] : NaN
      const act = fin(a) && fin(b) ? Math.max(a, b) : fin(a) ? a : b
      v[i] = act - tgt.v[i]
    }
    return { v, channels: [b1, b2, tgt] }
  }
  return null
}

// ---------------------------------------------------------------------------
// Runner

export function ruleEnabled(rule: RuleDef, cfg: SelfCheckConfig): boolean {
  if (cfg.disabled.includes(rule.id)) return false
  if (rule.defaultOff) return cfg.enabled.includes(rule.id)
  return true
}

export function ruleParams(rule: RuleDef, cfg: SelfCheckConfig): Record<string, number> {
  const out: Record<string, number> = {}
  const over = cfg.params[rule.id] ?? {}
  for (const prm of rule.params) {
    const v = over[prm.key]
    out[prm.key] = typeof v === "number" && Number.isFinite(v) ? v : prm.default
  }
  return out
}

const MAX_PER_RULE = 150
const RANK: Record<CheckSeverity, number> = { info: 0, warn: 1, critical: 2 }
export const severityRank = (s: CheckSeverity) => RANK[s]

export function runSelfCheck(log: ParsedLog, cfg: SelfCheckConfig = EMPTY_CONFIG, opts: { failsafeTable?: FailsafeTable } = {}): CheckReport {
  const c = new Ctx(log, opts)
  const results: RuleResult[] = []
  for (const rule of RULES) {
    if (!ruleEnabled(rule, cfg)) {
      results.push({ ruleId: rule.id, skipped: "Turned off", findings: [] })
      continue
    }
    const found: Finding[] = []
    const emit: Emit = (f) => {
      if (found.length >= MAX_PER_RULE) return
      const channels = Array.from(
        new Set(f.channels.map((x) => (typeof x === "string" ? x : x?.label)).filter((x): x is string => !!x)),
      )
      found.push({
        id: `${rule.id}:${found.length}`,
        ruleId: rule.id,
        system: rule.system,
        severity: f.severity,
        title: f.title,
        detail: f.detail,
        start: c.t[f.s],
        end: c.t[f.e],
        peak: c.t[f.peak],
        channels,
      })
    }
    let skipped: string | null = null
    try {
      const r = rule.run(c, ruleParams(rule, cfg), emit)
      if (typeof r === "string") skipped = r
    } catch (err) {
      skipped = `Check failed: ${err instanceof Error ? err.message : String(err)}`
    }
    results.push({ ruleId: rule.id, skipped, findings: found })
  }
  const findings = results
    .flatMap((r) => r.findings)
    .sort((a, b) => RANK[b.severity] - RANK[a.severity] || a.start - b.start)
  const counts: Record<CheckSeverity, number> = { info: 0, warn: 0, critical: 0 }
  for (const f of findings) counts[f.severity]++
  return { results, findings, counts, shifts: c.shifts.length, sampleRate: c.dt > 0 ? 1 / c.dt : 0 }
}

export const RULE_BY_ID: Record<string, RuleDef> = Object.fromEntries(RULES.map((r) => [r.id, r]))
