// Summary "KPI" cards derived from a parsed log. Adapts to whatever channels
// are present (RPM / speed / boost / temp), always showing duration + counts.

import type { ParsedLog } from "./csv"
import type { Signal } from "./telemetry"

export interface Kpi {
  key: string
  icon: "clock" | "gauge" | "speed" | "boost" | "channels" | "samples" | "temp"
  label: string
  value: string
  unit: string
}

function fmtNum(v: number, decimals = 0): string {
  return v.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

function find(signals: Signal[], match: (label: string) => boolean): Signal | undefined {
  return signals.find((s) => match(s.label))
}

export function computeKpis(log: ParsedLog, activeCount: number): Kpi[] {
  const cards: Kpi[] = []
  const s = log.signals

  // Max engine RPM (engine speed / rpm — NOT vehicle speed).
  const rpm = find(s, (l) => /\brpm\b/i.test(l) || /engine\s*speed/i.test(l))
  if (rpm) cards.push({ key: "rpm", icon: "gauge", label: "Max RPM", value: fmtNum(rpm.max), unit: rpm.unit === "—" ? "rpm" : rpm.unit })

  // Max vehicle speed (explicitly vehicle speed; exclude engine speed / wheel speed sensors).
  const speed =
    find(s, (l) => /vehicle\s*speed/i.test(l)) ??
    find(s, (l) => /\bspeed\b/i.test(l) && !/engine|wheel|fan|slip/i.test(l))
  if (speed) cards.push({ key: "speed", icon: "speed", label: "Max Speed", value: fmtNum(speed.max, 1), unit: speed.unit === "—" ? "" : speed.unit })

  // Peak boost = max(boost) − atmospheric pressure.
  const boost =
    find(s, (l) => /boost\s*bank/i.test(l)) ??
    find(s, (l) => /\bboost\b/i.test(l) && !/target|error|desired|base|integ|propor|duty/i.test(l))
  if (boost) {
    const atmo = find(s, (l) => /atmospheric|barometric|\bbaro\b/i.test(l))
    const peak = atmo ? boost.max - atmo.avg : boost.max
    cards.push({ key: "boost", icon: "boost", label: "Boost Peak", value: fmtNum(peak, 2), unit: boost.unit === "—" ? "psi" : boost.unit })
  }

  // Max coolant temperature.
  const coolant = find(s, (l) => /coolant.*temp|coolant\s*temperature/i.test(l))
  if (coolant) cards.push({ key: "coolant", icon: "temp", label: "Max Coolant", value: fmtNum(coolant.max, 1), unit: coolant.unit === "—" ? "°C" : coolant.unit })

  cards.push({ key: "channels", icon: "channels", label: "Channels", value: `${activeCount}`, unit: `of ${log.signals.length}` })

  return cards
}
