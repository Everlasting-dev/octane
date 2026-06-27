// Parse a real ECU telemetry CSV (EcuTek / generic) into the Signal shape the
// charts already consume. Mirrors the detection rules from the legacy app's
// parser.js: find a Time column, treat the remaining numeric columns as signals.

import type { Signal, SignalSample } from "./telemetry"

export interface LogMeta {
  /** vehicle identifier parsed from the filename */
  vin?: string
  /** ECU calibration / tuned dongle IDs parsed from the filename */
  calIds: string[]
  /** capture timestamp parsed from the filename */
  capturedAt?: string
  /** key/value lines pulled from CSV comment (#) lines */
  fields: { key: string; value: string }[]
}

export interface ParsedLog {
  fileName: string
  sizeLabel: string
  samples: number
  duration: number
  /** true when no Time column was found and the x-axis is a sample index */
  indexed: boolean
  signals: Signal[]
  meta: LogMeta
}

/**
 * EcuTek logs encode metadata in the filename, e.g.
 *   "JN1AR5EFXFM700052 - 80B6A,80B0BEA - 2026-06-24 16-53-48.csv"
 *    └ VIN              └ calibration IDs └ capture timestamp
 */
export function parseFileNameMeta(fileName: string): LogMeta {
  const base = fileName.replace(/\.[^.]+$/, "")
  const parts = base.split(/\s+-\s+/)
  const meta: LogMeta = { calIds: [], fields: [] }

  if (parts[0] && /^[A-HJ-NPR-Z0-9]{8,17}$/i.test(parts[0].trim())) {
    meta.vin = parts[0].trim()
  }
  if (parts[1]) {
    meta.calIds = parts[1]
      .split(/[,;/]+/)
      .map((s) => s.trim())
      .filter(Boolean)
  }
  if (parts.length >= 3) {
    // join any remaining segments, normalise "HH-MM-SS" → "HH:MM:SS"
    meta.capturedAt = parts.slice(2).join(" - ").trim().replace(/(\d{2})-(\d{2})-(\d{2})$/, "$1:$2:$3")
  }
  return meta
}

const TIME_RE = /\b(time|timestamp|elapsed)\b/i

/** Split one CSV line, honoring double-quoted fields. */
function splitLine(line: string): string[] {
  const out: string[] = []
  let cur = ""
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        cur += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ",") {
      out.push(cur)
      cur = ""
    } else {
      cur += ch
    }
  }
  out.push(cur)
  return out
}

/** Pull a unit out of a header like "Engine Speed (RPM)" -> { label, unit }. */
function splitHeader(raw: string): { label: string; unit: string } {
  const header = raw.trim()
  const m = header.match(/^(.*?)[\s_]*[([]([^)\]]+)[)\]]\s*$/)
  if (m && m[1].trim()) {
    return { label: m[1].trim(), unit: m[2].trim() }
  }
  return { label: header, unit: "" }
}

/** Choose a sensible decimal count from the value range. */
function inferDecimals(values: number[]): number {
  let allInt = true
  let maxAbs = 0
  for (const v of values) {
    if (!Number.isFinite(v)) continue
    if (!Number.isInteger(v)) allInt = false
    const a = Math.abs(v)
    if (a > maxAbs) maxAbs = a
  }
  if (allInt) return 0
  if (maxAbs < 2) return 3
  if (maxAbs < 20) return 2
  return 1
}

function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  return `${(kb / 1024).toFixed(2)} MB`
}

export function parseLog(text: string, fileName: string, byteSize: number): ParsedLog {
  const allLines = text.split(/\r?\n/)
  const meta = parseFileNameMeta(fileName)
  // Pull metadata out of comment (#) lines, as "key: value" / "key = value".
  for (const raw of allLines) {
    const line = raw.trim()
    if (!line.startsWith("#")) continue
    const body = line.replace(/^#+\s*/, "")
    const m = body.match(/^([^:=]+)[:=]\s*(.+)$/)
    if (m) meta.fields.push({ key: m[1].trim(), value: m[2].trim() })
    else if (body) meta.fields.push({ key: "", value: body })
  }

  const lines = allLines.filter((l) => l.trim() !== "" && !l.startsWith("#"))
  if (lines.length < 2) {
    throw new Error("CSV looks empty — need a header row and at least one data row.")
  }

  const headers = splitLine(lines[0]).map((h) => h.trim())
  const timeIdx = headers.findIndex((h) => TIME_RE.test(h))

  // Collect numeric columns.
  const cols: number[][] = headers.map(() => [])
  for (let i = 1; i < lines.length; i++) {
    const values = splitLine(lines[i])
    if (values.length !== headers.length) continue
    for (let j = 0; j < headers.length; j++) {
      const v = parseFloat(values[j])
      cols[j].push(Number.isFinite(v) ? v : NaN)
    }
  }

  const rowCount = cols[0]?.length ?? 0
  if (rowCount === 0) throw new Error("No parseable data rows found.")

  // Build the time axis (seconds, relative to the first sample).
  const indexed = timeIdx === -1
  let times: number[]
  if (indexed) {
    times = Array.from({ length: rowCount }, (_, i) => i)
  } else {
    const raw = cols[timeIdx]
    const first = raw.find((v) => Number.isFinite(v)) ?? 0
    times = raw.map((v) => (Number.isFinite(v) ? +(v - first).toFixed(4) : NaN))
  }
  const duration = times[times.length - 1] ?? rowCount

  // Which columns become signals: everything except the time column that has
  // enough numeric values to be a real channel.
  const signals: Signal[] = []
  let colorIdx = 0
  for (let j = 0; j < headers.length; j++) {
    if (j === timeIdx) continue
    const raw = cols[j]
    let numeric = 0
    for (const v of raw) if (Number.isFinite(v)) numeric++
    if (numeric < 2) continue // ignore text / mostly-empty columns

    const { label, unit } = splitHeader(headers[j])
    const decimals = inferDecimals(raw)

    let min = Infinity
    let max = -Infinity
    let sum = 0
    let count = 0
    const data: SignalSample[] = []
    for (let i = 0; i < rowCount; i++) {
      const value = raw[i]
      data.push({ t: times[i], value: Number.isFinite(value) ? value : (null as unknown as number) })
      if (Number.isFinite(value)) {
        if (value < min) min = value
        if (value > max) max = value
        sum += value
        count++
      }
    }

    signals.push({
      key: `col-${j}`,
      label,
      unit: unit || "—",
      color: (colorIdx % 5) + 1,
      decimals,
      data,
      min: count ? min : 0,
      max: count ? max : 0,
      avg: count ? sum / count : 0,
    })
    colorIdx++
  }

  if (signals.length === 0) {
    throw new Error("No numeric signal columns found in this CSV.")
  }

  return {
    fileName,
    sizeLabel: sizeLabel(byteSize),
    samples: rowCount,
    duration: duration > 0 ? duration : rowCount,
    indexed,
    signals,
    meta,
  }
}

/** Read a File object and parse it. */
export async function parseLogFile(file: File): Promise<ParsedLog> {
  const text = await file.text()
  return parseLog(text, file.name, file.size)
}
