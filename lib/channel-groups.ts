// Split a flat channel list (e.g. a template) into sensible separate graphs:
// AFR lines together, knock sensors together, wheel speeds together, etc.

export interface GraphGroup {
  id: string
  title: string
  labels: string[]
}

const FAMILIES: { id: string; title: string; match: RegExp[] }[] = [
  { id: "traction", title: "Traction / Torque split", match: [/slip/i, /traction/i, /\b4wd\b/i, /torque split/i] },
  { id: "engine", title: "Engine / Pedal", match: [/engine speed/i, /\brpm\b/i, /engine load/i, /torque/i, /accelerator/i, /pedal/i, /throttle/i] },
  { id: "speed", title: "Speed / Gear", match: [/speed/i, /\bgear\b/i] },
  { id: "boost", title: "Boost / Manifold", match: [/boost/i, /manifold/i, /\bmap\b/i, /wastegate/i, /\bwg\b/i, /atmospheric/i] },
  { id: "afr", title: "AFR / Lambda", match: [/\bafr\b/i, /lambda/i, /air.?fuel/i] },
  { id: "trims", title: "Fuel trims", match: [/trim/i] },
  { id: "fuel", title: "Fuel delivery", match: [/injector/i, /fuel/i, /rail/i, /ethanol/i, /flex/i, /duty/i] },
  { id: "timing", title: "Ignition timing", match: [/ignition/i, /timing/i, /advance/i, /spark/i, /knock.*corr/i] },
  { id: "knock", title: "Knock sensors", match: [/knock/i] },
  { id: "temps", title: "Temperatures", match: [/temp/i, /coolant/i, /\biat\b/i, /\begt\b/i] },
  { id: "electrical", title: "Electrical", match: [/volt/i, /batt/i] },
  { id: "cams", title: "Cams / VVT", match: [/cam/i, /vvt/i] },
  { id: "oil", title: "Oil", match: [/oil/i] },
]

const MAX_PER_GRAPH = 6

export function groupChannelsForGraphs(labels: string[]): GraphGroup[] {
  const buckets = new Map<string, string[]>()
  const other: string[] = []
  for (const label of labels) {
    const fam = FAMILIES.find((f) => f.match.some((re) => re.test(label)))
    if (!fam) {
      other.push(label)
      continue
    }
    const list = buckets.get(fam.id) ?? []
    list.push(label)
    buckets.set(fam.id, list)
  }

  const out: GraphGroup[] = []
  const push = (id: string, title: string, list: string[]) => {
    for (let i = 0; i < list.length; i += MAX_PER_GRAPH) {
      const part = Math.floor(i / MAX_PER_GRAPH)
      out.push({
        id: part ? `${id}-${part + 1}` : id,
        title: part ? `${title} (${part + 1})` : title,
        labels: list.slice(i, i + MAX_PER_GRAPH),
      })
    }
  }
  for (const fam of FAMILIES) {
    const list = buckets.get(fam.id)
    if (list?.length) push(fam.id, fam.title, list)
  }
  if (other.length) push("other", "Other", other)
  return out
}
