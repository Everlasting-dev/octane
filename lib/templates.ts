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

export function serializeTemplates(list: Template[]): string {
  return JSON.stringify({ app: "octane", kind: "templates", version: 1, templates: list }, null, 2)
}

/** Parse an imported file; accepts a bare array or the wrapped export shape. */
export function parseImportedTemplates(json: string): Template[] {
  return fromJson(json)
}
