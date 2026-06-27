// Deterministic synthetic vehicle telemetry, modeled on a CSV log capture.

// Signal keys are dynamic (real CSV columns), so this is just a string alias.
// The synthetic-sample keys below are a subset of these.
export type SignalKey = string

export interface SignalDef {
  key: SignalKey
  label: string
  unit: string
  /** index into the chart color palette (chart-1..chart-5) */
  color: number
  decimals: number
}

export interface SignalSample {
  t: number
  value: number
}

export interface Signal extends SignalDef {
  data: SignalSample[]
  min: number
  max: number
  avg: number
}

export const SIGNAL_DEFS: SignalDef[] = [
  { key: "logMark", label: "Log Mark", unit: "—", color: 1, decimals: 3 },
  { key: "torqueSplit", label: "4WD Torque Split (Front %)", unit: "%", color: 1, decimals: 2 },
  { key: "vehicleSpeed", label: "Vehicle Speed", unit: "km/h", color: 2, decimals: 1 },
  { key: "engineRpm", label: "Engine RPM", unit: "rpm", color: 3, decimals: 0 },
  { key: "throttle", label: "Throttle Position", unit: "%", color: 2, decimals: 1 },
  { key: "brakePressure", label: "Brake Pressure", unit: "bar", color: 4, decimals: 1 },
  { key: "steeringAngle", label: "Steering Angle", unit: "deg", color: 5, decimals: 1 },
  { key: "lateralG", label: "Lateral Acceleration", unit: "g", color: 3, decimals: 3 },
]

const DURATION = 24 // seconds
const STEP = 0.04 // 25 Hz
const N = Math.round(DURATION / STEP)

// Small seeded PRNG for repeatable "sensor noise".
function makeRng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0xffffffff
  }
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v))
}

// A smooth "speed profile" the other signals derive from: launch, cruise,
// braking zone, hard acceleration, then settling.
function speedProfile(t: number): number {
  const phases = [
    { at: 0, v: 0 },
    { at: 3, v: 62 },
    { at: 7, v: 48 },
    { at: 9.5, v: 18 },
    { at: 12, v: 40 },
    { at: 16, v: 118 },
    { at: 19, v: 96 },
    { at: 24, v: 88 },
  ]
  let a = phases[0]
  let b = phases[phases.length - 1]
  for (let i = 0; i < phases.length - 1; i++) {
    if (t >= phases[i].at && t <= phases[i + 1].at) {
      a = phases[i]
      b = phases[i + 1]
      break
    }
  }
  const span = b.at - a.at || 1
  const k = clamp((t - a.at) / span, 0, 1)
  const eased = k * k * (3 - 2 * k) // smoothstep
  return a.v + (b.v - a.v) * eased
}

function buildRaw() {
  const rng = makeRng(0x5eed1234)
  const rows: Record<SignalKey, number>[] = []
  let prevSpeed = 0

  for (let i = 0; i <= N; i++) {
    const t = i * STEP
    const speed = speedProfile(t)
    const accel = (speed - prevSpeed) / STEP // km/h per s
    prevSpeed = speed

    const throttle = clamp(accel > 0 ? 18 + accel * 1.6 + (rng() - 0.5) * 6 : 6 + (rng() - 0.5) * 4, 0, 100)
    const brake = clamp(accel < -2 ? -accel * 3.4 + (rng() - 0.5) * 5 : (rng() - 0.5) * 1.2, 0, 110)
    const rpm = clamp(900 + speed * 52 + throttle * 12 + (rng() - 0.5) * 120, 850, 7200)

    // torque split spikes when accelerating hard from low speed (AWD bias)
    const launch = clamp((throttle - 20) * 0.6, 0, 100)
    const lowSpeedBias = clamp((40 - speed) / 40, 0, 1)
    const torqueSplit = clamp(2 + launch * lowSpeedBias + (rng() - 0.5) * 3, 0, 50)

    // steering: a couple of cornering events
    const corner =
      14 * Math.sin(t * 0.55) + 22 * Math.exp(-Math.pow((t - 8.5) / 1.4, 2)) - 26 * Math.exp(-Math.pow((t - 18) / 1.6, 2))
    const steeringAngle = corner + (rng() - 0.5) * 2.4
    const lateralG = clamp(steeringAngle * 0.018 * (speed / 60) + (rng() - 0.5) * 0.02, -1.1, 1.1)

    rows.push({
      logMark: 0,
      torqueSplit,
      vehicleSpeed: speed,
      engineRpm: rpm,
      throttle,
      brakePressure: brake,
      steeringAngle,
      lateralG,
    })
  }
  return rows
}

export function buildSignals(): Signal[] {
  const rows = buildRaw()
  return SIGNAL_DEFS.map((def) => {
    const data: SignalSample[] = rows.map((r, i) => ({
      t: +(i * STEP).toFixed(2),
      value: +r[def.key].toFixed(def.decimals + 2),
    }))
    let min = Infinity
    let max = -Infinity
    let sum = 0
    for (const d of data) {
      if (d.value < min) min = d.value
      if (d.value > max) max = d.value
      sum += d.value
    }
    return { ...def, data, min, max, avg: sum / data.length }
  })
}

export const LOG_DURATION = DURATION
export const SAMPLE_COUNT = N + 1
