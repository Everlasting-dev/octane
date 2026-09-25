"use client"

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react"
import {
  ChevronLeft,
  ChevronRight,
  Download,
  HelpCircle,
  Keyboard,
  LayoutList,
  LineChart,
  MousePointerClick,
  Plus,
  RefreshCw,
  ScanSearch,
  Search,
  SlidersHorizontal,
  Trash2,
  TriangleAlert,
  Upload,
  X,
} from "lucide-react"
import { type SignalKey } from "@/lib/telemetry"
import { parseLogFile, type ParsedLog } from "@/lib/csv"
import { SAMPLE_LOG } from "@/lib/sample"
import { calculateDiff, type DiffStats } from "@/lib/compare"
import { computeKpis } from "@/lib/kpis"
import {
  loadAnnotations,
  saveAnnotations,
  makeId,
  colorForType,
  type Annotation,
  type AnnotationType,
} from "@/lib/annotations"
import {
  loadTemplates,
  ensureSeedTemplates,
  persistTemplates,
  serializeTemplates,
  parseImportedTemplates,
  makeTemplateId,
  type Template,
} from "@/lib/templates"
import { useShortcuts, type Shortcut } from "@/hooks/use-shortcuts"
import { useBindings } from "@/lib/keybindings"
import { isMobileViewportNow, useMobileViewport } from "@/lib/viewport"
import { Rail, type ViewMode } from "./rail"
import { ControlPanel, type ChannelItem } from "./control-panel"
import { CombinedChart, type PaneGroup, type Transform } from "./combined-chart"
import { CompareView } from "./compare-view"
import { KpiCards } from "./kpi-cards"
import { RangeBrush, type OverviewSeries } from "./range-brush"
import { LoadedFiles } from "./loaded-files"
import { SignalChart, type ChartSeries } from "./signal-chart"
import { DEFAULT_DISPLAY, type DisplaySettings } from "./display-panel"
import { UploadZone } from "./upload-zone"
import { AboutModal } from "./about-modal"
import { SettingsModal } from "./settings-modal"
import { MetadataModal } from "./metadata-modal"
import { ShortcutsModal } from "./shortcuts-modal"
import { AnnotationDialog, type AnnotationDraft } from "./annotation-dialog"
import { LicenseBadge } from "./license-badge"
import { cn } from "@/lib/utils"
import { plotColor } from "@/lib/palette"
import { friendlyFileError } from "@/lib/friendly-errors"

const MIN_ZOOM = 100
const MAX_ZOOM = 800
const DEFAULT_VISIBLE = 6
const MOBILE_ANALYSIS_MAX_CHANNELS = 6
const FILE_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"]

interface ChannelPreset {
  id: string
  name: string
  patterns: { label: string; match: RegExp[] }[]
}

interface ChannelPresetConfig {
  id: string
  name: string
}

interface ChannelPresetGroup {
  id: string
  title: string
  labels: string[]
}

const CHANNEL_PRESETS: ChannelPreset[] = [
  {
    id: "general",
    name: "General tuning",
    patterns: [
      { label: "RPM", match: [/engine speed/i, /\brpm\b/i] },
      { label: "MAP", match: [/manifold.*absolute/i, /\bmap\b/i, /manifold.*pressure/i] },
      { label: "TPS", match: [/throttle.*angle/i, /\btps\b/i] },
      { label: "Lambda / AFR", match: [/lambda/i, /\bafr\b/i] },
      { label: "Coolant temp", match: [/coolant.*temp/i] },
      { label: "Fuel trim short", match: [/short.*fuel.*trim/i, /fuel.*trim.*short/i] },
      { label: "Fuel trim long", match: [/long.*fuel.*trim/i, /fuel.*trim.*long/i] },
      { label: "Fuel duty", match: [/fuel.*duty/i, /injector.*duty/i] },
      { label: "Fuel pressure", match: [/fuel.*pressure/i, /rail.*pressure/i] },
      { label: "Ignition angle", match: [/ignition.*tim/i, /ignition.*angle/i, /spark/i] },
      { label: "Battery voltage", match: [/battery.*voltage/i, /\bbatt/i] },
    ],
  },
  {
    id: "idle",
    name: "Idle",
    patterns: [
      { label: "RPM", match: [/engine speed/i, /\brpm\b/i] },
      { label: "MAP", match: [/manifold.*pressure/i, /\bmap\b/i] },
      { label: "Throttle", match: [/throttle.*angle/i, /\btps\b/i] },
      { label: "Accelerator", match: [/accelerator.*pedal/i] },
      { label: "Lambda / AFR", match: [/lambda/i, /\bafr\b/i] },
      { label: "Short trim", match: [/short.*fuel.*trim/i, /fuel.*trim.*short/i] },
      { label: "Long trim", match: [/long.*fuel.*trim/i, /fuel.*trim.*long/i] },
      { label: "Ignition timing", match: [/ignition.*tim/i, /spark/i] },
      { label: "Coolant temp", match: [/coolant.*temp/i] },
      { label: "IAT", match: [/intake.*air.*temp/i, /\biat\b/i] },
      { label: "Idle control", match: [/idle/i] },
      { label: "Battery voltage", match: [/battery.*voltage/i] },
    ],
  },
  {
    id: "boost",
    name: "Boost",
    patterns: [
      { label: "RPM", match: [/engine speed/i, /\brpm\b/i] },
      { label: "Gear", match: [/^gear$/i, /\bgear\b/i] },
      { label: "MAP", match: [/manifold.*absolute/i, /\bmap\b/i] },
      { label: "Boost target", match: [/boost.*target/i, /desired.*boost/i] },
      { label: "Boost bank 1", match: [/boost.*bank.*1/i] },
      { label: "Boost bank 2", match: [/boost.*bank.*2/i] },
      { label: "Boost error", match: [/boost.*error/i] },
      { label: "Wastegate duty", match: [/wastegate.*duty/i, /\bwg.*duty/i] },
      { label: "WG base", match: [/wg.*base/i, /wastegate.*base/i] },
      { label: "WG proportional", match: [/wg.*proportional/i, /wastegate.*proportional/i] },
      { label: "WG integral", match: [/wg.*integral/i, /wastegate.*integral/i] },
      { label: "Throttle", match: [/throttle.*angle/i] },
      { label: "Atmospheric pressure", match: [/atmospheric.*pressure/i] },
      { label: "IAT", match: [/intake.*air.*temp/i, /\biat\b/i] },
    ],
  },
  {
    id: "vvt",
    name: "VVT",
    patterns: [
      { label: "RPM", match: [/engine speed/i, /\brpm\b/i] },
      { label: "Engine load", match: [/engine.*load/i] },
      { label: "Intake cam", match: [/intake.*cam/i, /inlet.*cam/i] },
      { label: "Exhaust cam", match: [/exhaust.*cam/i] },
      { label: "VVT target", match: [/vvt.*target/i, /cam.*target/i] },
      { label: "VVT duty", match: [/vvt.*duty/i, /cam.*duty/i, /solenoid.*duty/i] },
      { label: "Oil pressure", match: [/oil.*pressure/i] },
      { label: "Oil temp", match: [/oil.*temp/i] },
      { label: "Coolant temp", match: [/coolant.*temp/i] },
    ],
  },
  {
    id: "ethrottle",
    name: "E-throttle",
    patterns: [
      { label: "Accelerator pedal", match: [/accelerator.*pedal/i] },
      { label: "Throttle bank 1", match: [/throttle.*bank.*1/i] },
      { label: "Throttle bank 2", match: [/throttle.*bank.*2/i] },
      { label: "Throttle target", match: [/throttle.*target/i, /desired.*throttle/i] },
      { label: "Throttle duty", match: [/throttle.*duty/i, /motor.*duty/i] },
      { label: "RPM", match: [/engine speed/i, /\brpm\b/i] },
      { label: "MAP", match: [/manifold.*pressure/i, /\bmap\b/i] },
      { label: "Torque", match: [/torque/i] },
    ],
  },
  {
    id: "temps",
    name: "Temps",
    patterns: [
      { label: "Coolant temp", match: [/coolant.*temp/i] },
      { label: "IAT", match: [/intake.*air.*temp/i, /\biat\b/i] },
      { label: "Oil temp", match: [/oil.*temp/i] },
      { label: "Transmission temp", match: [/trans.*temp/i, /transmission.*temp/i] },
      { label: "Fuel temp", match: [/fuel.*temp/i] },
      { label: "EGT", match: [/\begt\b/i, /exhaust.*temp/i] },
      { label: "Catalyst temp", match: [/catalyst.*temp/i, /cat.*temp/i] },
      { label: "Ambient temp", match: [/ambient.*temp/i, /atmospheric.*temp/i] },
    ],
  },
  {
    id: "wheel-speeds",
    name: "Wheel speeds",
    patterns: [
      { label: "Vehicle speed", match: [/vehicle.*speed/i] },
      { label: "Front left", match: [/wheel.*speed.*front.*left/i, /front.*left.*wheel/i] },
      { label: "Front right", match: [/wheel.*speed.*front.*right/i, /front.*right.*wheel/i] },
      { label: "Rear left", match: [/wheel.*speed.*rear.*left/i, /rear.*left.*wheel/i] },
      { label: "Rear right", match: [/wheel.*speed.*rear.*right/i, /rear.*right.*wheel/i] },
      { label: "Gear", match: [/\bgear\b/i] },
      { label: "Traction / slip", match: [/traction/i, /slip/i, /\babs\b/i] },
    ],
  },
  {
    id: "gr6",
    name: "GR6",
    patterns: [
      { label: "Gear", match: [/\bgear\b/i] },
      { label: "Transmission temp", match: [/trans.*temp/i, /gr6.*temp/i] },
      { label: "Clutch pressure", match: [/clutch.*pressure/i] },
      { label: "Clutch slip", match: [/clutch.*slip/i] },
      { label: "Clutch speed", match: [/clutch.*speed/i] },
      { label: "Input shaft", match: [/input.*shaft/i] },
      { label: "Output shaft", match: [/output.*shaft/i] },
      { label: "Line pressure", match: [/line.*pressure/i] },
      { label: "Shift status", match: [/shift.*status/i, /shift.*mode/i] },
      { label: "Solenoid", match: [/solenoid/i] },
      { label: "Torque reduction", match: [/torque.*reduction/i, /torque.*limit/i] },
    ],
  },
  {
    id: "clutch-speeds",
    name: "Clutch speeds",
    patterns: [
      { label: "RPM", match: [/engine speed/i, /\brpm\b/i] },
      { label: "Gear", match: [/\bgear\b/i] },
      { label: "Clutch A speed", match: [/clutch.*a.*speed/i, /clutch.*1.*speed/i] },
      { label: "Clutch B speed", match: [/clutch.*b.*speed/i, /clutch.*2.*speed/i] },
      { label: "Input shaft", match: [/input.*shaft.*speed/i] },
      { label: "Output shaft", match: [/output.*shaft.*speed/i] },
      { label: "Clutch slip", match: [/clutch.*slip/i] },
    ],
  },
  {
    id: "clutch-temps",
    name: "Clutch temps",
    patterns: [
      { label: "Clutch A temp", match: [/clutch.*a.*temp/i, /clutch.*1.*temp/i] },
      { label: "Clutch B temp", match: [/clutch.*b.*temp/i, /clutch.*2.*temp/i] },
      { label: "Transmission temp", match: [/trans.*temp/i] },
      { label: "Oil temp", match: [/oil.*temp/i] },
      { label: "Gear", match: [/\bgear\b/i] },
      { label: "Clutch slip", match: [/clutch.*slip/i] },
    ],
  },
  {
    id: "all-temps",
    name: "All temps",
    patterns: [
      { label: "Temperature channels", match: [/temp/i, /temperature/i, /coolant/i, /\biat\b/i, /\begt\b/i, /oil/i, /trans/i, /fuel.*temp/i, /ambient/i] },
    ],
  },
  {
    id: "ethanol",
    name: "Ethanol",
    patterns: [
      { label: "Ethanol content", match: [/ethanol/i, /flex.*fuel/i] },
      { label: "Fuel pressure", match: [/fuel.*pressure/i, /rail.*pressure/i] },
      { label: "Fuel temp", match: [/fuel.*temp/i] },
      { label: "Lambda / AFR", match: [/lambda/i, /\bafr\b/i] },
      { label: "AFR target", match: [/afr.*target/i, /target.*afr/i] },
      { label: "Fuel trim short", match: [/short.*fuel.*trim/i, /fuel.*trim.*short/i] },
      { label: "Fuel trim long", match: [/long.*fuel.*trim/i, /fuel.*trim.*long/i] },
      { label: "Injector duty", match: [/injector.*duty/i, /fuel.*duty/i] },
      { label: "Ignition timing", match: [/ignition.*tim/i, /spark/i] },
      { label: "Boost / MAP", match: [/boost/i, /manifold.*pressure/i, /\bmap\b/i] },
    ],
  },
]

const CHANNEL_PRESET_GROUPS: Record<string, ChannelPresetGroup[]> = {
  general: [
    { id: "engine-air", title: "Engine / Air", labels: ["RPM", "MAP", "TPS", "Coolant temp", "Battery voltage"] },
    {
      id: "fuel-ignition",
      title: "Fuel / Ignition",
      labels: ["Lambda / AFR", "Fuel trim short", "Fuel trim long", "Fuel duty", "Fuel pressure", "Ignition angle"],
    },
  ],
  idle: [
    { id: "idle-control", title: "Idle Control", labels: ["RPM", "MAP", "Throttle", "Accelerator", "Idle control", "Battery voltage"] },
    { id: "idle-fuel", title: "Fuel / Heat", labels: ["Lambda / AFR", "Short trim", "Long trim", "Ignition timing", "Coolant temp", "IAT"] },
  ],
  boost: [
    {
      id: "boost-response",
      title: "Boost Response",
      labels: ["RPM", "Gear", "MAP", "Boost target", "Boost bank 1", "Boost bank 2", "Boost error", "Atmospheric pressure"],
    },
    {
      id: "wastegate",
      title: "Wastegate / Airflow",
      labels: ["Wastegate duty", "WG base", "WG proportional", "WG integral", "Throttle", "IAT"],
    },
  ],
  vvt: [
    { id: "cam-control", title: "Cam Control", labels: ["RPM", "Engine load", "Intake cam", "Exhaust cam", "VVT target", "VVT duty"] },
    { id: "oil-support", title: "Oil / Heat", labels: ["Oil pressure", "Oil temp", "Coolant temp"] },
  ],
  ethrottle: [
    {
      id: "pedal-throttle",
      title: "Pedal / Throttle",
      labels: ["Accelerator pedal", "Throttle bank 1", "Throttle bank 2", "Throttle target", "Throttle duty"],
    },
    { id: "torque-load", title: "Torque / Load", labels: ["RPM", "MAP", "Torque"] },
  ],
  temps: [
    {
      id: "heat",
      title: "Temperature Stack",
      labels: ["Coolant temp", "IAT", "Oil temp", "Transmission temp", "Fuel temp", "EGT", "Catalyst temp", "Ambient temp"],
    },
  ],
  "wheel-speeds": [
    { id: "wheel-speed", title: "Wheel Speeds", labels: ["Vehicle speed", "Front left", "Front right", "Rear left", "Rear right"] },
    { id: "stability", title: "Stability", labels: ["Gear", "Traction / slip"] },
  ],
  gr6: [
    { id: "shift-state", title: "Shift State", labels: ["Gear", "Shift status", "Torque reduction"] },
    { id: "speed-slip", title: "Speed / Slip", labels: ["Clutch speed", "Input shaft", "Output shaft", "Clutch slip"] },
    { id: "pressure-heat", title: "Pressure / Heat", labels: ["Transmission temp", "Clutch pressure", "Line pressure", "Solenoid"] },
  ],
  "clutch-speeds": [
    { id: "clutch-speed", title: "Clutch Speeds", labels: ["RPM", "Gear", "Clutch A speed", "Clutch B speed", "Input shaft", "Output shaft", "Clutch slip"] },
  ],
  "clutch-temps": [
    { id: "clutch-heat", title: "Clutch Heat", labels: ["Clutch A temp", "Clutch B temp", "Transmission temp", "Oil temp", "Gear", "Clutch slip"] },
  ],
  "all-temps": [{ id: "all-temps", title: "All Temperatures", labels: ["Temperature channels"] }],
  ethanol: [
    {
      id: "fuel-ethanol",
      title: "Fuel / Ethanol",
      labels: ["Ethanol content", "Fuel pressure", "Fuel temp", "Fuel trim short", "Fuel trim long", "Injector duty"],
    },
    { id: "combustion", title: "Combustion", labels: ["Lambda / AFR", "AFR target", "Ignition timing", "Boost / MAP"] },
  ],
}

const CHANNEL_PRESETS_STORAGE_KEY = "octane:channel-presets:v1"
const CHANNEL_LAYOUTS_STORAGE_KEY = "octane:channel-preset-layouts:v1"
const READOUT_PICKING_STORAGE_KEY = "octane:readout-picking:v1"

function makeChannelPresetId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return `custom-${crypto.randomUUID()}`
  return `custom-${Date.now().toString(36)}-${Math.floor(Math.random() * 10000).toString(36)}`
}

function makePresetGroupId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID()
  return `preset-group-${Date.now().toString(36)}-${Math.floor(Math.random() * 10000).toString(36)}`
}

function cloneChannelPresets(configs: ChannelPresetConfig[] = CHANNEL_PRESETS.map(({ id, name }) => ({ id, name }))): ChannelPreset[] {
  const defaults = new Map(CHANNEL_PRESETS.map((preset) => [preset.id, preset]))
  return configs.map((config) => {
    const base = defaults.get(config.id)
    return {
      id: config.id,
      name: config.name,
      patterns: base?.patterns ?? [],
    }
  })
}

function serializeChannelPresets(presets: ChannelPreset[]): ChannelPresetConfig[] {
  return presets.map((preset) => ({ id: preset.id, name: preset.name }))
}

function normalizeChannelPresets(value: unknown): ChannelPreset[] | null {
  if (!Array.isArray(value)) return null
  const seen = new Set<string>()
  const configs: ChannelPresetConfig[] = []
  for (const item of value) {
    if (!item || typeof item !== "object") continue
    const raw = item as { id?: unknown; name?: unknown }
    const id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : makeChannelPresetId()
    if (seen.has(id)) continue
    seen.add(id)
    configs.push({
      id,
      name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : "Custom preset",
    })
  }
  return configs.length ? cloneChannelPresets(configs) : null
}

function loadStoredChannelPresets(): ChannelPreset[] | null {
  if (typeof window === "undefined") return null
  try {
    return normalizeChannelPresets(JSON.parse(window.localStorage.getItem(CHANNEL_PRESETS_STORAGE_KEY) ?? "null"))
  } catch {
    return null
  }
}

function saveStoredChannelPresets(presets: ChannelPreset[]) {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(CHANNEL_PRESETS_STORAGE_KEY, JSON.stringify(serializeChannelPresets(presets)))
  } catch {
    /* ignore storage failures */
  }
}

function serializeChannelWorkspace(presets: ChannelPreset[], groupsByPreset: Record<string, ChannelPresetGroup[]>): string {
  return JSON.stringify(
    {
      app: "octane",
      kind: "channels-layout",
      version: 1,
      presets: serializeChannelPresets(presets),
      groupsByPreset,
    },
    null,
    2,
  )
}

function parseImportedChannelWorkspace(json: string): { presets: ChannelPreset[]; groupsByPreset: Record<string, ChannelPresetGroup[]> } | null {
  try {
    const data = JSON.parse(json)
    const presets = normalizeChannelPresets(data?.presets ?? data?.channelPresets ?? data?.channelsPresets)
    const groupsByPreset = normalizePresetGroups(data?.groupsByPreset ?? data?.groups ?? data?.layouts)
    if (!presets?.length) return null
    return { presets, groupsByPreset: groupsByPreset ?? clonePresetGroups() }
  } catch {
    return null
  }
}

function clonePresetGroupList(groups: ChannelPresetGroup[]): ChannelPresetGroup[] {
  return groups.map((group) => ({ ...group, labels: [...group.labels] }))
}

function clonePresetGroups(groups: Record<string, ChannelPresetGroup[]> = CHANNEL_PRESET_GROUPS): Record<string, ChannelPresetGroup[]> {
  return Object.fromEntries(
    Object.entries(groups).map(([presetId, presetGroups]) => [
      presetId,
      clonePresetGroupList(presetGroups),
    ]),
  )
}

function fallbackPresetGroups(preset: ChannelPreset, groupsByPreset: Record<string, ChannelPresetGroup[]> = CHANNEL_PRESET_GROUPS): ChannelPresetGroup[] {
  const defaults = groupsByPreset[preset.id]
  if (defaults?.length) return clonePresetGroupList(defaults)
  if (preset.patterns.length) return [{ id: preset.id, title: preset.name, labels: preset.patterns.map((item) => item.label) }]
  return [{ id: makePresetGroupId(), title: "Graph 1", labels: [] }]
}

function normalizePresetGroups(value: unknown): Record<string, ChannelPresetGroup[]> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const next = clonePresetGroups()
  for (const [presetId, rawGroups] of Object.entries(value as Record<string, unknown>)) {
    if (!Array.isArray(rawGroups)) continue
    const groups = rawGroups
      .filter((item): item is { id?: unknown; title?: unknown; labels?: unknown } => !!item && typeof item === "object")
      .map((item) => ({
        id: typeof item.id === "string" && item.id ? item.id : makePresetGroupId(),
        title: typeof item.title === "string" && item.title.trim() ? item.title.trim() : "Graph",
        labels: Array.isArray(item.labels) ? item.labels.filter((label): label is string => typeof label === "string" && label.trim().length > 0) : [],
      }))
    if (groups.length > 0) next[presetId] = groups
  }
  return next
}

function loadStoredPresetGroups(): Record<string, ChannelPresetGroup[]> | null {
  if (typeof window === "undefined") return null
  try {
    return normalizePresetGroups(JSON.parse(window.localStorage.getItem(CHANNEL_LAYOUTS_STORAGE_KEY) ?? "null"))
  } catch {
    return null
  }
}

function saveStoredPresetGroups(groups: Record<string, ChannelPresetGroup[]>) {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(CHANNEL_LAYOUTS_STORAGE_KEY, JSON.stringify(groups))
  } catch {
    /* ignore storage failures */
  }
}

function loadReadoutPicking(): boolean {
  if (typeof window === "undefined") return true
  try {
    return window.localStorage.getItem(READOUT_PICKING_STORAGE_KEY) !== "false"
  } catch {
    return true
  }
}

function saveReadoutPicking(enabled: boolean) {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(READOUT_PICKING_STORAGE_KEY, enabled ? "true" : "false")
  } catch {
    /* ignore storage failures */
  }
}

const MOBILE_MATRIX_DEFAULT_CHANNELS: { label: string; match: RegExp[] }[] = [
  { label: "Accelerator pedal position", match: [/accelerator.*pedal/i, /\baccel.*pedal/i, /\bapp\b/i] },
  { label: "AFR 1", match: [/\bafr\s*(b|bank)?\s*1\b/i, /\bafr\s*b1\b/i, /air.*fuel.*(b|bank)?\s*1/i] },
  { label: "Battery voltage", match: [/battery.*voltage/i, /\bbatt/i] },
  { label: "Boost bank 1", match: [/boost.*bank.*1/i, /boost.*b1/i] },
  { label: "Coolant pressure", match: [/coolant.*pressure/i, /coolant.*temp/i] },
  { label: "Engine load", match: [/engine.*load/i] },
  { label: "Engine oil pressure", match: [/engine.*oil.*pressure/i, /oil.*pressure/i] },
  { label: "Engine speed", match: [/engine.*speed/i, /\brpm\b/i] },
  { label: "FlexFuel ethanol content", match: [/flex.*fuel.*ethanol/i, /ethanol.*content/i, /flex.*content/i] },
  { label: "Fuel pressure", match: [/fuel.*pressure(?!.*comp)/i, /rail.*pressure/i] },
  { label: "Fuel pressure compensation", match: [/fuel.*pressure.*comp/i, /pressure.*comp/i] },
  { label: "Fuel trim short term", match: [/short.*fuel.*trim/i, /fuel.*trim.*short/i, /\bstft\b/i] },
  { label: "Gear", match: [/^gear$/i, /\bgear\b/i] },
  { label: "Ignition timing", match: [/ignition.*tim/i, /ignition.*angle/i, /spark/i] },
  { label: "Injector duty B1", match: [/injector.*duty.*(b|bank)?\s*1/i, /fuel.*duty.*(b|bank)?\s*1/i, /injector.*duty/i] },
  { label: "Knock correction", match: [/knock.*correction/i, /knock.*corr/i] },
  { label: "Intake air temp", match: [/intake.*air.*temp/i, /\biat\b/i] },
  { label: "MAP", match: [/manifold.*absolute.*pressure/i, /^map\b/i, /\bmap\b.*pressure/i] },
  { label: "Torque actual", match: [/torque.*actual/i, /actual.*torque/i] },
  { label: "TQ active reduction", match: [/\btq\b.*active.*reduction/i, /torque.*active.*reduction/i, /active.*torque.*reduction/i] },
  { label: "Vehicle speed", match: [/vehicle.*speed/i, /^speed$/i] },
  { label: "VVTi B1", match: [/vvti?.*(b|bank)?\s*1/i, /vvt.*(b|bank)?\s*1/i, /cam.*(b|bank)?\s*1/i] },
  { label: "Wastegate duty", match: [/wastegate.*duty/i, /\bwg.*duty/i] },
  { label: "Wheel slip", match: [/wheel.*slip/i, /\bslip\b/i] },
  { label: "Wheel speed FR", match: [/wheel.*speed.*fr/i, /wheel.*speed.*front.*right/i, /front.*right.*wheel/i] },
  { label: "Wheel speed rear", match: [/wheel.*speed.*rear/i, /rear.*wheel/i] },
]

function setsEqual<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false
  for (const item of a) if (!b.has(item)) return false
  return true
}

function preferredMobileSignals(log: ParsedLog): ParsedLog["signals"] {
  const selected: ParsedLog["signals"] = []
  const seen = new Set<string>()
  for (const item of MOBILE_MATRIX_DEFAULT_CHANNELS) {
    for (const signal of log.signals) {
      if (seen.has(signal.key)) continue
      if (!item.match.some((pattern) => pattern.test(signal.label))) continue
      selected.push(signal)
      seen.add(signal.key)
    }
  }
  return selected
}

function defaultMobileAnalysisLabels(log: ParsedLog): Set<string> {
  const preferred = preferredMobileSignals(log)
  const labels = new Set<string>()
  for (const signal of preferred) {
    if (labels.size >= MOBILE_ANALYSIS_MAX_CHANNELS) break
    labels.add(signal.label)
  }
  if (labels.size < MOBILE_ANALYSIS_MAX_CHANNELS) {
    for (const signal of log.signals) {
      if (labels.size >= MOBILE_ANALYSIS_MAX_CHANNELS) break
      labels.add(signal.label)
    }
  }
  return labels
}

function defaultHidden(log: ParsedLog, mobile = false): Set<string> {
  if (mobile) {
    const preferred = preferredMobileSignals(log)
    const visible = preferred.length ? new Set(preferred.map((signal) => signal.key)) : new Set(log.signals.slice(0, DEFAULT_VISIBLE).map((signal) => signal.key))
    return new Set(log.signals.filter((signal) => !visible.has(signal.key)).map((signal) => signal.key))
  }
  return new Set(log.signals.slice(DEFAULT_VISIBLE).map((s) => s.key))
}

function fmtChannelValue(value: number | null | undefined, decimals: number) {
  if (value == null || !Number.isFinite(value)) return "--"
  return value.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

function sampleChannelValue(data: ChartSeries["signal"]["data"], t: number | null): number | null {
  if (t == null || data.length === 0) return null
  if (t <= data[0].t) return data[0].value
  const last = data[data.length - 1]
  if (t >= last.t) return last.value

  let lo = 0
  let hi = data.length - 1
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2)
    const mt = data[mid].t
    if (mt === t) return data[mid].value
    if (mt < t) lo = mid + 1
    else hi = mid - 1
  }

  const left = data[Math.max(0, hi)]
  const right = data[Math.min(data.length - 1, lo)]
  if (left.value == null || right.value == null || right.t === left.t) {
    return Math.abs((left?.t ?? 0) - t) <= Math.abs((right?.t ?? 0) - t) ? left?.value ?? null : right?.value ?? null
  }
  const ratio = (t - left.t) / (right.t - left.t)
  return left.value + (right.value - left.value) * ratio
}

// Open a file dialog with a FRESH input each time. Reusing one hidden <input>
// and calling .click() programmatically intermittently no-ops in Chromium, which
// caused "importing a second file does nothing". A throwaway element avoids it.
function openCsvDialog(onPick: (file: File) => void) {
  const input = document.createElement("input")
  input.type = "file"
  input.accept = ".csv,.txt,text/csv,text/plain"
  // Must be in the DOM for .click() to reliably open the dialog in Electron.
  input.style.position = "fixed"
  input.style.left = "-9999px"
  document.body.appendChild(input)
  const cleanup = () => {
    try {
      document.body.removeChild(input)
    } catch {
      /* already gone */
    }
  }
  input.addEventListener(
    "change",
    () => {
      const f = input.files?.[0]
      if (f) onPick(f)
      cleanup()
    },
    { once: true },
  )
  // Leak guard only — removing the input too early (e.g. on a focus race) was
  // cancelling the dialog and causing random "upload failed". 5 min is safe.
  setTimeout(cleanup, 5 * 60 * 1000)
  input.click()
}

interface Session {
  hidden: Set<string>
  domain: [number, number]
  zoom: number
  collapsed: Set<string>
  cursorT: number | null
  mobileAnalysisLabels?: Set<string>
}

interface Channel {
  key: string
  label: string
  unit: string
  decimals: number
  series: ChartSeries[]
  diffStats: DiffStats | null
}

export interface DashboardHandle {
  loadParsedLog: (log: ParsedLog) => void
}

export const Dashboard = forwardRef<DashboardHandle, { initialLog?: ParsedLog | null; onHome?: () => void; accountEmail?: string | null }>(
  function Dashboard({ initialLog = null, onHome, accountEmail = null }, ref) {
  const [logs, setLogs] = useState<ParsedLog[]>(initialLog ? [initialLog] : [])
  const [activeIndex, setActiveIndex] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [sync, setSync] = useState(true)
  const [view, setView] = useState<ViewMode>("matrix")
  const mobileViewport = useMobileViewport()
  const [activePresetId, setActivePresetId] = useState(CHANNEL_PRESETS[0].id)
  const [channelPresets, setChannelPresets] = useState<ChannelPreset[]>(() => cloneChannelPresets())
  const [channelsPaneOpen, setChannelsPaneOpen] = useState(true)
  const [channelsPaneQuery, setChannelsPaneQuery] = useState("")
  const [channelsHelpOpen, setChannelsHelpOpen] = useState(false)
  const [channelsEditOpen, setChannelsEditOpen] = useState(false)
  const [channelPresetGroups, setChannelPresetGroups] = useState<Record<string, ChannelPresetGroup[]>>(() => clonePresetGroups())
  const [readoutPicking, setReadoutPicking] = useState(loadReadoutPicking)
  const defaultChannelPresets = useMemo(() => cloneChannelPresets(), [])
  const defaultChannelGroups = useMemo(() => clonePresetGroups(), [])
  const [annotate, setAnnotate] = useState(false)
  const [zoom, setZoom] = useState(100)
  const [domain, setDomain] = useState<[number, number]>(initialLog ? [0, initialLog.duration] : [0, 0])
  const [cursorT, setCursorT] = useState<number | null>(null)
  const [query, setQuery] = useState("")
  const [collapsed, setCollapsed] = useState<Set<SignalKey>>(new Set())
  const [hidden, setHidden] = useState<Set<SignalKey>>(initialLog ? defaultHidden(initialLog, isMobileViewportNow()) : new Set())
  const [mobileAnalysisLabels, setMobileAnalysisLabels] = useState<Set<string>>(() => (initialLog ? defaultMobileAnalysisLabels(initialLog) : new Set()))
  const [display, setDisplay] = useState<DisplaySettings>(DEFAULT_DISPLAY)

  // Per-file working state, so switching logs resumes where you left off.
  const sessionsRef = useRef<Map<string, Session>>(new Map())
  const [templates, setTemplates] = useState<Template[]>([])
  useEffect(() => {
    loadTemplates().then(ensureSeedTemplates).then(setTemplates)
  }, [])
  useEffect(() => {
    const storedPresets = loadStoredChannelPresets()
    if (storedPresets) setChannelPresets(storedPresets)
    const stored = loadStoredPresetGroups()
    if (stored) setChannelPresetGroups(stored)
  }, [])
  useEffect(() => {
    if (!channelPresets.length) return
    if (!channelPresets.some((preset) => preset.id === activePresetId)) setActivePresetId(channelPresets[0].id)
  }, [activePresetId, channelPresets])
  useEffect(() => {
    if (mobileViewport && view !== "matrix" && view !== "plot") setView("plot")
  }, [mobileViewport, view])
  useEffect(() => {
    saveReadoutPicking(readoutPicking)
  }, [readoutPicking])

  // Analysis Plot state (persisted across view switches).
  const [analysisTransforms, setAnalysisTransforms] = useState<Record<string, Transform>>({})
  const [analysisFocus, setAnalysisFocus] = useState<string | null>(null)
  const [analysisMarkPeaks, setAnalysisMarkPeaks] = useState(false)
  const [analysisSplit, setAnalysisSplit] = useState(false)
  const [analysisPlotAssign, setAnalysisPlotAssign] = useState<Record<string, 0 | 1>>({})

  // Compare workspace state.
  const [compareAreas, setCompareAreas] = useState<string[][]>([[], [], []])
  const [fileOffsets, setFileOffsets] = useState<Record<string, number>>({})
  const [activeCompareFile, setActiveCompareFile] = useState<string | null>(null)
  const [compareLocked, setCompareLocked] = useState(false)

  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [annotationDraft, setAnnotationDraft] = useState<AnnotationDraft | null>(null)
  const [showAbout, setShowAbout] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showMetadata, setShowMetadata] = useState(false)
  const [quickOpen, setQuickOpen] = useState(false)
  const [mobileControlsOpen, setMobileControlsOpen] = useState(false)
  const [mobileWindowOpen, setMobileWindowOpen] = useState(false)
  const [desktopControlsOpen, setDesktopControlsOpen] = useState(true)
  const [matrixQuery, setMatrixQuery] = useState("")
  const [highlightChannel, setHighlightChannel] = useState<SignalKey | null>(null)
  const quickRef = useRef<HTMLInputElement>(null)

  const searchRef = useRef<HTMLInputElement>(null)
  const mainRef = useRef<HTMLDivElement>(null)
  const viewWindowsRef = useRef<Partial<Record<ViewMode, { domain: [number, number]; zoom: number }>>>({})
  const bindings = useBindings()

  const hasLogs = logs.length > 0
  const canCompare = logs.length > 1
  const comparing = view === "compare" && canCompare
  const activeLog = logs[activeIndex] ?? logs[0]
  const timeUnit = activeLog?.indexed ? "" : "s"

  useEffect(() => {
    if (!mobileViewport || !activeLog) return
    const desktopDefault = defaultHidden(activeLog, false)
    setHidden((current) => (setsEqual(current, desktopDefault) ? defaultHidden(activeLog, true) : current))
  }, [activeLog, mobileViewport])

  useEffect(() => {
    if (!hasLogs || view !== "matrix") setMobileWindowOpen(false)
  }, [hasLogs, view])

  const duration = useMemo(() => {
    if (!logs.length) return 0
    if (comparing) return Math.max(...logs.map((l) => l.duration))
    return (logs[activeIndex] ?? logs[0]).duration
  }, [logs, comparing, activeIndex])

  const channels = useMemo<Channel[]>(() => {
    if (!logs.length) return []
    if (!comparing) {
      const log = logs[activeIndex] ?? logs[0]
      return log.signals
        .map((sig) => ({
          key: sig.key,
          label: sig.label,
          unit: sig.unit,
          decimals: sig.decimals,
          series: [
            { id: `${activeIndex}-${sig.key}`, name: log.fileName, color: `var(--chart-${sig.color})`, signal: sig },
          ],
          diffStats: null,
        }))
        .sort((a, b) => a.label.localeCompare(b.label)) // alphabetical (matches Compare view)
    }
    const labelMaps = logs.map((l) => new Map(l.signals.map((s) => [s.label, s])))
    const common = [...labelMaps[0].keys()].filter((lab) => labelMaps.every((m) => m.has(lab)))
    return common.map((lab) => {
      const series: ChartSeries[] = logs.map((l, li) => ({
        id: `${li}-${lab}`,
        name: l.fileName,
        color: FILE_COLORS[li % FILE_COLORS.length],
        signal: labelMaps[li].get(lab)!,
      }))
      const diff = calculateDiff(series[0].signal.data, series[1].signal.data)
      const base = labelMaps[0].get(lab)!
      return { key: `cmp-${lab}`, label: lab, unit: base.unit, decimals: base.decimals, series, diffStats: diff?.stats ?? null }
    })
  }, [logs, comparing, activeIndex])

  useEffect(() => {
    if (!activeLog || channels.length === 0) return
    const availableLabels = new Set(channels.map((channel) => channel.label))
    setMobileAnalysisLabels((current) => {
      const kept = [...current].filter((label) => availableLabels.has(label)).slice(0, MOBILE_ANALYSIS_MAX_CHANNELS)
      if (kept.length > 0 && kept.length === current.size) return current
      if (kept.length > 0) return new Set(kept)
      return defaultMobileAnalysisLabels(activeLog)
    })
  }, [activeLog, channels])

  const channelItems: ChannelItem[] = useMemo(
    () => channels.map((c) => ({ key: c.key, label: c.label, unit: c.unit, color: c.series[0].color })),
    [channels],
  )
  const activePreset = channelPresets.find((preset) => preset.id === activePresetId) ?? channelPresets[0] ?? CHANNEL_PRESETS[0]
  const presetMatch = useMemo(() => {
    const selected: Channel[] = []
    const missing: string[] = []
    const seen = new Set<string>()
    const byPatternLabel = new Map<string, Channel[]>()
    const directByLabel = new Map(channels.map((channel) => [channel.label, channel]))

    for (const item of activePreset.patterns) {
      const matches = channels.filter((channel) => item.match.some((pattern) => pattern.test(channel.label)))
      if (!matches.length) {
        missing.push(item.label)
        byPatternLabel.set(item.label, [])
        continue
      }
      byPatternLabel.set(item.label, matches)
    }

    function matchesForLayoutLabel(label: string): Channel[] {
      const patternMatches = byPatternLabel.get(label)
      if (patternMatches?.length) return patternMatches
      const direct = directByLabel.get(label)
      return direct ? [direct] : []
    }

    const groups: PaneGroup[] = (channelPresetGroups[activePreset.id] ?? [
      { id: activePreset.id, title: activePreset.name, labels: activePreset.patterns.map((item) => item.label) },
    ])
      .map((group) => {
        const groupSeen = new Set<string>()
        const series: ChartSeries[] = []
        for (const label of group.labels) {
          for (const channel of matchesForLayoutLabel(label)) {
            if (groupSeen.has(channel.key)) continue
            groupSeen.add(channel.key)
            if (!seen.has(channel.key)) {
              seen.add(channel.key)
              selected.push(channel)
            }
            series.push(channel.series[0])
          }
        }
        return { id: `${activePreset.id}-${group.id}`, title: group.title, series }
      })
      .filter((group) => group.series.length > 0)

    return { channels: selected, missing, groups }
  }, [activePreset, channelPresetGroups, channels])

  function saveChannelWorkspace(presets: ChannelPreset[], groups: Record<string, ChannelPresetGroup[]>) {
    const nextPresets = presets.length ? presets : cloneChannelPresets()
    setChannelPresets(nextPresets)
    setChannelPresetGroups(groups)
    saveStoredChannelPresets(nextPresets)
    saveStoredPresetGroups(groups)
    const nextActive = nextPresets.some((preset) => preset.id === activePresetId) ? activePresetId : nextPresets[0].id
    setActivePresetId(nextActive)
  }

  function saveTemplateFromLabels(name: string, labels: string[]) {
    const uniqueLabels = [...new Set(labels.filter(Boolean))]
    if (!name.trim() || uniqueLabels.length === 0) return
    const next = [...templates, { id: makeTemplateId(), name: name.trim(), channels: uniqueLabels }]
    setTemplates(next)
    persistTemplates(next)
  }

  // Load annotations whenever the active log changes.
  useEffect(() => {
    if (activeLog) setAnnotations(loadAnnotations(activeLog.fileName))
    else setAnnotations([])
  }, [activeLog])

  function scrollMainToTop(behavior: ScrollBehavior = "auto") {
    if (typeof window === "undefined") return
    requestAnimationFrame(() => {
      mainRef.current?.scrollTo({ top: 0, behavior })
    })
  }

  function resetView(dur: number) {
    setZoom(100)
    setDomain([0, dur])
    setCursorT(null)
  }

  function saveSession() {
    if (!activeLog) return
    sessionsRef.current.set(activeLog.fileName, { hidden, domain, zoom, collapsed, cursorT, mobileAnalysisLabels })
  }

  function applyDefaults(log: ParsedLog) {
    setHidden(defaultHidden(log, mobileViewport || isMobileViewportNow()))
    setMobileAnalysisLabels(defaultMobileAnalysisLabels(log))
    setCollapsed(new Set())
    viewWindowsRef.current = {} // per-view windows don't carry across files
    resetView(log.duration)
    scrollMainToTop()
  }

  async function loadFile(file: File) {
    setLoading(true)
    setError(null)
    try {
      const parsed = await parseLogFile(file)
      saveSession()
      const next = [...logs, parsed]
      setLogs(next)
      setActiveIndex(next.length - 1)
      setQuery("")
      applyDefaults(parsed)
    } catch (e) {
      const friendly = friendlyFileError(e, file.name)
      setError(`${friendly.title}: ${friendly.message}`)
    } finally {
      setLoading(false)
    }
  }

  // Load an already-parsed log (e.g. opened from the landing page) into the session.
  function loadParsedLog(parsed: ParsedLog) {
    setError(null)
    saveSession()
    const next = [...logs, parsed]
    setLogs(next)
    setActiveIndex(next.length - 1)
    setQuery("")
    applyDefaults(parsed)
  }
  useImperativeHandle(ref, () => ({ loadParsedLog }))

  function loadSample() {
    setLogs([SAMPLE_LOG])
    setActiveIndex(0)
    setError(null)
    setQuery("")
    applyDefaults(SAMPLE_LOG)
  }

  function selectLog(i: number) {
    if (i < 0 || i >= logs.length) return
    if (i === activeIndex) return
    saveSession()
    viewWindowsRef.current = {} // reset per-view windows for the newly active file
    const target = logs[i]
    setActiveIndex(i)
    const s = sessionsRef.current.get(target.fileName)
    if (s) {
      // Resume where the user left off on this file.
      setHidden(s.hidden)
      setDomain(s.domain)
      setZoom(s.zoom)
      setCollapsed(s.collapsed)
      setCursorT(s.cursorT)
      setMobileAnalysisLabels(s.mobileAnalysisLabels ?? defaultMobileAnalysisLabels(target))
    } else {
      applyDefaults(target)
    }
  }

  function switchLoadedLog(delta: -1 | 1) {
    if (logs.length < 2) return
    if (comparing) {
      const cap = Math.min(logs.length, 3)
      const current = logs.findIndex((l) => l.fileName === activeCompareFile)
      const index = current >= 0 && current < cap ? current : 0
      setActiveCompareFile(logs[(index + delta + cap) % cap]?.fileName ?? logs[0].fileName)
      return
    }
    selectLog((activeIndex + delta + logs.length) % logs.length)
  }

  function removeLog(i: number) {
    sessionsRef.current.delete(logs[i].fileName)
    const next = logs.filter((_, idx) => idx !== i)
    setLogs(next)
    if (next.length === 0) {
      setActiveIndex(0)
      setView("matrix")
      setAnnotate(false)
      return
    }
    // Drop out of compare if only one log remains.
    const nextView = view === "compare" && next.length < 2 ? "matrix" : view
    setView(nextView)
    const ni = Math.min(activeIndex, next.length - 1)
    setActiveIndex(ni)
    const target = next[ni]
    const s = sessionsRef.current.get(target.fileName)
    if (s && nextView !== "compare") {
      setHidden(s.hidden)
      setDomain(s.domain)
      setZoom(s.zoom)
      setCollapsed(s.collapsed)
      setCursorT(s.cursorT)
      setMobileAnalysisLabels(s.mobileAnalysisLabels ?? defaultMobileAnalysisLabels(target))
    } else {
      const dur = nextView === "compare" && next.length > 1 ? Math.max(...next.map((l) => l.duration)) : target.duration
      setHidden(defaultHidden(target, mobileViewport || isMobileViewportNow()))
      setMobileAnalysisLabels(defaultMobileAnalysisLabels(target))
      setCollapsed(new Set())
      resetView(dur)
    }
  }

  function changeView(next: ViewMode) {
    if (mobileViewport && next !== "matrix" && next !== "plot") return
    if (next === "compare" && !canCompare) return
    // Remember the window of the view we're leaving.
    viewWindowsRef.current[view] = { domain, zoom }
    setView(next)
    if (next === "compare") {
      setActiveCompareFile(logs[0]?.fileName ?? null)
      // Seed the first plot area with channels common to all files (once).
      if (compareAreas.every((a) => a.length === 0)) {
        const maps = logs.slice(0, 3).map((l) => new Set(l.signals.map((s) => s.label)))
        const common = [...maps[0]].filter((lab) => maps.every((m) => m.has(lab))).slice(0, 3)
        if (common.length) setCompareAreas([common, [], []])
      }
    }
    const dur =
      next === "compare" && logs.length > 1
        ? Math.max(...logs.map((l) => l.duration))
        : (logs[activeIndex] ?? logs[0])?.duration ?? 0
    // Restore that view's remembered window if still valid, else fit to full range.
    const saved = viewWindowsRef.current[next]
    if (saved && saved.domain[1] <= dur + 0.01 && saved.domain[0] >= 0) {
      setZoom(saved.zoom)
      setDomain(saved.domain)
      setCursorT(null)
    } else {
      resetView(dur)
    }
    if (mobileViewport || isMobileViewportNow()) scrollMainToTop()
  }

  function setAreaChannels(areaIdx: number, channels: string[]) {
    setCompareAreas((prev) => prev.map((a, i) => (i === areaIdx ? channels : a)))
  }
  // Distribute a template's channels across all 3 plot areas (1-3, 4-6, 7-9).
  function applyTemplateToCompare(t: Template) {
    const c = t.channels
    setCompareAreas([c.slice(0, 3), c.slice(3, 6), c.slice(6, 9)])
  }
  function setFileOffset(name: string, offset: number) {
    setFileOffsets((prev) => ({ ...prev, [name]: offset }))
  }

  function applyZoom(next: number) {
    if (duration <= 0) return
    const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next))
    setZoom(clamped)
    const width = duration / (clamped / 100)
    const center = (domain[0] + domain[1]) / 2
    let start = center - width / 2
    let end = center + width / 2
    if (start < 0) {
      end -= start
      start = 0
    }
    if (end > duration) {
      start -= end - duration
      end = duration
    }
    setDomain([Math.max(0, +start.toFixed(2)), Math.min(duration, +end.toFixed(2))])
  }

  function setWindow(start: number, end: number) {
    const s = Math.max(0, +start.toFixed(2))
    const e = Math.min(duration, +end.toFixed(2))
    if (e <= s) return
    setDomain([s, e])
    setZoom(Math.round((duration / (e - s)) * 100))
  }

  const toggleChannel = useCallback((key: string) => {
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const toggleChannelByLabel = useCallback(
    (label: string) => {
      const target = channels.find((channel) => channel.label === label)
      if (target && mobileViewport && view === "plot" && hidden.has(target.key) && channels.length - hidden.size >= MOBILE_ANALYSIS_MAX_CHANNELS) return
      if (target) toggleChannel(target.key)
    },
    [channels, hidden, mobileViewport, toggleChannel, view],
  )

  const toggleMobileAnalysisLabel = useCallback((label: string) => {
    setMobileAnalysisLabels((current) => {
      const next = new Set(current)
      if (next.has(label)) {
        next.delete(label)
        return next
      }
      if (next.size >= MOBILE_ANALYSIS_MAX_CHANNELS) return current
      next.add(label)
      return next
    })
  }, [])

  // Stable callbacks so memoized charts don't re-render while searching.
  const toggleCollapse = useCallback((key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const openAnnotation = useCallback((t: number, channel: string) => setAnnotationDraft({ t, channel }), [])

  const scrollToChannel = useCallback((key: string) => {
    // Ensure the channel is visible, then scroll its plot into view.
    setHidden((prev) => {
      if (!prev.has(key)) return prev
      const next = new Set(prev)
      next.delete(key)
      return next
    })
    setTimeout(() => {
      document.getElementById(`chart-${key}`)?.scrollIntoView({ behavior: "smooth", block: "start" })
    }, 60)
  }, [])

  function saveAnnotation(type: AnnotationType, note: string) {
    if (!annotationDraft || !activeLog) return
    const next = [
      ...annotations,
      { id: makeId(), t: annotationDraft.t, type, note, channel: annotationDraft.channel },
    ].sort((a, b) => a.t - b.t)
    setAnnotations(next)
    saveAnnotations(activeLog.fileName, next)
    setAnnotationDraft(null)
    setAnnotate(false) // return to snap/drag after placing a mark
  }

  // Pan the window to an annotation's time, keeping the current window width.
  function jumpToTime(t: number) {
    const width = domain[1] - domain[0]
    let start = t - width / 2
    if (start < 0) start = 0
    if (start + width > duration) start = Math.max(0, duration - width)
    setDomain([+start.toFixed(2), +(start + width).toFixed(2)])
    setCursorT(t)
  }

  function removeAnnotation(id: string) {
    if (!activeLog) return
    const next = annotations.filter((a) => a.id !== id)
    setAnnotations(next)
    saveAnnotations(activeLog.fileName, next)
  }

  function exportCsv() {
    if (!activeLog) return
    const visible = channels.filter((c) => !hidden.has(c.key))
    if (!visible.length) return
    const base = visible[0].series[0].signal.data
    const header = ["Time" + (timeUnit ? ` (${timeUnit})` : ""), ...visible.map((c) => c.label)]
    const lines = [header.join(",")]
    for (let i = 0; i < base.length; i++) {
      const row = [base[i].t, ...visible.map((c) => c.series[0].signal.data[i]?.value ?? "")]
      lines.push(row.join(","))
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = activeLog.fileName.replace(/\.[^.]+$/, "") + " - export.csv"
    a.click()
    URL.revokeObjectURL(url)
  }

  // --- Templates -----------------------------------------------------------
  function applyTemplate(t: Template) {
    const labels = new Set(t.channels)
    setHidden(new Set(channels.filter((c) => !labels.has(c.label)).map((c) => c.key)))
  }

  function saveTemplate(name: string) {
    const next = [...templates, { id: makeTemplateId(), name, channels: visibleChannels.map((c) => c.label) }]
    setTemplates(next)
    persistTemplates(next)
  }

  function deleteTemplate(id: string) {
    const next = templates.filter((t) => t.id !== id)
    setTemplates(next)
    persistTemplates(next)
  }

  function renameTemplate(id: string, name: string) {
    const next = templates.map((t) => (t.id === id ? { ...t, name } : t))
    setTemplates(next)
    persistTemplates(next)
  }

  // Overwrite a template's channels with the current visible selection.
  function updateTemplate(id: string) {
    const labels = visibleChannels.map((c) => c.label)
    const next = templates.map((t) => (t.id === id ? { ...t, channels: labels } : t))
    setTemplates(next)
    persistTemplates(next)
  }

  async function importTemplates(file: File) {
    try {
      const imported = parseImportedTemplates(await file.text())
      if (!imported.length) return
      const next = [...templates, ...imported]
      setTemplates(next)
      persistTemplates(next)
    } catch {
      /* ignore malformed file */
    }
  }

  function exportTemplates() {
    const blob = new Blob([serializeTemplates(templates)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "octane-templates.json"
    a.click()
    URL.revokeObjectURL(url)
  }

  const visibleChannels = useMemo(() => channels.filter((c) => !hidden.has(c.key)), [channels, hidden])
  const mobileAnalysisChannels = useMemo(
    () => channels.filter((channel) => mobileAnalysisLabels.has(channel.label)).slice(0, MOBILE_ANALYSIS_MAX_CHANNELS),
    [channels, mobileAnalysisLabels],
  )
  // Quick-search overrides the checklist for the Signal Matrix: type to view any plot fast.
  const matrixChannels = useMemo(() => {
    const q = matrixQuery.trim().toLowerCase()
    return q ? channels.filter((c) => c.label.toLowerCase().includes(q)) : visibleChannels
  }, [matrixQuery, channels, visibleChannels])
  // The chart to ring: the persisted post-search target, else the live first match.
  const matrixHighlight: SignalKey | null =
    highlightChannel ?? (quickOpen && matrixQuery.trim() ? matrixChannels[0]?.key ?? null : null)
  const activeCount = visibleChannels.length

  const kpis = useMemo(
    () => (activeLog ? computeKpis(activeLog, activeCount) : []),
    [activeLog, activeCount],
  )

  const overview: OverviewSeries[] = useMemo(
    () => visibleChannels.slice(0, 3).map((c) => ({ color: c.series[0].color, data: c.series[0].signal.data })),
    [visibleChannels],
  )

  // Matrix quick-search: land on the first matching channel — reveal it if hidden,
  // scroll its plot into view and flash a highlight — instead of resetting the list.
  function landOnChannel() {
    const target = matrixChannels[0]
    setMatrixQuery("")
    setQuickOpen(false)
    if (!target) return
    setHidden((prev) => {
      if (!prev.has(target.key)) return prev
      const n = new Set(prev)
      n.delete(target.key)
      return n
    })
    setHighlightChannel(target.key)
    setTimeout(() => document.getElementById(`chart-${target.key}`)?.scrollIntoView({ block: "center", behavior: "smooth" }), 60)
    setTimeout(() => setHighlightChannel(null), 1800)
  }

  function resetMatrixView() {
    if (activeLog) setHidden(defaultHidden(activeLog, mobileViewport || isMobileViewportNow()))
    resetView(duration)
    setCollapsed(new Set())
    setQuery("")
    setMatrixQuery("")
    setQuickOpen(false)
    setHighlightChannel(null)
    setMobileWindowOpen(false)
    setSync(true)
    scrollMainToTop()
  }

  function resetAnalysisView() {
    resetView(duration)
    if (activeLog && mobileViewport) setMobileAnalysisLabels(defaultMobileAnalysisLabels(activeLog))
    setAnalysisTransforms({})
    setAnalysisFocus(null)
    setAnalysisMarkPeaks(false)
    setAnalysisSplit(false)
    setAnalysisPlotAssign({})
  }

  function resetControls() {
    if (view === "plot" || view === "channels") resetAnalysisView()
    else resetMatrixView()
  }

  function fitWindow() {
    setZoom(100)
    setDomain([0, duration])
  }

  function renderControlPanel(onScrollToVisibleChannel = scrollToChannel, mobile = false) {
    return (
      <ControlPanel
        query={query}
        onQueryChange={setQuery}
        searchRef={searchRef}
        sync={sync}
        onSyncChange={setSync}
        annotate={annotate}
        onAnnotateChange={setAnnotate}
        onReset={resetControls}
        onFit={fitWindow}
        windowSlot={
          duration > 0 && overview.length > 0 ? (
            <RangeBrush
              compact
              series={overview}
              duration={duration}
              domain={domain}
              timeUnit={timeUnit}
              onChange={setWindow}
              onZoomIn={() => applyZoom(zoom + 50)}
              onZoomOut={() => applyZoom(zoom - 50)}
            />
          ) : null
        }
        channels={channelItems}
        hidden={hidden}
        onToggleChannel={toggleChannel}
        onScrollToChannel={onScrollToVisibleChannel}
        onShowAll={() => setHidden(new Set())}
        onHideAll={() => setHidden(new Set(channels.map((c) => c.key)))}
        templates={templates}
        onApplyTemplate={applyTemplate}
        onSaveTemplate={saveTemplate}
        onDeleteTemplate={deleteTemplate}
        onRenameTemplate={renameTemplate}
        onUpdateTemplate={updateTemplate}
        onImportTemplates={importTemplates}
        onExportTemplates={exportTemplates}
        mobile={mobile}
      />
    )
  }

  const shortcuts: Shortcut[] = [
    { key: "o", ctrl: true, description: "Open log", handler: () => openCsvDialog(loadFile) },
    { key: "k", ctrl: true, description: "Search channels", handler: () => searchRef.current?.focus() },
    { key: bindings.sync, description: "Toggle signal sync", handler: () => setSync((v) => !v) },
    { key: bindings.annotate, description: "Toggle annotate mode", handler: () => setAnnotate((v) => !v) },
    { key: bindings.viewMatrix, description: "Signal Matrix view", handler: () => changeView("matrix") },
    { key: bindings.viewPlot, description: "Analysis Plot view", handler: () => changeView("plot") },
    { key: bindings.viewChannels, description: "Channels view", handler: () => !mobileViewport && changeView("channels") },
    { key: bindings.viewCompare, description: "Compare view", handler: () => !mobileViewport && changeView("compare") },
    { key: bindings.togglePick, description: "Toggle readout picking", handler: () => setReadoutPicking((value) => !value) },
    { key: bindings.editChannels, description: "Edit Channels layout", handler: () => !mobileViewport && view === "channels" && setChannelsEditOpen(true) },
    { key: bindings.reset, description: "Reset view", handler: resetControls },
    { key: bindings.toggleGrid, description: "Toggle grid lines", handler: () => setDisplay((d) => ({ ...d, showGrid: !d.showGrid })) },
    { key: bindings.lockCompare, description: "Lock alignment (Compare)", handler: () => setCompareLocked((v) => !v) },
    {
      key: bindings.quickSearch,
      description: "Quick search (Signal Matrix)",
      handler: () => {
        if (comparing || view !== "matrix") return
        setQuickOpen(true)
        setTimeout(() => quickRef.current?.focus(), 0)
      },
    },
    {
      key: bindings.previousFile,
      description: "Previous loaded / reference file",
      handler: () => switchLoadedLog(-1),
    },
    {
      key: bindings.cycleFile,
      description: "Next loaded / reference file",
      handler: () => switchLoadedLog(1),
    },
    {
      key: bindings.heightCycle,
      description: "Cycle chart height (Signal Matrix)",
      handler: () =>
        setDisplay((d) => {
          const order = ["mini", "compact", "normal", "tall"] as const
          return { ...d, height: order[(order.indexOf(d.height) + 1) % order.length] }
        }),
    },
    { key: "Home", description: "Scroll to top", handler: () => mainRef.current?.scrollTo({ top: 0, behavior: "smooth" }) },
    { key: "?", shift: true, description: "Toggle keyboard shortcuts", handler: () => !mobileViewport && setShowShortcuts((v) => !v) },
    {
      key: "Escape",
      description: "Close dialogs / exit annotate",
      // Priority: close the top-most thing only. The Analysis Plot handles its own
      // Escape (fullscreen → focus) when no modal/draft is open.
      handler: () => {
        if (showShortcuts) setShowShortcuts(false)
        else if (showAbout) setShowAbout(false)
        else if (showSettings) setShowSettings(false)
        else if (mobileControlsOpen) setMobileControlsOpen(false)
        else if (annotationDraft) setAnnotationDraft(null)
        else if (annotate) setAnnotate(false)
        else if (quickOpen) landOnChannel()
      },
    },
  ]
  useShortcuts(shortcuts, hasLogs)

  return (
    <div
      className={cn(
        "isolate flex h-dvh overflow-hidden bg-background text-foreground",
        (view === "plot" || view === "channels") && "mobile-analysis-mode",
        view === "matrix" && "mobile-matrix-mode",
        hasLogs && view === "matrix" && "has-mobile-simple-actions",
      )}
    >
      <Rail
        view={view}
        canCompare={canCompare}
        onHome={onHome}
        onSetView={changeView}
        onOpenMetadata={() => setShowMetadata(true)}
        onOpenSettings={() => setShowSettings(true)}
        onOpenAbout={() => setShowAbout(true)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Single top bar */}
        <header className="octane-app-header sticky top-0 z-20 flex min-h-14 flex-wrap items-center gap-2 border-b border-border bg-background/85 px-3 py-2 backdrop-blur sm:flex-nowrap sm:gap-4 sm:px-5 sm:py-0">
          <div className="octane-header-identity min-w-0 flex-1">
            <h1 className="octane-app-title truncate text-sm font-semibold tracking-tight">
              {activeLog ? activeLog.fileName : "Octane"}
            </h1>
            {activeLog && (
              <span className="octane-app-meta block truncate font-mono text-[11px] text-muted-foreground">
                {activeLog.sizeLabel} - {activeLog.samples.toLocaleString()} samples - {duration.toFixed(1)}
                {timeUnit}
              </span>
            )}
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {logs.length > 1 && !mobileViewport && !comparing && (
              <div
                className="hidden max-w-[36rem] items-center gap-1 rounded-md border border-border bg-card/80 p-1 shadow-sm lg:flex"
                aria-label="Loaded log switcher"
              >
                <button
                  type="button"
                  onClick={() => switchLoadedLog(-1)}
                  title="Previous loaded log"
                  aria-label="Previous loaded log"
                  className="inline-flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                >
                  <ChevronLeft className="size-3.5" />
                </button>
                <label className="sr-only" htmlFor="octane-active-log">
                  Active loaded log
                </label>
                <select
                  id="octane-active-log"
                  value={activeIndex}
                  onChange={(event) => selectLog(Number(event.target.value))}
                  className="h-6 min-w-0 max-w-[24rem] rounded border-0 bg-transparent px-1 text-xs font-medium text-foreground outline-none focus:ring-2 focus:ring-ring/30"
                  title={activeLog?.fileName}
                >
                  {logs.map((log, i) => (
                    <option key={`${log.fileName}-${i}`} value={i}>
                      Log {i + 1} of {logs.length}: {log.fileName}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => switchLoadedLog(1)}
                  title="Next loaded log"
                  aria-label="Next loaded log"
                  className="inline-flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                >
                  <ChevronRight className="size-3.5" />
                </button>
              </div>
            )}
            {hasLogs && (
              <button
                type="button"
                onClick={() => setMobileControlsOpen(true)}
                title="Open controls"
                aria-label="Open controls"
                className="octane-mobile-controls-trigger inline-flex size-9 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground lg:hidden"
              >
                <SlidersHorizontal className="size-4" />
              </button>
            )}
            {hasLogs && (
              <button
                type="button"
                onClick={() => setDesktopControlsOpen((value) => !value)}
                title={desktopControlsOpen ? "Hide controls dock" : "Show controls dock"}
                aria-label={desktopControlsOpen ? "Hide controls dock" : "Show controls dock"}
                aria-pressed={desktopControlsOpen}
                className="hidden size-8 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground lg:inline-flex"
              >
                <SlidersHorizontal className="size-4" />
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowShortcuts(true)}
              title="Keyboard shortcuts (?)"
              aria-label="Keyboard shortcuts"
              className="hidden size-8 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground lg:inline-flex"
            >
              <Keyboard className="size-4" />
            </button>
            <span className="hidden lg:inline-flex">
              <LicenseBadge email={accountEmail} compact />
            </span>
            {hasLogs && (
              <div className="octane-mobile-view-toggle inline-flex items-center rounded-md border border-border bg-card p-0.5 lg:hidden" aria-label="Mobile view switcher">
                <button
                  type="button"
                  onClick={() => changeView("matrix")}
                  aria-label="Signal Matrix"
                  aria-pressed={view === "matrix"}
                  className={cn(
                    "inline-flex h-7 items-center justify-center gap-1.5 rounded px-2 text-[11px] font-semibold transition-colors",
                    view === "matrix" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                  )}
                >
                  <LayoutList className="size-3.5" />
                  <span>Matrix</span>
                </button>
                <button
                  type="button"
                  onClick={() => changeView("plot")}
                  aria-label="Analysis Plot"
                  aria-pressed={view === "plot"}
                  className={cn(
                    "inline-flex h-7 items-center justify-center gap-1.5 rounded px-2 text-[11px] font-semibold transition-colors",
                    view === "plot" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                  )}
                >
                  <LineChart className="size-3.5" />
                  <span>Analysis</span>
                </button>
              </div>
            )}
            <button
              type="button"
              onClick={() => openCsvDialog(loadFile)}
              aria-label="Import CSV"
              className="hidden items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-secondary lg:inline-flex"
            >
              <Upload className="size-3.5" />
              <span className="octane-action-label hidden sm:inline">Import CSV</span>
            </button>
            {hasLogs && (
              <button
                type="button"
                onClick={exportCsv}
                aria-label="Export CSV"
                className="hidden items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-secondary lg:inline-flex"
              >
                <Download className="size-3.5" />
                <span className="octane-action-label hidden sm:inline">Export</span>
              </button>
            )}
          </div>
        </header>

        {!hasLogs ? (
          <div className="flex flex-1 items-center justify-center p-4 sm:p-6">
            <div className="w-full max-w-xl">
              <UploadZone onFile={loadFile} onSample={loadSample} loading={loading} error={error} />
            </div>
          </div>
        ) : (
          <>
            {error && (
              <div className="mx-5 mt-3 flex shrink-0 items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <span className="flex items-center gap-2">
                  <TriangleAlert className="size-4 shrink-0" />
                  {error}
                </span>
                <button
                  type="button"
                  onClick={() => setError(null)}
                  aria-label="Dismiss"
                  className="inline-flex size-6 shrink-0 items-center justify-center rounded hover:bg-destructive/20"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            )}
            <div className="flex min-h-0 flex-1">
            {/* Left control sidebar (fixed; only the channel list scrolls) */}
            {desktopControlsOpen && (
              <aside className="hidden w-72 shrink-0 border-r border-border lg:block">
                {renderControlPanel()}
              </aside>
            )}

            {/* Main content */}
            <div className="flex min-w-0 flex-1 flex-col">
              <main ref={mainRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-4 sm:px-5 sm:py-5">
                {kpis.length > 0 && view !== "channels" && !mobileViewport && (
                  <div className="analysis-kpis">
                    <KpiCards kpis={kpis} />
                  </div>
                )}

                {logs.length > 1 && !mobileViewport && (
                  <div className="analysis-loaded-files mt-4">
                    <LoadedFiles
                      files={logs.map((l, i) => ({ id: `log-${i}`, name: l.fileName, size: l.sizeLabel, samples: l.samples }))}
                      activeIndex={activeIndex}
                      compare={comparing}
                      colors={FILE_COLORS}
                      onSelect={selectLog}
                      onRemove={removeLog}
                    />
                  </div>
                )}

                {view !== "channels" && <div className="analysis-heading mt-5 mb-3 flex flex-wrap items-center justify-between gap-2 sm:gap-3">
                  <h2 className="shrink-0 text-sm font-semibold text-foreground">
                    {view === "plot" ? "Analysis Plot" : comparing ? "Comparison" : "Signal Matrix"}
                  </h2>
                  {!comparing && view !== "plot" && (
                    <div className="hidden flex-1 items-center justify-end gap-2 lg:flex">
                      {quickOpen ? (
                        <div className="relative w-full max-w-xs">
                          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                          <input
                            ref={quickRef}
                            autoFocus
                            value={matrixQuery}
                            onChange={(e) => setMatrixQuery(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === "Escape") {
                                e.preventDefault()
                                e.stopPropagation()
                                landOnChannel() // stay on the matched channel's plot
                              }
                            }}
                            placeholder="Quick search — ↵ jumps to the plot…"
                            className="h-8 w-full rounded-md border border-border bg-card pl-8 pr-8 text-xs text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              setMatrixQuery("")
                              setQuickOpen(false)
                            }}
                            aria-label="Close quick search"
                            className="absolute right-1.5 top-1/2 inline-flex size-5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-secondary hover:text-foreground"
                          >
                            <X className="size-3.5" />
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setQuickOpen(true)}
                          title="Quick search a plot"
                          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                        >
                          <Search className="size-3.5" />
                          Quick search
                        </button>
                      )}
                    </div>
                  )}
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">
                    {domain[0].toFixed(1)}
                    {timeUnit} – {domain[1].toFixed(1)}
                    {timeUnit}
                  </span>
                </div>}

                {comparing ? (
                  <CompareView
                    logs={logs}
                    areas={compareAreas}
                    offsets={fileOffsets}
                    activeFile={activeCompareFile}
                    domain={domain}
                    display={display}
                    sync={sync}
                    cursorT={sync ? cursorT : null}
                    templates={templates}
                    onSetActiveFile={setActiveCompareFile}
                    onSetOffset={setFileOffset}
                    onResetOffsets={() => setFileOffsets({})}
                    onSetAreaChannels={setAreaChannels}
                    onApplyTemplateAll={applyTemplateToCompare}
                    locked={compareLocked}
                    onToggleLock={() => setCompareLocked((v) => !v)}
                    onCursorChange={setCursorT}
                  />
                ) : view === "plot" ? (
                  <div className="analysis-plot-shell flex min-h-0 flex-1 flex-col pb-20 lg:pb-4">
                    <CombinedChart
                      series={(mobileViewport ? mobileAnalysisChannels : visibleChannels).map((c) => c.series[0])}
                      availableSeries={channels.map((c) => c.series[0])}
                      domain={domain}
                      sync={sync}
                      cursorT={sync ? cursorT : null}
                      display={display}
                      timeUnit={timeUnit}
                      annotations={annotations}
                      annotateMode={annotate}
                      transforms={analysisTransforms}
                      setTransforms={setAnalysisTransforms}
                      focusKey={analysisFocus}
                      setFocusKey={setAnalysisFocus}
                      markPeaks={analysisMarkPeaks}
                      setMarkPeaks={setAnalysisMarkPeaks}
                      split={analysisSplit}
                      setSplit={setAnalysisSplit}
                      plotAssign={analysisPlotAssign}
                      setPlotAssign={setAnalysisPlotAssign}
                      readoutPicking={readoutPicking}
                      onReadoutPickingChange={setReadoutPicking}
                      modalOpen={showAbout || showShortcuts || showSettings || annotationDraft != null}
                      onCursorChange={setCursorT}
                      onAddAnnotation={openAnnotation}
                      onFitWindow={fitWindow}
                      onResetPlot={resetAnalysisView}
                      onToggleChannelLabel={mobileViewport ? toggleMobileAnalysisLabel : toggleChannelByLabel}
                      timelineSlot={
                        duration > 0 && overview.length > 0 ? (
                          <RangeBrush
                            compact
                            series={overview}
                            duration={duration}
                            domain={domain}
                            timeUnit={timeUnit}
                            onChange={setWindow}
                            onZoomIn={() => applyZoom(zoom + 50)}
                            onZoomOut={() => applyZoom(zoom - 50)}
                          />
                        ) : null
                      }
                      templates={templates}
                      onApplyTemplate={applyTemplate}
                    />
                  </div>
                ) : view === "channels" ? (
                  <div className="analysis-plot-shell flex min-h-[32rem] flex-1 flex-col pb-20 lg:min-h-0 lg:pb-4">
                    <div className="octane-channel-workbench hidden min-h-0 flex-1 overflow-hidden rounded-xl border border-border bg-card/50 shadow-2xl lg:flex lg:flex-col">
                      <div className="shrink-0 border-b border-border bg-card/80 px-3 py-3">
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <h3 className="text-sm font-semibold text-foreground">Preset Diagnostics</h3>
                            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                              {activePreset.name} - {presetMatch.groups.length} graph groups - {presetMatch.channels.length} matched channels
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setChannelsEditOpen(true)}
                              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                            >
                              <Plus className="size-3.5" />
                              Edit channels
                            </button>
                            <button
                              type="button"
                              onClick={() => setReadoutPicking((value) => !value)}
                              aria-pressed={readoutPicking}
                              title={readoutPicking ? "Disable ghost readout line picking" : "Enable ghost readout line picking"}
                              className={cn(
                                "inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors",
                                readoutPicking
                                  ? "border-primary bg-primary/15 text-foreground"
                                  : "border-border bg-card text-muted-foreground hover:bg-secondary hover:text-foreground",
                              )}
                            >
                              <MousePointerClick className="size-3.5" />
                              Pick
                            </button>
                            <button
                              type="button"
                              onClick={() => setChannelsPaneOpen((value) => !value)}
                              aria-pressed={channelsPaneOpen}
                              className={cn(
                                "inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors",
                                channelsPaneOpen
                                  ? "border-primary bg-primary/15 text-foreground"
                                  : "border-border bg-card text-muted-foreground hover:bg-secondary hover:text-foreground",
                              )}
                            >
                              <SlidersHorizontal className="size-3.5" />
                              Values
                            </button>
                            <button
                              type="button"
                              onClick={() => setChannelsHelpOpen(true)}
                              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                            >
                              <HelpCircle className="size-3.5" />
                              Help
                            </button>
                          </div>
                        </div>
                        <div className="octane-channel-tabs flex flex-wrap gap-1.5">
                          {channelPresets.map((preset) => (
                            <button
                              key={preset.id}
                              type="button"
                              onClick={() => {
                                setActivePresetId(preset.id)
                                setChannelsPaneQuery("")
                              }}
                              aria-pressed={activePreset.id === preset.id}
                              className={cn(
                                "h-8 rounded-md border px-3 text-xs font-medium transition-colors",
                                activePreset.id === preset.id
                                  ? "border-primary bg-primary/15 text-foreground shadow-[inset_0_-2px_0_var(--primary)]"
                                  : "border-border bg-background/60 text-muted-foreground hover:bg-secondary hover:text-foreground",
                              )}
                            >
                              {preset.name}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="flex min-h-0 flex-1">
                        <div className="relative flex min-w-0 flex-1 flex-col">
                          {presetMatch.channels.length === 0 ? (
                            <div className="flex min-h-0 flex-1 items-center justify-center px-4 text-center text-sm text-muted-foreground">
                              No channels from the {activePreset.name} preset were found in this log.
                            </div>
                          ) : (
                            <CombinedChart
                              series={presetMatch.channels.map((c) => c.series[0])}
                              availableSeries={channels.map((c) => c.series[0])}
                              presetGroups={presetMatch.groups}
                              panelTitle={activePreset.name}
                              workbench
                              domain={domain}
                              sync={sync}
                              cursorT={sync ? cursorT : null}
                              display={display}
                              timeUnit={timeUnit}
                              annotations={annotations}
                              annotateMode={annotate}
                              transforms={analysisTransforms}
                              setTransforms={setAnalysisTransforms}
                              focusKey={analysisFocus}
                              setFocusKey={setAnalysisFocus}
                              markPeaks={analysisMarkPeaks}
                              setMarkPeaks={setAnalysisMarkPeaks}
                              split={analysisSplit}
                              setSplit={setAnalysisSplit}
                              plotAssign={analysisPlotAssign}
                              setPlotAssign={setAnalysisPlotAssign}
                              readoutPicking={readoutPicking}
                              modalOpen={showAbout || showShortcuts || showSettings || annotationDraft != null}
                              onCursorChange={setCursorT}
                              onAddAnnotation={openAnnotation}
                            />
                          )}
                        </div>

                        {channelsPaneOpen && (
                          <ChannelsStatsPane
                            presetName={activePreset.name}
                            channels={presetMatch.channels}
                            allChannels={channels}
                            cursorT={sync ? cursorT : null}
                            timeUnit={timeUnit}
                            query={channelsPaneQuery}
                            onQueryChange={setChannelsPaneQuery}
                            onClose={() => setChannelsPaneOpen(false)}
                            onFocusChannel={setAnalysisFocus}
                          />
                        )}
                      </div>

                      <div className="flex h-7 shrink-0 items-center border-t border-border bg-card/80 text-[11px] text-muted-foreground">
                        <span className="border-r border-border px-2 font-mono text-foreground">
                          Time{timeUnit ? ` (${timeUnit})` : ""}: {cursorT == null ? "--" : cursorT.toFixed(3)}
                        </span>
                        <span className="border-r border-border px-3">Ready</span>
                        <span className="ml-auto truncate px-3 font-mono">{activeLog?.fileName}</span>
                        <span className="border-l border-border px-3 font-mono">{activeLog?.samples.toLocaleString()} rows</span>
                      </div>
                    </div>

                    <div className="flex min-h-0 flex-1 flex-col gap-3 lg:hidden">
                      <div className="flex gap-1 overflow-x-auto rounded-lg border border-border bg-card/50 p-1">
                        {channelPresets.map((preset) => (
                          <button
                            key={preset.id}
                            type="button"
                            onClick={() => setActivePresetId(preset.id)}
                            aria-pressed={activePreset.id === preset.id}
                            className={cn(
                              "h-8 shrink-0 rounded-md px-3 text-xs font-medium transition-colors",
                              activePreset.id === preset.id
                                ? "bg-primary text-primary-foreground"
                                : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                            )}
                          >
                            {preset.name}
                          </button>
                        ))}
                      </div>

                      {presetMatch.missing.length > 0 && (
                        <div className="rounded-lg border border-border bg-card/40 px-3 py-2 text-xs text-muted-foreground">
                          Missing from this log: {presetMatch.missing.slice(0, 8).join(", ")}
                          {presetMatch.missing.length > 8 ? `, +${presetMatch.missing.length - 8} more` : ""}
                        </div>
                      )}

                      {presetMatch.channels.length === 0 ? (
                        <div className="flex min-h-[18rem] items-center justify-center rounded-xl border border-dashed border-border px-4 py-16 text-center text-sm text-muted-foreground">
                          No channels from the {activePreset.name} preset were found in this log.
                        </div>
                      ) : (
                        <CombinedChart
                          series={presetMatch.channels.map((c) => c.series[0])}
                          availableSeries={channels.map((c) => c.series[0])}
                          presetGroups={presetMatch.groups}
                          panelTitle={activePreset.name}
                          domain={domain}
                          sync={sync}
                          cursorT={sync ? cursorT : null}
                          display={display}
                          timeUnit={timeUnit}
                          annotations={annotations}
                          annotateMode={annotate}
                          transforms={analysisTransforms}
                          setTransforms={setAnalysisTransforms}
                          focusKey={analysisFocus}
                          setFocusKey={setAnalysisFocus}
                          markPeaks={analysisMarkPeaks}
                          setMarkPeaks={setAnalysisMarkPeaks}
                          split={analysisSplit}
                          setSplit={setAnalysisSplit}
                          plotAssign={analysisPlotAssign}
                          setPlotAssign={setAnalysisPlotAssign}
                          readoutPicking={readoutPicking}
                          modalOpen={showAbout || showShortcuts || showSettings || annotationDraft != null}
                          onCursorChange={setCursorT}
                          onAddAnnotation={openAnnotation}
                          onFitWindow={fitWindow}
                          onResetPlot={resetAnalysisView}
                          timelineSlot={
                            duration > 0 && overview.length > 0 ? (
                              <RangeBrush
                                compact
                                series={overview}
                                duration={duration}
                                domain={domain}
                                timeUnit={timeUnit}
                                onChange={setWindow}
                                onZoomIn={() => applyZoom(zoom + 50)}
                                onZoomOut={() => applyZoom(zoom - 50)}
                              />
                            ) : null
                          }
                        />
                      )}
                    </div>
                  </div>
                ) : matrixChannels.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border py-16 text-center text-sm text-muted-foreground">
                    {matrixQuery ? `No channels match "${matrixQuery}".` : "No channels selected. Enable some from Controls."}
                  </div>
                ) : (
                  <div className="flex flex-col gap-4 pb-20 lg:pb-4">
                    {matrixChannels.map((c) => (
                      <div
                        key={c.key}
                        className={cn(
                          "rounded-xl transition-shadow",
                          matrixHighlight === c.key && "ring-2 ring-primary ring-offset-2 ring-offset-background",
                        )}
                      >
                      <SignalChart
                        channelKey={c.key}
                        domId={`chart-${c.key}`}
                        label={c.label}
                        unit={c.unit}
                        decimals={c.decimals}
                        series={c.series}
                        domain={domain}
                        sync={sync}
                        cursorT={sync ? cursorT : null}
                        collapsed={collapsed.has(c.key)}
                        display={display}
                        timeUnit={timeUnit}
                        annotations={annotations}
                        annotateMode={annotate}
                        diffStats={c.diffStats}
                        onToggleCollapse={toggleCollapse}
                        onCursorChange={setCursorT}
                        onAddAnnotation={openAnnotation}
                      />
                      </div>
                    ))}
                  </div>
                )}
              </main>
            </div>
            </div>
          </>
        )}
      </div>

      <AboutModal open={showAbout} onClose={() => setShowAbout(false)} />
      <ShortcutsModal open={showShortcuts} view={view} onClose={() => setShowShortcuts(false)} />
      <SettingsModal
        open={showSettings}
        settings={display}
        onChange={setDisplay}
        onReset={() => setDisplay(DEFAULT_DISPLAY)}
        onClose={() => setShowSettings(false)}
      />
      <MetadataModal open={showMetadata} log={activeLog ?? null} onClose={() => setShowMetadata(false)} />
      <ChannelsHelpDialog open={channelsHelpOpen} onClose={() => setChannelsHelpOpen(false)} />
      <ChannelsPresetEditor
        open={channelsEditOpen}
        presets={channelPresets}
        groupsByPreset={channelPresetGroups}
        activePresetId={activePreset.id}
        defaultPresets={defaultChannelPresets}
        defaultGroupsByPreset={defaultChannelGroups}
        channels={channels}
        templates={templates}
        onSave={saveChannelWorkspace}
        onSaveTemplate={saveTemplateFromLabels}
        onClose={() => setChannelsEditOpen(false)}
      />
      {hasLogs && view === "matrix" && (
        <div className="octane-mobile-quick-search fixed inset-x-3 z-40 lg:hidden">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={quickRef}
              value={matrixQuery}
              onFocus={() => setQuickOpen(true)}
              onChange={(event) => {
                setQuickOpen(true)
                setMatrixQuery(event.target.value)
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === "Escape") {
                  event.preventDefault()
                  event.stopPropagation()
                  landOnChannel()
                }
              }}
              placeholder="Quick search channels..."
              className="h-10 w-full rounded-full border border-border bg-popover/95 pl-10 pr-10 text-sm text-foreground shadow-2xl backdrop-blur placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
            />
            {matrixQuery && (
              <button
                type="button"
                onClick={() => {
                  setMatrixQuery("")
                  setQuickOpen(false)
                  quickRef.current?.focus()
                }}
                aria-label="Clear quick search"
                className="absolute right-2 top-1/2 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            )}
          </div>
        </div>
      )}
      {hasLogs && view === "matrix" && (
        <div className="octane-mobile-simple-actions fixed inset-x-0 z-40 grid grid-cols-4 gap-1 border-t border-border bg-background/95 px-2 py-2 backdrop-blur lg:hidden">
          <button
            type="button"
            onClick={() => setSync((value) => !value)}
            aria-pressed={sync}
            className={cn("octane-mobile-simple-button", sync && "is-active")}
          >
            Sync
          </button>
          <button
            type="button"
            onClick={() => setMobileWindowOpen((value) => !value)}
            aria-pressed={mobileWindowOpen}
            className={cn("octane-mobile-simple-button", mobileWindowOpen && "is-active")}
          >
            <SlidersHorizontal className="size-3.5" />
            Window
          </button>
          <button type="button" onClick={resetControls} className="octane-mobile-simple-button">
            <RefreshCw className="size-3.5" />
            Reset
          </button>
          <button type="button" onClick={fitWindow} className="octane-mobile-simple-button">
            <ScanSearch className="size-3.5" />
            Fit
          </button>
        </div>
      )}
      {hasLogs && view === "matrix" && mobileWindowOpen && duration > 0 && overview.length > 0 && (
        <div className="octane-mobile-window-drawer fixed inset-x-3 z-50 rounded-xl border border-border bg-popover/95 p-3 shadow-2xl backdrop-blur lg:hidden">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-foreground">Window</h3>
              <p className="font-mono text-[11px] text-muted-foreground">
                {domain[0].toFixed(1)}
                {timeUnit} - {domain[1].toFixed(1)}
                {timeUnit}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setMobileWindowOpen(false)}
              aria-label="Close window controls"
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          </div>
          <RangeBrush
            compact
            series={overview}
            duration={duration}
            domain={domain}
            timeUnit={timeUnit}
            onChange={setWindow}
            onZoomIn={() => applyZoom(zoom + 50)}
            onZoomOut={() => applyZoom(zoom - 50)}
          />
        </div>
      )}
      {hasLogs && mobileControlsOpen && (
        <div className="fixed inset-0 z-[90] lg:hidden" role="dialog" aria-modal="true" aria-label="Signal controls">
          <button
            type="button"
            aria-label="Close controls"
            onClick={() => setMobileControlsOpen(false)}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          />
          <aside className="octane-mobile-controls-sheet absolute inset-x-0 bottom-0 flex max-h-[calc(100dvh-0.5rem)] flex-col overflow-hidden rounded-t-xl border-t border-border bg-popover shadow-2xl">
            <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
              <h3 className="text-sm font-semibold text-foreground">Controls</h3>
              <button
                type="button"
                onClick={() => setMobileControlsOpen(false)}
                aria-label="Close controls"
                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-border bg-card px-3 text-sm font-semibold text-foreground transition-colors hover:bg-secondary"
              >
                <X className="size-4" />
                Close
              </button>
            </div>
            <div className="grid shrink-0 grid-cols-2 gap-2 border-b border-border p-3">
              <button
                type="button"
                onClick={() => {
                  setMobileControlsOpen(false)
                  openCsvDialog(loadFile)
                }}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-border bg-card text-sm font-medium text-foreground transition-colors hover:bg-secondary"
              >
                <Upload className="size-4" />
                Import CSV
              </button>
              <button
                type="button"
                onClick={() => {
                  exportCsv()
                  setMobileControlsOpen(false)
                }}
                disabled={!hasLogs}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-border bg-card text-sm font-medium text-foreground transition-colors hover:bg-secondary disabled:opacity-40"
              >
                <Download className="size-4" />
                Export
              </button>
            </div>
            <div className="min-h-0 flex-1">
              {renderControlPanel((key) => {
                scrollToChannel(key)
                setMobileControlsOpen(false)
              }, true)}
            </div>
          </aside>
        </div>
      )}
      {annotationDraft && (
        <AnnotationDialog
          draft={annotationDraft}
          timeUnit={timeUnit}
          onSave={saveAnnotation}
          onClose={() => setAnnotationDraft(null)}
        />
      )}

      {annotations.length > 0 && hasLogs && (
        <AnnotationFloat annotations={annotations} timeUnit={timeUnit} onRemove={removeAnnotation} onJump={jumpToTime} />
      )}
    </div>
  )
})

function ChannelsStatsPane({
  presetName,
  channels,
  allChannels,
  cursorT,
  timeUnit,
  query,
  onQueryChange,
  onClose,
  onFocusChannel,
}: {
  presetName: string
  channels: Channel[]
  allChannels: Channel[]
  cursorT: number | null
  timeUnit: string
  query: string
  onQueryChange: (value: string) => void
  onClose: () => void
  onFocusChannel: (label: string) => void
}) {
  const q = query.trim().toLowerCase()
  const visible = (channels.length ? channels : allChannels).filter((channel) => {
    if (!q) return true
    return channel.label.toLowerCase().includes(q) || channel.unit.toLowerCase().includes(q)
  })
  const colorFor = (channel: Channel) => {
    const idx = allChannels.findIndex((item) => item.label === channel.label)
    return idx >= 0 ? plotColor(idx) : channel.series[0]?.color ?? "var(--muted-foreground)"
  }

  return (
    <aside className="flex w-[22rem] shrink-0 flex-col border-l border-border bg-background/80 text-foreground">
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">Values</h3>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{presetName}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close values panel"
          className="inline-flex size-7 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      </div>

      <div className="space-y-3 border-b border-border px-4 py-3">
        <div className="flex h-8 items-center justify-between rounded-md border border-border bg-card px-2.5 font-mono text-[11px] text-muted-foreground">
          <span>cursor</span>
          <span className="font-semibold text-foreground">
            {cursorT == null ? "--" : cursorT.toFixed(2)}
            {timeUnit}
          </span>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search channels..."
            className="h-8 w-full rounded-md border border-border bg-card pl-8 pr-8 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/30"
          />
          {query && (
            <button
              type="button"
              onClick={() => onQueryChange("")}
              aria-label="Clear channels filter"
              className="absolute right-1.5 top-1/2 inline-flex size-5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              <X className="size-3" />
            </button>
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b border-border px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          <span>{channels.length ? "Preset Channels" : "Log Channels"}</span>
          <span className="font-mono">{visible.length}</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {visible.map((channel) => {
            const signal = channel.series[0].signal
            const current = sampleChannelValue(signal.data, cursorT)
            const color = colorFor(channel)
            const unit = channel.unit && channel.unit !== "—" ? channel.unit : ""
            return (
              <button
                key={channel.key}
                type="button"
                onClick={() => onFocusChannel(channel.label)}
                className="mb-1.5 flex w-full flex-col gap-1 rounded-md border border-transparent bg-card/40 px-3 py-2 text-left transition-colors hover:border-border hover:bg-secondary/70"
              >
                <span className="flex min-w-0 items-start gap-2">
                  <span className="mt-1 size-2.5 shrink-0 rounded-full shadow-[0_0_0_2px_rgba(255,255,255,0.05)]" style={{ backgroundColor: color }} />
                  <span className="min-w-0 flex-1 text-xs font-medium leading-snug text-foreground" title={channel.label}>
                    {channel.label}
                  </span>
                  <span className="shrink-0 font-mono text-sm font-semibold tabular-nums text-foreground">
                    {fmtChannelValue(current, channel.decimals)}
                    {unit && <span className="ml-1 text-[10px] font-normal text-muted-foreground">{unit}</span>}
                  </span>
                </span>
                <span className="ml-4 flex gap-3 font-mono text-[10px] text-muted-foreground">
                  <span>min {fmtChannelValue(signal.min, channel.decimals)}</span>
                  <span>max {fmtChannelValue(signal.max, channel.decimals)}</span>
                </span>
              </button>
            )
          })}
          {visible.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">No channels match this filter.</div>
          )}
        </div>
      </div>
    </aside>
  )
}

function ChannelsHelpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null

  const sections = [
    {
      title: "Preset tabs",
      body: "Each preset groups related channels into a few larger graphs so you can diagnose a system without scrolling through every signal.",
    },
    {
      title: "Graph values",
      body: "Move the cursor across the plot to update the floating value HUD. Click a channel name in the HUD or Values panel to focus that line.",
    },
    {
      title: "Values panel",
      body: "Use the Values panel when the plot is busy. It keeps live cursor values, min, and max readable without covering the graph.",
    },
    {
      title: "Adjustments",
      body: "Focused lines still support the Analysis controls: Shift + wheel scales the line, Shift + drag moves it, and Reset clears plot adjustments.",
    },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Channels help">
      <div className="w-full max-w-2xl overflow-hidden rounded-xl border border-border bg-popover shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">Octane Channels</p>
            <h3 className="mt-1 text-lg font-semibold text-foreground">Using preset diagnostics</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close help"
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="grid gap-3 p-5 sm:grid-cols-2">
          {sections.map((section) => (
            <div key={section.title} className="rounded-lg border border-border bg-card/60 p-4">
              <h4 className="text-sm font-semibold text-foreground">{section.title}</h4>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{section.body}</p>
            </div>
          ))}
        </div>
        <div className="border-t border-border bg-card/50 px-5 py-3 text-xs text-muted-foreground">
          Shortcuts: `1-4` switch main views. In plots, `/` searches where available, `F` toggles fullscreen, and `Esc` clears focus or closes overlays.
        </div>
      </div>
    </div>
  )
}

function ChannelsPresetEditor({
  open,
  presets,
  groupsByPreset,
  activePresetId,
  defaultPresets,
  defaultGroupsByPreset,
  channels,
  templates,
  onSave,
  onSaveTemplate,
  onClose,
}: {
  open: boolean
  presets: ChannelPreset[]
  groupsByPreset: Record<string, ChannelPresetGroup[]>
  activePresetId: string
  defaultPresets: ChannelPreset[]
  defaultGroupsByPreset: Record<string, ChannelPresetGroup[]>
  channels: Channel[]
  templates: Template[]
  onSave: (presets: ChannelPreset[], groupsByPreset: Record<string, ChannelPresetGroup[]>) => void
  onSaveTemplate: (name: string, labels: string[]) => void
  onClose: () => void
}) {
  const importLayoutRef = useRef<HTMLInputElement>(null)
  const [draftPresets, setDraftPresets] = useState<ChannelPreset[]>([])
  const [draftGroupsByPreset, setDraftGroupsByPreset] = useState<Record<string, ChannelPresetGroup[]>>({})
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null)
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [selectedTemplateId, setSelectedTemplateId] = useState("")
  const savedSignature = useMemo(() => JSON.stringify({ presets: serializeChannelPresets(presets), groupsByPreset }), [groupsByPreset, presets])
  const draftSignature = useMemo(
    () => JSON.stringify({ presets: serializeChannelPresets(draftPresets), groupsByPreset: draftGroupsByPreset }),
    [draftGroupsByPreset, draftPresets],
  )
  const dirty = draftSignature !== savedSignature

  useEffect(() => {
    if (!open) return
    const nextPresets = cloneChannelPresets(serializeChannelPresets(presets))
    const nextGroups = clonePresetGroups(groupsByPreset)
    const nextPresetId = nextPresets.some((preset) => preset.id === activePresetId) ? activePresetId : nextPresets[0]?.id ?? null
    setDraftPresets(nextPresets)
    setDraftGroupsByPreset(nextGroups)
    setSelectedPresetId(nextPresetId)
    setActiveGroupId((nextPresetId && (nextGroups[nextPresetId]?.[0]?.id ?? defaultGroupsByPreset[nextPresetId]?.[0]?.id)) || null)
    setQuery("")
    setSelectedTemplateId("")
  }, [activePresetId, defaultGroupsByPreset, groupsByPreset, open, presets])

  useEffect(() => {
    if (!open) return
    if (!selectedPresetId || !draftPresets.some((preset) => preset.id === selectedPresetId)) {
      setSelectedPresetId(draftPresets[0]?.id ?? null)
      return
    }
    const preset = draftPresets.find((item) => item.id === selectedPresetId)
    const groups = draftGroupsByPreset[selectedPresetId] ?? (preset ? fallbackPresetGroups(preset, defaultGroupsByPreset) : [])
    if (!activeGroupId || !groups.some((group) => group.id === activeGroupId)) setActiveGroupId(groups[0]?.id ?? null)
  }, [activeGroupId, defaultGroupsByPreset, draftGroupsByPreset, draftPresets, open, selectedPresetId])

  useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }
    window.addEventListener("keydown", onKeyDown, true)
    return () => window.removeEventListener("keydown", onKeyDown, true)
  }, [onClose, open])

  if (!open) return null

  const selectedPreset = draftPresets.find((preset) => preset.id === selectedPresetId) ?? draftPresets[0] ?? null
  const selectedGroups = selectedPreset ? getGroupsForPreset(selectedPreset.id) : []
  const active = selectedGroups.find((group) => group.id === activeGroupId) ?? selectedGroups[0] ?? null
  const selectedTemplate = templates.find((template) => template.id === selectedTemplateId) ?? null
  const q = query.trim().toLowerCase()
  const filteredChannels = q
    ? channels.filter((channel) => channel.label.toLowerCase().includes(q) || channel.unit.toLowerCase().includes(q))
    : channels

  function fallbackGroupsForPreset(preset: ChannelPreset): ChannelPresetGroup[] {
    return fallbackPresetGroups(preset, defaultGroupsByPreset)
  }

  function getGroupsForPreset(presetId: string): ChannelPresetGroup[] {
    const saved = draftGroupsByPreset[presetId]
    if (saved?.length) return saved
    const preset = draftPresets.find((item) => item.id === presetId)
    return preset ? fallbackGroupsForPreset(preset) : []
  }

  function setGroupsForPreset(presetId: string, groups: ChannelPresetGroup[]) {
    setDraftGroupsByPreset((current) => ({ ...current, [presetId]: clonePresetGroupList(groups) }))
  }

  function resolveGroupLabels(preset: ChannelPreset | null, group: ChannelPresetGroup | null): string[] {
    if (!group) return []
    const labels: string[] = []
    const seen = new Set<string>()
    const add = (label: string) => {
      if (seen.has(label)) return
      seen.add(label)
      labels.push(label)
    }

    for (const label of group.labels) {
      const direct = channels.find((channel) => channel.label === label)
      if (direct) {
        add(direct.label)
        continue
      }
      const pattern = preset?.patterns.find((item) => item.label === label)
      if (pattern) {
        for (const channel of channels) {
          if (pattern.match.some((matcher) => matcher.test(channel.label))) add(channel.label)
        }
      }
    }
    return labels
  }

  function missingSavedLabels(preset: ChannelPreset | null, group: ChannelPresetGroup | null): string[] {
    if (!group) return []
    return group.labels.filter((label) => resolveGroupLabels(preset, { ...group, labels: [label] }).length === 0)
  }

  function allPresetLabels(preset: ChannelPreset | null, groups: ChannelPresetGroup[]): string[] {
    const labels: string[] = []
    const seen = new Set<string>()
    for (const group of groups) {
      for (const label of resolveGroupLabels(preset, group)) {
        if (seen.has(label)) continue
        seen.add(label)
        labels.push(label)
      }
    }
    return labels
  }

  const activeChannelLabels = new Set(resolveGroupLabels(selectedPreset, active))
  const missingLabels = missingSavedLabels(selectedPreset, active)

  function updateGroup(groupId: string, updater: (group: ChannelPresetGroup) => ChannelPresetGroup) {
    if (!selectedPreset) return
    setGroupsForPreset(
      selectedPreset.id,
      selectedGroups.map((group) => (group.id === groupId ? updater(group) : group)),
    )
  }

  function addGraph() {
    if (!selectedPreset) return
    const nextGroup = { id: makePresetGroupId(), title: `Graph ${selectedGroups.length + 1}`, labels: [] }
    setGroupsForPreset(selectedPreset.id, [...selectedGroups, nextGroup])
    setActiveGroupId(nextGroup.id)
  }

  function deleteGraph(groupId: string) {
    if (!selectedPreset) return
    const next = selectedGroups.filter((group) => group.id !== groupId)
    const finalGroups = next.length ? next : [{ id: makePresetGroupId(), title: "Graph 1", labels: [] }]
    setGroupsForPreset(selectedPreset.id, finalGroups)
    setActiveGroupId(finalGroups[0]?.id ?? null)
  }

  function toggleChannel(label: string) {
    if (!active || !selectedPreset) return
    const expanded = resolveGroupLabels(selectedPreset, active)
    const nextLabels = activeChannelLabels.has(label) ? expanded.filter((item) => item !== label) : [...expanded, label]
    updateGroup(active.id, (group) => ({ ...group, labels: nextLabels }))
  }

  function removeSavedLabel(label: string) {
    if (!active) return
    updateGroup(active.id, (group) => ({ ...group, labels: group.labels.filter((item) => item !== label) }))
  }

  function selectPreset(presetId: string) {
    const groups = getGroupsForPreset(presetId)
    setSelectedPresetId(presetId)
    setActiveGroupId(groups[0]?.id ?? null)
    setQuery("")
  }

  function updatePresetName(name: string) {
    if (!selectedPreset) return
    setDraftPresets((current) => current.map((preset) => (preset.id === selectedPreset.id ? { ...preset, name } : preset)))
  }

  function addPreset() {
    const nextPreset = { id: makeChannelPresetId(), name: `Custom preset ${draftPresets.length + 1}`, patterns: [] }
    const nextGroup = { id: makePresetGroupId(), title: "Graph 1", labels: [] }
    setDraftPresets((current) => [...current, nextPreset])
    setDraftGroupsByPreset((current) => ({ ...current, [nextPreset.id]: [nextGroup] }))
    setSelectedPresetId(nextPreset.id)
    setActiveGroupId(nextGroup.id)
  }

  function addPresetFromTemplate() {
    if (!selectedTemplate) return
    const nextPreset = { id: makeChannelPresetId(), name: selectedTemplate.name, patterns: [] }
    const nextGroup = { id: makePresetGroupId(), title: selectedTemplate.name, labels: [...selectedTemplate.channels] }
    setDraftPresets((current) => [...current, nextPreset])
    setDraftGroupsByPreset((current) => ({ ...current, [nextPreset.id]: [nextGroup] }))
    setSelectedPresetId(nextPreset.id)
    setActiveGroupId(nextGroup.id)
  }

  function deletePreset(presetId: string) {
    if (draftPresets.length <= 1) return
    const nextPresets = draftPresets.filter((preset) => preset.id !== presetId)
    const nextGroups = { ...draftGroupsByPreset }
    delete nextGroups[presetId]
    setDraftPresets(nextPresets)
    setDraftGroupsByPreset(nextGroups)
    if (selectedPresetId === presetId) {
      setSelectedPresetId(nextPresets[0]?.id ?? null)
      setActiveGroupId(nextGroups[nextPresets[0]?.id ?? ""]?.[0]?.id ?? null)
    }
  }

  function movePreset(presetId: string, direction: -1 | 1) {
    setDraftPresets((current) => {
      const index = current.findIndex((preset) => preset.id === presetId)
      const nextIndex = index + direction
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current
      const next = [...current]
      const [item] = next.splice(index, 1)
      next.splice(nextIndex, 0, item)
      return next
    })
  }

  function resetDraft() {
    if (!selectedPreset) return
    const defaultPreset = defaultPresets.find((preset) => preset.id === selectedPreset.id)
    const nextGroups = defaultPreset ? clonePresetGroupList(defaultGroupsByPreset[selectedPreset.id] ?? fallbackGroupsForPreset(defaultPreset)) : [{ id: makePresetGroupId(), title: "Graph 1", labels: [] }]
    setDraftPresets((current) => current.map((preset) => (preset.id === selectedPreset.id && defaultPreset ? { ...defaultPreset } : preset)))
    setGroupsForPreset(selectedPreset.id, nextGroups)
    setActiveGroupId(nextGroups[0]?.id ?? null)
    setQuery("")
  }

  function resetAllDefaults() {
    const nextPresets = cloneChannelPresets()
    const nextGroups = clonePresetGroups()
    setDraftPresets(nextPresets)
    setDraftGroupsByPreset(nextGroups)
    setSelectedPresetId(nextPresets[0]?.id ?? null)
    setActiveGroupId(nextGroups[nextPresets[0]?.id ?? ""]?.[0]?.id ?? null)
    setQuery("")
  }

  function addTemplateToGraph() {
    if (!active || !selectedTemplate) return
    updateGroup(active.id, (group) => ({ ...group, labels: [...new Set([...group.labels, ...selectedTemplate.channels])] }))
  }

  function saveCurrentPresetAsTemplate() {
    if (!selectedPreset) return
    const labels = allPresetLabels(selectedPreset, selectedGroups)
    onSaveTemplate(`${selectedPreset.name} channels`, labels)
  }

  async function importChannelsLayout(file: File) {
    const imported = parseImportedChannelWorkspace(await file.text())
    if (!imported) return
    const nextPresets = imported.presets.length ? imported.presets : cloneChannelPresets()
    setDraftPresets(nextPresets)
    setDraftGroupsByPreset(imported.groupsByPreset)
    setSelectedPresetId(nextPresets[0]?.id ?? null)
    setActiveGroupId(imported.groupsByPreset[nextPresets[0]?.id ?? ""]?.[0]?.id ?? null)
    setQuery("")
  }

  function exportChannelsLayout() {
    const blob = new Blob([serializeChannelWorkspace(draftPresets, draftGroupsByPreset)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "octane-channels-layout.json"
    a.click()
    URL.revokeObjectURL(url)
  }

  function saveDraft() {
    const nextPresets = draftPresets.length ? draftPresets : cloneChannelPresets()
    const presetIds = new Set(nextPresets.map((preset) => preset.id))
    const nextGroups: Record<string, ChannelPresetGroup[]> = {}
    for (const preset of nextPresets) {
      const groups = draftGroupsByPreset[preset.id] ?? fallbackGroupsForPreset(preset)
      nextGroups[preset.id] = clonePresetGroupList(groups.length ? groups : [{ id: makePresetGroupId(), title: "Graph 1", labels: [] }])
    }
    for (const [presetId, groups] of Object.entries(draftGroupsByPreset)) {
      if (presetIds.has(presetId)) nextGroups[presetId] = clonePresetGroupList(groups)
    }
    onSave(nextPresets, nextGroups)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Edit channels presets">
      <div className="flex max-h-[min(90dvh,54rem)] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">Channels Layout Manager</p>
            <h3 className="mt-1 text-lg font-semibold text-foreground">Presets, graphs, and dock templates</h3>
            <p className="mt-1 text-sm text-muted-foreground">Edit every Channels preset, control how many graphs each one has, and pull channel sets from the dock templates.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cancel channels edits"
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-[16rem_17rem_minmax(0,1fr)]">
          <aside className="flex min-h-0 flex-col border-r border-border bg-card/35">
            <input
              ref={importLayoutRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void importChannelsLayout(file)
                event.target.value = ""
              }}
            />
            <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Presets</span>
              <button
                type="button"
                onClick={addPreset}
                className="inline-flex size-7 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                aria-label="Add preset"
                title="Add preset"
              >
                <Plus className="size-3.5" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {draftPresets.map((item, index) => (
                <div
                  key={item.id}
                  className={cn(
                    "mb-1.5 flex items-center gap-1 rounded-md border px-2 py-1.5 transition-colors",
                    selectedPreset?.id === item.id ? "border-primary bg-primary/15 text-foreground" : "border-transparent bg-card/50 text-muted-foreground hover:border-border hover:text-foreground",
                  )}
                >
                  <button type="button" onClick={() => selectPreset(item.id)} className="min-w-0 flex-1 text-left">
                    <span className="block truncate text-sm font-medium">{item.name || `Preset ${index + 1}`}</span>
                    <span className="font-mono text-[10px] opacity-70">{getGroupsForPreset(item.id).length} graphs</span>
                  </button>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => movePreset(item.id, -1)}
                      disabled={index === 0}
                      className="rounded px-1 text-[11px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-30"
                      aria-label={`Move ${item.name} up`}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => movePreset(item.id, 1)}
                      disabled={index === draftPresets.length - 1}
                      className="rounded px-1 text-[11px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-30"
                      aria-label={`Move ${item.name} down`}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => deletePreset(item.id)}
                      disabled={draftPresets.length <= 1}
                      className="inline-flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-30"
                      aria-label={`Delete ${item.name}`}
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="border-t border-border p-2">
              <div className="mb-2 grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => importLayoutRef.current?.click()}
                  className="inline-flex items-center justify-center gap-1 rounded-md border border-border bg-card px-2 py-2 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                  title="Import a Channels layout JSON file"
                >
                  <Upload className="size-3" />
                  Import
                </button>
                <button
                  type="button"
                  onClick={exportChannelsLayout}
                  className="inline-flex items-center justify-center gap-1 rounded-md border border-border bg-card px-2 py-2 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                  title="Export this Channels layout as JSON"
                >
                  <Download className="size-3" />
                  Export
                </button>
              </div>
              <button
                type="button"
                onClick={resetAllDefaults}
                className="w-full rounded-md border border-border bg-card px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                Reset all defaults
              </button>
            </div>
          </aside>

          <aside className="flex min-h-0 flex-col border-r border-border bg-card/20">
            <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Graphs</span>
              <button
                type="button"
                onClick={addGraph}
                className="inline-flex size-7 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                aria-label="Add graph"
                title="Add graph"
              >
                <Plus className="size-3.5" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {selectedGroups.map((group, index) => (
                <button
                  key={group.id}
                  type="button"
                  onClick={() => setActiveGroupId(group.id)}
                  className={cn(
                    "mb-1.5 flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left transition-colors",
                    active?.id === group.id ? "border-primary bg-primary/15 text-foreground" : "border-transparent bg-card/50 text-muted-foreground hover:border-border hover:text-foreground",
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{group.title || `Graph ${index + 1}`}</span>
                    <span className="font-mono text-[10px] opacity-70">{resolveGroupLabels(selectedPreset, group).length} matched ch</span>
                  </span>
                </button>
              ))}
            </div>
            <div className="flex shrink-0 flex-col gap-2 border-t border-border p-2">
              <button
                type="button"
                onClick={resetDraft}
                disabled={!selectedPreset}
                className="w-full rounded-md border border-border bg-card px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40"
              >
                Reset selected preset
              </button>
              <div className="rounded-lg border border-border bg-background/35 p-2">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Dock templates</p>
                <select
                  value={selectedTemplateId}
                  onChange={(event) => setSelectedTemplateId(event.target.value)}
                  className="h-8 w-full rounded-md border border-border bg-card px-2 text-xs text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
                >
                  <option value="">Select template</option>
                  {templates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name} ({template.channels.length})
                    </option>
                  ))}
                </select>
                <div className="mt-2 grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={addTemplateToGraph}
                    disabled={!selectedTemplate || !active}
                    className="rounded-md border border-border bg-card px-2 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40"
                  >
                    Add to graph
                  </button>
                  <button
                    type="button"
                    onClick={addPresetFromTemplate}
                    disabled={!selectedTemplate}
                    className="rounded-md border border-border bg-card px-2 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40"
                  >
                    New preset
                  </button>
                </div>
                <button
                  type="button"
                  onClick={saveCurrentPresetAsTemplate}
                  disabled={!selectedPreset || allPresetLabels(selectedPreset, selectedGroups).length === 0}
                  className="mt-1.5 w-full rounded-md border border-border bg-card px-2 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40"
                >
                  Save preset to dock
                </button>
              </div>
            </div>
          </aside>

          <div className="flex min-h-0 flex-col">
            {selectedPreset && active ? (
              <>
                <div className="grid shrink-0 gap-2 border-b border-border px-4 py-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                  <input
                    value={selectedPreset.name}
                    onChange={(event) => updatePresetName(event.target.value)}
                    className="h-9 min-w-0 rounded-md border border-border bg-card px-3 text-sm font-semibold text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
                    aria-label="Preset name"
                  />
                  <input
                    value={active.title}
                    onChange={(event) => updateGroup(active.id, (group) => ({ ...group, title: event.target.value }))}
                    className="h-9 min-w-0 flex-1 rounded-md border border-border bg-card px-3 text-sm text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
                    aria-label="Graph name"
                  />
                  <button
                    type="button"
                    onClick={() => deleteGraph(active.id)}
                    className="inline-flex size-9 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                    aria-label="Delete graph"
                    title="Delete graph"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>

                <div className="shrink-0 border-b border-border px-4 py-3">
                  <div className="flex flex-col gap-2">
                  <div className="relative max-w-md">
                    <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Search channels to add..."
                      className="h-9 w-full rounded-md border border-border bg-card pl-9 pr-9 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/30"
                    />
                    {query && (
                      <button
                        type="button"
                        onClick={() => setQuery("")}
                        aria-label="Clear search"
                        className="absolute right-2 top-1/2 inline-flex size-5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-secondary hover:text-foreground"
                      >
                        <X className="size-3" />
                      </button>
                    )}
                  </div>
                  {missingLabels.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Saved, missing in this log</span>
                      {missingLabels.map((label) => (
                        <button
                          key={label}
                          type="button"
                          onClick={() => removeSavedLabel(label)}
                          className="inline-flex items-center gap-1 rounded border border-border bg-card px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                          title={`Remove ${label}`}
                        >
                          {label}
                          <X className="size-2.5" />
                        </button>
                      ))}
                    </div>
                  )}
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto p-3">
                  <div className="grid gap-1.5 md:grid-cols-2">
                    {filteredChannels.map((channel) => {
                      const checked = activeChannelLabels.has(channel.label)
                      return (
                        <button
                          key={channel.key}
                          type="button"
                          onClick={() => toggleChannel(channel.label)}
                          aria-pressed={checked}
                          className={cn(
                            "flex min-w-0 items-center gap-2 rounded-md border px-3 py-2 text-left transition-colors",
                            checked ? "border-primary bg-primary/15 text-foreground" : "border-border bg-card/45 text-muted-foreground hover:bg-secondary hover:text-foreground",
                          )}
                        >
                          <span className={cn("flex size-4 shrink-0 items-center justify-center rounded border", checked ? "border-primary bg-primary" : "border-border")}>
                            {checked && <span className="size-1.5 rounded-[1px] bg-primary-foreground" />}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-sm" title={channel.label}>{channel.label}</span>
                          <span className="shrink-0 font-mono text-[10px] opacity-70">{channel.unit}</span>
                        </button>
                      )
                    })}
                  </div>
                  {filteredChannels.length === 0 && (
                    <div className="px-4 py-10 text-center text-sm text-muted-foreground">No channels match this search.</div>
                  )}
                </div>
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Add a preset and graph to start editing Channels.</div>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-col gap-3 border-t border-border bg-card/35 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">
            {dirty ? "Unsaved Channels workspace changes are staged in this window." : "Channels presets match the saved layout on this PC."}
          </p>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 items-center justify-center rounded-md border border-border bg-card px-3 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={saveDraft}
              className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Save channels
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function AnnotationFloat({
  annotations,
  timeUnit,
  onRemove,
  onJump,
}: {
  annotations: Annotation[]
  timeUnit: string
  onRemove: (id: string) => void
  onJump: (t: number) => void
}) {
  return (
    <div className="pointer-events-none fixed bottom-24 right-4 z-30 hidden w-64 xl:block">
      <div className="pointer-events-auto rounded-xl border border-border bg-popover/95 p-3 shadow-xl backdrop-blur">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Annotations · {annotations.length}
        </h3>
        <ul className="flex max-h-48 flex-col divide-y divide-border overflow-y-auto">
          {annotations.map((a) => (
            <li key={a.id} className="flex items-start gap-2 py-1.5">
              <span className="mt-1 size-2 shrink-0 rounded-full" style={{ backgroundColor: colorForType(a.type) }} />
              <button
                type="button"
                onClick={() => onJump(a.t)}
                title="Jump to this mark"
                className="flex min-w-0 flex-1 flex-col text-left"
              >
                <span className="font-mono text-[11px] tabular-nums text-foreground">
                  {a.t.toFixed(2)}
                  {timeUnit} · <span className="capitalize text-muted-foreground">{a.type}</span>
                </span>
                {a.note && <span className="truncate text-[11px] text-muted-foreground">{a.note}</span>}
              </button>
              <button
                type="button"
                onClick={() => onRemove(a.id)}
                aria-label="Delete annotation"
                className="ml-auto rounded px-1 text-[11px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
