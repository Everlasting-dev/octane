// Templates: ONE shared list of named channel sets, used everywhere —
// Analysis Plot (template picker / phone Templates tab), the Channels view
// (each template is a preset, split into graphs), Compare and the Templates
// panel in the sidebar.
//
// Storage: in the Electron app these are written to a real file under the user
// data dir (templates/templates.json) via the preload bridge, so they survive
// restarts and can be backed up. In a plain browser they fall back to
// localStorage. Either way, export/import moves them as a JSON file.
//
// Channel entries are names, not regexes. An entry matches the log channel
// with exactly that label (case-insensitive); if no channel has that exact
// label, it matches every channel whose label contains all of the entry's
// words ("Wheel Speed" → Wheel Speed FL/FR/RL/RR). That keeps one template
// usable across slightly different EcuTek logs.

export interface TemplateGroup {
  id: string
  title: string
  channels: string[]
}

export interface Template {
  id: string
  name: string
  /** every channel entry in the template (union of the groups, in order) */
  channels: string[]
  /** optional graph layout for the Channels view; auto-split when missing */
  groups?: TemplateGroup[]
}

function templatesBridge() {
  if (typeof window === "undefined") return null
  return (
    (window as unknown as { octane?: { templates?: { load: () => Promise<string | null>; save: (j: string) => Promise<boolean> } } })
      .octane?.templates ?? null
  )
}

const KEY = "octane:templates"

let idCounter = 0
export function makeTemplateId(): string {
  idCounter += 1
  return "t-" + Date.now().toString(36) + "-" + idCounter.toString(36) + Math.floor(Math.random() * 1e4).toString(36)
}

export function makeGroupId(): string {
  idCounter += 1
  return "g-" + Date.now().toString(36) + "-" + idCounter.toString(36) + Math.floor(Math.random() * 1e4).toString(36)
}

function uniq(list: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of list) {
    const key = item.trim()
    if (!key || seen.has(key.toLowerCase())) continue
    seen.add(key.toLowerCase())
    out.push(key)
  }
  return out
}

/** Keep `channels` in sync with the graph layout (layout order first). */
export function withChannelsFromGroups(t: Template): Template {
  if (!t.groups?.length) return { ...t, channels: uniq(t.channels) }
  return { ...t, channels: uniq([...t.groups.flatMap((g) => g.channels), ...t.channels]) }
}

function normalizeArray(arr: unknown[]): Template[] {
  return arr
    .filter((t): t is { name: unknown; channels?: unknown; groups?: unknown; id?: unknown } => !!t && typeof t === "object")
    .filter((t) => typeof t.name === "string" && (Array.isArray(t.channels) || Array.isArray(t.groups)))
    .map((t) => {
      const groups = Array.isArray(t.groups)
        ? (t.groups as unknown[])
            .filter((g): g is { id?: unknown; title?: unknown; channels?: unknown; labels?: unknown } => !!g && typeof g === "object")
            .map((g) => ({
              id: typeof g.id === "string" && g.id ? g.id : makeGroupId(),
              title: typeof g.title === "string" && g.title.trim() ? g.title.trim() : "Graph",
              channels: ((Array.isArray(g.channels) ? g.channels : Array.isArray(g.labels) ? g.labels : []) as unknown[]).filter(
                (c): c is string => typeof c === "string" && c.trim().length > 0,
              ),
            }))
        : undefined
      return withChannelsFromGroups({
        id: typeof t.id === "string" ? t.id : makeTemplateId(),
        name: t.name as string,
        channels: Array.isArray(t.channels) ? (t.channels as unknown[]).filter((c): c is string => typeof c === "string") : [],
        groups: groups?.length ? groups : undefined,
      })
    })
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

// ---------------------------------------------------------------------------
// Built-in templates (EcuTek GT-R channel names). Each has its graph layout.

function builtin(id: string, name: string, groups: [string, string[]][]): Template {
  return withChannelsFromGroups({
    id: `builtin-${id}`,
    name,
    channels: [],
    groups: groups.map(([title, channels], i) => ({ id: `builtin-${id}-${i + 1}`, title, channels })),
  })
}

export const BUILTIN_TEMPLATES: Template[] = [
  builtin("general", "General", [
    ["Engine", ["Engine Speed", "Accelerator Pedal Sensor #1", "Engine Load", "Gear"]],
    ["Boost / Fuel", ["Manifold Gauge Pressure", "Boost Bank 1", "Fuel Pressure (relative)", "AFR B1"]],
    ["Ignition", ["Ignition Timing", "Knock Correction"]],
    ["Temperatures", ["Coolant Temperature", "Intake Air Temperature", "Vehicle Speed"]],
  ]),
  builtin("fuel", "Fuel", [
    ["AFR", ["AFR B1", "AFR B2", "AFR Target Final B1", "AFR Target Final B2"]],
    ["Fuel trims", ["Fuel Trim Short Term Bank #1", "Fuel Trim Short Term Bank #2", "Fuel Trim Combined"]],
    ["Delivery", ["Injector Duty B1", "Injector Effective PW", "Fuel Pressure (relative)", "Fuel Pressure Compensation"]],
    ["Ethanol / heat", ["FlexFuel Ethanol Content", "Fuel Temperature"]],
  ]),
  builtin("ignition", "Ignition", [
    ["Timing", ["Ignition Timing", "Knock Correction", "FlexFuel Ignition Advance", "Engine Speed"]],
    ["Knock sensors", ["Knock Sensor Cylinder 1", "Knock Sensor Cylinder 2", "Knock Sensor Cylinder 3", "Knock Sensor Cylinder 4", "Knock Sensor Cylinder 5", "Knock Sensor Cylinder 6"]],
    ["Load / air", ["Engine Load", "Manifold Gauge Pressure", "Intake Air Temperature"]],
  ]),
  builtin("vvti", "VVTi", [
    ["Cam angles", ["VVT Intake Angle Bank #1", "VVT Intake Angle Bank #2", "VVT Target"]],
    ["Engine", ["Engine Speed", "Engine Load", "Engine Oil Pressure", "Coolant Temperature"]],
  ]),
  builtin("speeds", "Speeds", [
    ["Vehicle / wheel speeds", ["Vehicle Speed", "Wheel Speed Front", "Wheel Speed Rear", "Wheel Speed FL", "Wheel Speed FR", "Wheel Speed RL", "Wheel Speed RR"]],
    ["Speed / RPM / gear", ["Vehicle Speed", "Engine Speed", "Gear", "Gear Desired"]],
    ["Traction", ["Wheel Slip Ratio", "4WD Torque Split", "TC Torque Reduction"]],
  ]),
  builtin("gr6", "GR6", [
    ["Clutch slip", ["Clutch Slip", "Engine Speed", "Gear"]],
    ["Shifts", ["Gear", "Gear Desired", "Gearshift Timer", "Engine Speed"]],
    ["Torque", ["Torque Actual", "Torque Demand", "Torque Limit TCM", "TQ Active Reduction"]],
    ["Drivetrain", ["4WD Torque Split", "Wheel Slip Ratio", "Vehicle Speed"]],
  ]),
  builtin("boost", "Boost", [
    ["Boost response", ["Boost Target", "Boost Bank 1", "Boost Bank 2", "RBC Maximum Desired Boost"]],
    ["Boost error", ["Boost Error", "Engine Speed", "Gear"]],
    ["Wastegate", ["Wastegate Duty", "WG Duty Base", "WG Duty Proportional", "WG Duty Integral"]],
    ["Throttle / air", ["Accelerator Pedal Sensor #1", "Throttle Angle Bank #1", "Manifold Absolute Pressure", "Atmospheric Pressure"]],
  ]),
  builtin("temps", "Temps", [
    ["Temperatures", ["Coolant Temperature", "Intake Air Temperature", "Fuel Temperature"]],
    ["Pressures", ["Engine Oil Pressure", "Coolant Pressure", "Engine Speed"]],
  ]),
  builtin("idle", "Idle", [
    ["Idle control", ["Engine Speed", "Throttle Angle Bank #1", "Accelerator Pedal Sensor #1", "Manifold Absolute Pressure"]],
    ["Mixture", ["AFR B1", "AFR B2", "Fuel Trim Short Term Bank #1", "Fuel Trim Short Term Bank #2"]],
    ["Heat / electrical", ["Ignition Timing", "Coolant Temperature", "Battery Voltage"]],
  ]),
  builtin("ethrottle", "E-throttle", [
    ["Pedal / throttle", ["Accelerator Pedal Sensor #1", "Throttle Angle Bank #1", "Throttle Angle Bank #2"]],
    ["Torque", ["Torque Demand", "Torque Actual", "TQ Active Reduction", "Engine Speed"]],
  ]),
  builtin("ethanol", "Ethanol", [
    ["Ethanol", ["FlexFuel Ethanol Content", "FlexFuel Ignition Advance", "Fuel Temperature"]],
    ["Fueling", ["AFR B1", "AFR Target Final B1", "Injector Duty B1", "Fuel Pressure (relative)"]],
  ]),
]

/** Kept for callers that only need "the default template list". */
export const DEFAULT_TEMPLATES = BUILTIN_TEMPLATES

export function isBuiltinTemplate(id: string): boolean {
  return id.startsWith("builtin-")
}

export function builtinById(id: string): Template | null {
  const t = BUILTIN_TEMPLATES.find((item) => item.id === id)
  return t ? cloneTemplate(t) : null
}

export function cloneTemplate(t: Template): Template {
  return {
    ...t,
    channels: [...t.channels],
    groups: t.groups?.map((g) => ({ ...g, channels: [...g.channels] })),
  }
}

// ---------------------------------------------------------------------------
// Seeding + migration (v2 merges the old Channels presets into templates).

const SEED_FLAG_V2 = "octane:templates-seeded:v2"
const OLD_PRESETS_KEY = "octane:channel-presets:v1"
const OLD_LAYOUTS_KEY = "octane:channel-preset-layouts:v1"

/** Custom presets the user built in the old Channels editor, as templates. */
function migrateOldChannelPresets(): Template[] {
  try {
    const presets = JSON.parse(window.localStorage.getItem(OLD_PRESETS_KEY) ?? "null")
    const layouts = JSON.parse(window.localStorage.getItem(OLD_LAYOUTS_KEY) ?? "null") ?? {}
    if (!Array.isArray(presets)) return []
    const out: Template[] = []
    for (const p of presets) {
      if (!p || typeof p.id !== "string" || !p.id.startsWith("custom-")) continue
      const rawGroups: unknown[] = Array.isArray(layouts?.[p.id]) ? layouts[p.id] : []
      const groups = rawGroups
        .filter((g): g is { title?: unknown; labels?: unknown } => !!g && typeof g === "object")
        .map((g) => ({
          id: makeGroupId(),
          title: typeof g.title === "string" && g.title.trim() ? g.title.trim() : "Graph",
          channels: Array.isArray(g.labels) ? g.labels.filter((l): l is string => typeof l === "string") : [],
        }))
        .filter((g) => g.channels.length)
      if (!groups.length) continue
      out.push(withChannelsFromGroups({ id: makeTemplateId(), name: typeof p.name === "string" ? p.name : "Custom", channels: [], groups }))
    }
    return out
  } catch {
    return []
  }
}

/**
 * One-time upgrade to the shared template list:
 * - the old seeded starters (General/Fuel/Ignition/Speed) are replaced by the
 *   built-ins (which now carry graph layouts),
 * - the user's own templates are kept,
 * - custom Channels presets become templates,
 * - a user template with the same name as a built-in wins over the built-in.
 */
export async function ensureSeedTemplates(existing: Template[]): Promise<Template[]> {
  if (typeof window === "undefined") return existing
  let seeded = false
  try {
    seeded = window.localStorage.getItem(SEED_FLAG_V2) === "1"
  } catch {
    /* ignore */
  }
  if (seeded) return existing
  // Keep everything except the old v1 starters; built-ins already on disk (e.g.
  // installed from the shared template pack) win over the code defaults.
  const own = existing.filter((t) => !t.id.startsWith("seed-"))
  const migrated = migrateOldChannelPresets()
  const names = new Set([...own, ...migrated].map((t) => t.name.trim().toLowerCase()))
  const ids = new Set(own.map((t) => t.id))
  const builtins = BUILTIN_TEMPLATES.filter((t) => !names.has(t.name.toLowerCase()) && !ids.has(t.id)).map(cloneTemplate)
  const migratedFresh = migrated.filter((t) => !own.some((o) => o.name.trim().toLowerCase() === t.name.trim().toLowerCase()))
  const list = [...builtins.filter((b) => !own.some((o) => o.id === b.id)), ...own, ...migratedFresh]
  await persistTemplates(list)
  try {
    window.localStorage.setItem(SEED_FLAG_V2, "1")
  } catch {
    /* ignore */
  }
  return list
}

export function serializeTemplates(list: Template[]): string {
  return JSON.stringify({ app: "octane", kind: "templates", version: 2, templates: list }, null, 2)
}

/** Parse an imported file; accepts a bare array or the wrapped export shape. */
export function parseImportedTemplates(json: string): Template[] {
  return fromJson(json)
}

// ---------------------------------------------------------------------------
// Matching template entries to a log's channels.

function words(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9#]+/).filter(Boolean)
}

/** Log labels an entry refers to (exact label first, else all-words match). */
export function resolveEntry(entry: string, labels: string[]): string[] {
  const e = entry.trim().toLowerCase()
  if (!e) return []
  const exact = labels.find((l) => l.toLowerCase() === e)
  if (exact) return [exact]
  const need = words(entry)
  if (!need.length) return []
  return labels.filter((l) => {
    const have = new Set(words(l))
    return need.every((w) => have.has(w))
  })
}

/** Every log label the template covers, in template order. */
export function resolveTemplateLabels(t: Template, labels: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const entry of t.channels) {
    for (const l of resolveEntry(entry, labels)) {
      if (seen.has(l)) continue
      seen.add(l)
      out.push(l)
    }
  }
  return out
}

/** Entries of the template that match nothing in this log. */
export function missingTemplateEntries(t: Template, labels: string[]): string[] {
  return t.channels.filter((entry) => resolveEntry(entry, labels).length === 0)
}
