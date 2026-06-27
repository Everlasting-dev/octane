// Event annotations (knock, shift, boost, …) pinned to a timestamp.
// Ported from modules/annotations.js. Persisted in localStorage, keyed per log
// file so notes follow the capture they were made on.

export type AnnotationType = "knock" | "shift" | "boost" | "afr" | "custom" | "event"

export interface Annotation {
  id: string
  t: number
  type: AnnotationType
  note: string
  /** signal label this note is attached to ("" = applies to all charts) */
  channel: string
}

export const ANNOTATION_TYPES: { value: AnnotationType; label: string }[] = [
  { value: "custom", label: "Custom" },
  { value: "knock", label: "Knock" },
  { value: "shift", label: "Shift Point" },
  { value: "boost", label: "Boost Spike" },
  { value: "afr", label: "AFR Event" },
  { value: "event", label: "General Event" },
]

export const ANNOTATION_COLORS: Record<AnnotationType, string> = {
  knock: "#ff3b30",
  shift: "#34a0ff",
  boost: "#00ff66",
  afr: "#ffaa2a",
  custom: "#a98bff",
  event: "#ff5aa2",
}

export function colorForType(type: AnnotationType): string {
  return ANNOTATION_COLORS[type] ?? ANNOTATION_COLORS.custom
}

const PREFIX = "octane:annotations:"

function keyFor(fileName: string): string {
  return PREFIX + fileName
}

export function loadAnnotations(fileName: string): Annotation[] {
  if (typeof window === "undefined") return []
  try {
    const raw = window.localStorage.getItem(keyFor(fileName))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveAnnotations(fileName: string, annotations: Annotation[]): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(keyFor(fileName), JSON.stringify(annotations))
  } catch {
    /* storage full / unavailable — ignore */
  }
}

export function makeId(): string {
  // Date.now()+counter would be ideal but we avoid time deps; use a random-ish id.
  return "a-" + Math.abs(Math.floor((performance.now() % 1) * 1e9 + performance.now())).toString(36)
}
