// Saved Analysis Plot templates — named sets of channels (by label) the user
// wants to view together (e.g. "Fuel": AFR B1, AFR B2, Injector Duty, …).
//
// Storage: in the Electron app these are written to a real file under the user
// data dir (templates/templates.json) via the preload bridge, so they survive
// restarts and can be backed up. In a plain browser they fall back to
// localStorage. Either way, export/import moves them as a JSON file.

export interface Template {
  id: string
  name: string
  /** channel labels (matched across files so a template works on any log) */
  channels: string[]
}

function templatesBridge() {
  if (typeof window === "undefined") return null
  return (
    (window as unknown as { octane?: { templates?: { load: () => Promise<string | null>; save: (j: string) => Promise<boolean> } } })
      .octane?.templates ?? null
  )
}

const KEY = "octane:templates"

export function makeTemplateId(): string {
  return "t-" + Math.abs(Math.floor(performance.now() * 1000)).toString(36)
}

function normalizeArray(arr: unknown[]): Template[] {
  return arr
    .filter((t): t is { name: unknown; channels: unknown; id?: unknown } => !!t && typeof t === "object")
    .filter((t) => typeof t.name === "string" && Array.isArray(t.channels))
    .map((t) => ({
      id: typeof t.id === "string" ? t.id : makeTemplateId(),
      name: t.name as string,
      channels: (t.channels as unknown[]).filter((c): c is string => typeof c === "string"),
    }))
}

function fromJson(json: string | null): Template[] {
  if (!json) return []
  try {
    const data = JSON.parse(json)
    const arr: unknown[] = Array.isArray(data) ? data : Array.isArray(data?.templates) ? data.templates : []
    return normalizeArray(arr)
  } catch {
    return []
  }
}

export async function loadTemplates(): Promise<Template[]> {
  if (typeof window === "undefined") return []
  const b = templatesBridge()
  if (b) {
    try {
      return fromJson(await b.load())
    } catch {
      return []
    }
  }
  try {
    return fromJson(window.localStorage.getItem(KEY))
  } catch {
    return []
  }
}

export async function persistTemplates(list: Template[]): Promise<void> {
  if (typeof window === "undefined") return
  const json = JSON.stringify(list)
  const b = templatesBridge()
  if (b) {
    try {
      await b.save(json)
    } catch {
      /* ignore */
    }
    return
  }
  try {
    window.localStorage.setItem(KEY, json)
  } catch {
    /* ignore */
  }
}

const SEED_FLAG = "octane:templates-seeded"

// Starter templates seeded on first run. Channels are matched by label (unit
// stripped), so they apply to any compatible EcuTek log; missing channels are
// simply ignored.
export const DEFAULT_TEMPLATES: Omit<Template, "id">[] = [
  {
    name: "General",
    channels: [
      "Engine Speed", "Vehicle Speed", "Accelerator Pedal Sensor #1", "Manifold Gauge Pressure",
      "Boost Bank 1", "AFR B1", "Ignition Timing", "Coolant Temperature", "Gear",
    ],
  },
  {
    name: "Fuel",
    channels: [
      "AFR B1", "AFR B2", "AFR Target Final B1", "AFR Target Final B2",
      "Fuel Trim Short Term Bank #1", "Fuel Trim Short Term Bank #2", "Injector Duty B1",
      "Fuel Pressure (relative)", "FlexFuel Ethanol Content",
    ],
  },
  {
    name: "Ignition",
    channels: [
      "Ignition Timing", "Knock Correction", "Knock Sensor Cylinder 1", "Knock Sensor Cylinder 2",
      "Knock Sensor Cylinder 3", "Knock Sensor Cylinder 4", "Knock Sensor Cylinder 5",
      "Knock Sensor Cylinder 6", "Engine Speed", "Manifold Gauge Pressure",
    ],
  },
  {
    name: "Speed",
    channels: [
      "Vehicle Speed", "Wheel Speed FL", "Wheel Speed FR", "Wheel Speed RL", "Wheel Speed RR",
      "Wheel Slip Ratio", "Gear", "Accelerator Pedal Sensor #1", "4WD Torque Split",
    ],
  },
]

/**
 * First-run only: seed starter templates when the user has none and we've never
 * seeded before (so deleting them all doesn't bring them back). Returns the list
 * to display — the seeded set, or the existing templates unchanged.
 */
export async function ensureSeedTemplates(existing: Template[]): Promise<Template[]> {
  if (typeof window === "undefined") return existing
  let seeded = false
  try {
    seeded = window.localStorage.getItem(SEED_FLAG) === "1"
  } catch {
    /* ignore */
  }
  if (existing.length > 0 || seeded) return existing
  const list: Template[] = DEFAULT_TEMPLATES.map((t, i) => ({ id: `seed-${i}-${t.name.toLowerCase()}`, ...t }))
  await persistTemplates(list)
  try {
    window.localStorage.setItem(SEED_FLAG, "1")
  } catch {
    /* ignore */
  }
  return list
}

export function serializeTemplates(list: Template[]): string {
  return JSON.stringify({ app: "octane", kind: "templates", version: 1, templates: list }, null, 2)
}

/** Parse an imported file; accepts a bare array or the wrapped export shape. */
export function parseImportedTemplates(json: string): Template[] {
  return fromJson(json)
}
