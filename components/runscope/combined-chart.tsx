"use client"

import { memo, useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react"
import {
  ChevronLeft,
  ChevronRight,
  Columns2,
  Maximize2,
  Minimize2,
  MousePointerClick,
  PanelRightOpen,
  Plus,
  RefreshCw,
  RotateCcw,
  Rows2,
  ScanSearch,
  Search,
  SlidersHorizontal,
  Trash2,
  TrendingUp,
  X,
} from "lucide-react"
import { Area, AreaChart, CartesianGrid, ReferenceDot, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from "recharts"
import { lttb } from "@/lib/downsample"
import { cn } from "@/lib/utils"
import { plotColor } from "@/lib/palette"
import { matchesKey, useBindings } from "@/lib/keybindings"
import { colorForType, type Annotation } from "@/lib/annotations"
import type { Template } from "@/lib/templates"
import type { ChartSeries } from "./signal-chart"
import type { DisplaySettings } from "./display-panel"

const RENDER_POINTS = 700
const PLOT_TOP = 10
const AXIS_H = 28
const LEFT = 56
const RIGHT = 16
const GAIN_MIN = 0.2
const GAIN_MAX = 20
const MOBILE_ANALYSIS_MAX_CHANNELS = 6

type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void
}

type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null
  webkitExitFullscreen?: () => Promise<void> | void
}

export interface Transform {
  gain: number
  offset: number
}

interface CombinedChartProps {
  series: ChartSeries[]
  availableSeries?: ChartSeries[]
  presetGroups?: PaneGroup[]
  panelTitle?: string
  workbench?: boolean
  domain: [number, number]
  sync: boolean
  cursorT: number | null
  display: DisplaySettings
  timeUnit: string
  annotations: Annotation[]
  annotateMode: boolean
  transforms: Record<string, Transform>
  setTransforms: Dispatch<SetStateAction<Record<string, Transform>>>
  focusKey: string | null
  setFocusKey: Dispatch<SetStateAction<string | null>>
  markPeaks: boolean
  setMarkPeaks: Dispatch<SetStateAction<boolean>>
  split: boolean
  setSplit: Dispatch<SetStateAction<boolean>>
  plotAssign: Record<string, 0 | 1>
  setPlotAssign: Dispatch<SetStateAction<Record<string, 0 | 1>>>
  readoutPicking?: boolean
  onReadoutPickingChange?: (enabled: boolean) => void
  modalOpen: boolean
  onCursorChange: (t: number | null) => void
  onAddAnnotation: (t: number, channel: string) => void
  onFitWindow?: () => void
  onResetPlot?: () => void
  timelineSlot?: ReactNode
  templates?: Template[]
  onApplyTemplate?: (template: Template) => void
  onToggleChannelLabel?: (label: string) => void
}

function fmt(v: number, decimals: number) {
  return v.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}
function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v))
}
function nearest(data: ChartSeries["signal"]["data"], t: number) {
  let best = data[0]
  let bestDist = Infinity
  for (const d of data) {
    const dist = Math.abs(d.t - t)
    if (dist < bestDist) {
      bestDist = dist
      best = d
    }
  }
  return best
}
function sampleAt(data: ChartSeries["signal"]["data"], t: number): { t: number; value: number | null } | null {
  if (!data.length) return null
  if (t <= data[0].t) return data[0]
  const last = data[data.length - 1]
  if (t >= last.t) return last

  let lo = 0
  let hi = data.length - 1
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2)
    const mt = data[mid].t
    if (mt === t) return data[mid]
    if (mt < t) lo = mid + 1
    else hi = mid - 1
  }

  const left = data[Math.max(0, hi)]
  const right = data[Math.min(data.length - 1, lo)]
  if (left.value == null || right.value == null || right.t === left.t) return nearest(data, t)
  const ratio = (t - left.t) / (right.t - left.t)
  return { t, value: left.value + (right.value - left.value) * ratio }
}
function applyTf(v: number | null, t: Transform): number | null {
  if (v == null) return null
  return (v - 0.5) * t.gain + 0.5 + t.offset
}

interface Peak {
  label: string
  t: number
  value: number
  norm: number
  unit: string
  decimals: number
  color: string
}

type ReadoutMode = "none" | "pane" | "ghost"

export interface PaneGroup {
  id: string
  title: string
  series: ChartSeries[]
}

interface EditableGroup {
  id: string
  name: string
  labels: string[]
}

type AnalysisTab = "standard" | "groups"

const GROUPS_STORAGE_KEY = "octane:analysis-groups:v1"

const STACK_RULES: { id: string; title: string; patterns: RegExp[] }[] = [
  {
    id: "engine",
    title: "Engine",
    patterns: [/engine/i, /\brpm\b/i, /gear/i, /vehicle speed/i, /throttle/i, /accelerator/i, /atmospheric/i],
  },
  {
    id: "boost",
    title: "Boost",
    patterns: [/boost/i, /manifold/i, /\bmap\b/i, /wastegate/i, /\bwg\b/i, /absolute pressure/i, /desired boost/i],
  },
  {
    id: "fuel",
    title: "Fuel",
    patterns: [/fuel/i, /\bafr\b/i, /lambda/i, /ethanol/i, /injector/i, /trim/i, /rail pressure/i],
  },
  {
    id: "ignition",
    title: "Ignition",
    patterns: [/ignition/i, /timing/i, /spark/i, /knock/i, /advance/i],
  },
  {
    id: "temperature",
    title: "Temps",
    patterns: [/temperature/i, /\biat\b/i, /coolant/i, /oil temp/i, /\begt\b/i, /exhaust gas/i],
  },
  {
    id: "drivetrain",
    title: "Drivetrain",
    patterns: [/traction/i, /trans/i, /wheel/i, /clutch/i, /torque/i, /slip/i, /\b4wd\b/i],
  },
  {
    id: "electrical",
    title: "Electrical",
    patterns: [/voltage/i, /battery/i, /sensor voltage/i],
  },
]

function buildStackPanes(series: ChartSeries[]): PaneGroup[] {
  const buckets = new Map<string, PaneGroup>()
  for (const rule of STACK_RULES) buckets.set(rule.id, { id: rule.id, title: rule.title, series: [] })
  const other: PaneGroup = { id: "other", title: "Other", series: [] }

  for (const item of series) {
    const label = item.signal.label
    const rule = STACK_RULES.find((candidate) => candidate.patterns.some((pattern) => pattern.test(label)))
    ;(rule ? buckets.get(rule.id)! : other).series.push(item)
  }

  const panes = [...buckets.values(), other].filter((pane) => pane.series.length > 0)
  if (panes.length <= 1 && series.length > 4) {
    const chunked: PaneGroup[] = []
    for (let i = 0; i < series.length; i += 4) {
      chunked.push({ id: `group-${i / 4}`, title: `Group ${i / 4 + 1}`, series: series.slice(i, i + 4) })
    }
    return chunked
  }
  return panes
}

function makeGroupId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID()
  return `group-${Date.now().toString(36)}-${Math.floor(Math.random() * 10000).toString(36)}`
}

function seedEditableGroups(source: ChartSeries[]): EditableGroup[] {
  const panes = buildStackPanes(source)
  return panes.map((pane) => ({
    id: pane.id,
    name: pane.title,
    labels: pane.series.map((item) => item.signal.label),
  }))
}

function normalizeGroups(value: unknown): EditableGroup[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is { id?: unknown; name?: unknown; labels?: unknown } => !!item && typeof item === "object")
    .filter((item): item is { id?: unknown; name: string; labels: unknown[] } => typeof item.name === "string" && Array.isArray(item.labels))
    .map((item) => ({
      id: typeof item.id === "string" ? item.id : makeGroupId(),
      name: item.name.trim() || "Group",
      labels: item.labels.filter((label): label is string => typeof label === "string"),
    }))
}

function loadStoredGroups(): EditableGroup[] {
  if (typeof window === "undefined") return []
  try {
    return normalizeGroups(JSON.parse(window.localStorage.getItem(GROUPS_STORAGE_KEY) ?? "[]"))
  } catch {
    return []
  }
}

function saveStoredGroups(groups: EditableGroup[]) {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(GROUPS_STORAGE_KEY, JSON.stringify(groups))
  } catch {
    /* ignore storage failures */
  }
}

function unitText(unit: string): string {
  const trimmed = unit.trim()
  if (!trimmed || trimmed === "-" || trimmed === "--" || trimmed.toLowerCase() === "n/a" || trimmed.charCodeAt(0) === 8212) return ""
  return ` ${trimmed}`
}

function CombinedChartImpl({
  series,
  availableSeries,
  presetGroups,
  panelTitle = "Analysis Plot",
  workbench = false,
  domain,
  sync,
  cursorT,
  display,
  timeUnit,
  annotations,
  annotateMode,
  transforms,
  setTransforms,
  focusKey,
  setFocusKey,
  markPeaks,
  setMarkPeaks,
  split,
  setSplit,
  plotAssign,
  setPlotAssign,
  readoutPicking = true,
  onReadoutPickingChange,
  modalOpen,
  onCursorChange,
  onAddAnnotation,
  onFitWindow,
  onResetPlot,
  timelineSlot,
  templates = [],
  onApplyTemplate,
  onToggleChannelLabel,
}: CombinedChartProps) {
  const allSeries = availableSeries ?? series
  const presetMode = presetGroups !== undefined
  const [highlightKey, setHighlightKey] = useState<string | null>(null)
  const [hoverKey, setHoverKey] = useState<string | null>(null)
  const [dockOpen, setDockOpen] = useState(true)
  const [fullscreen, setFullscreen] = useState(false)
  const [browserFullscreen, setBrowserFullscreen] = useState(false)
  const [mobilePlot, setMobilePlot] = useState(true)
  const [mobileLandscapeTight, setMobileLandscapeTight] = useState(false)
  const [mobileAutoFullscreen, setMobileAutoFullscreen] = useState(false)
  const [mobileAutoSuppressed, setMobileAutoSuppressed] = useState(false)
  const [analysisTab, setAnalysisTab] = useState<AnalysisTab>("standard")
  const [groups, setGroups] = useState<EditableGroup[]>([])
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null)
  const [groupEditorOpen, setGroupEditorOpen] = useState(true)
  const [groupsLoaded, setGroupsLoaded] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  // Plot quick-search ("/"): filter the dock; Enter focuses the match, then it hides.
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState("")
  const plotRef = useRef<HTMLElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const bindings = useBindings()

  useEffect(() => {
    const media = window.matchMedia("(max-width: 1023px)")
    const syncDock = () => setDockOpen(!media.matches)
    syncDock()
    media.addEventListener("change", syncDock)
    return () => media.removeEventListener("change", syncDock)
  }, [])

  useEffect(() => {
    const syncViewport = () => {
      const width = window.innerWidth
      const height = window.innerHeight
      const mobile = width <= 1023
      setMobilePlot(mobile)
      setMobileLandscapeTight(mobile && width > height && height <= 540)
    }
    syncViewport()
    window.addEventListener("resize", syncViewport)
    window.addEventListener("orientationchange", syncViewport)
    return () => {
      window.removeEventListener("resize", syncViewport)
      window.removeEventListener("orientationchange", syncViewport)
    }
  }, [])

  useEffect(() => {
    const doc = document as FullscreenDocument
    const syncFullscreen = () => setBrowserFullscreen(Boolean(document.fullscreenElement ?? doc.webkitFullscreenElement))
    syncFullscreen()
    document.addEventListener("fullscreenchange", syncFullscreen)
    document.addEventListener("webkitfullscreenchange", syncFullscreen)
    return () => {
      document.removeEventListener("fullscreenchange", syncFullscreen)
      document.removeEventListener("webkitfullscreenchange", syncFullscreen)
    }
  }, [])

  useEffect(() => {
    if (!mobilePlot || !mobileLandscapeTight) {
      setMobileAutoSuppressed(false)
      if (mobileAutoFullscreen) {
        setMobileAutoFullscreen(false)
        setFullscreen(false)
      }
      return
    }
    if (!fullscreen && !mobileAutoSuppressed) {
      setDockOpen(false)
      setMobileAutoFullscreen(true)
      setFullscreen(true)
    }
  }, [fullscreen, mobileAutoFullscreen, mobileAutoSuppressed, mobileLandscapeTight, mobilePlot])

  const labels = series.map((s) => s.signal.label)
  const visibleLabels = useMemo(() => new Set(series.map((s) => s.signal.label)), [series])
  const colorOf = useMemo(() => {
    const m: Record<string, string> = {}
    allSeries.forEach((s, i) => (m[s.signal.label] = plotColor(i)))
    return m
  }, [allSeries])
  const seriesByLabel = useMemo(() => {
    const m: Record<string, ChartSeries> = {}
    allSeries.forEach((s) => (m[s.signal.label] = s))
    return m
  }, [allSeries])
  useEffect(() => {
    if (!allSeries.length || groupsLoaded) return
    const stored = loadStoredGroups()
    const next = stored.length ? stored : seedEditableGroups(allSeries)
    setGroups(next)
    setActiveGroupId(next[0]?.id ?? null)
    setGroupsLoaded(true)
  }, [allSeries, groupsLoaded])

  useEffect(() => {
    if (!groups.length) return
    if (!activeGroupId || !groups.some((group) => group.id === activeGroupId)) setActiveGroupId(groups[0].id)
  }, [activeGroupId, groups])

  function updateGroups(updater: (current: EditableGroup[]) => EditableGroup[]) {
    setGroups((current) => {
      const next = updater(current)
      saveStoredGroups(next)
      return next
    })
  }

  // Lines targeted by scale/move gestures: the multi-selection, else the focused line.
  const targetLabels = (): string[] => (selected.size ? [...selected] : focusKey ? [focusKey] : [])

  function applyGain(factor: number) {
    const targets = targetLabels()
    if (!targets.length) return
    setTransforms((prev) => {
      const next = { ...prev }
      for (const l of targets) {
        const t = next[l] ?? { gain: 1, offset: 0 }
        next[l] = { ...t, gain: +clamp(t.gain * factor, GAIN_MIN, GAIN_MAX).toFixed(3) }
      }
      return next
    })
  }
  function applyOffset(delta: number) {
    const targets = targetLabels()
    if (!targets.length) return
    setTransforms((prev) => {
      const next = { ...prev }
      for (const l of targets) {
        const t = next[l] ?? { gain: 1, offset: 0 }
        next[l] = { ...t, offset: +(t.offset + delta).toFixed(3) }
      }
      return next
    })
  }
  function resetTransform(label: string) {
    setTransforms((prev) => {
      const next = { ...prev }
      delete next[label]
      return next
    })
  }
  function toggleSelected(label: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(label)) next.delete(label)
      else next.add(label)
      return next
    })
  }
  function pickLine(label: string) {
    setFocusKey(label)
    setHighlightKey(label)
    setSelected(new Set([label]))
  }
  // Send the targeted lines to the other plot (enabling split).
  function moveTargetsToOtherPlot() {
    if (mobilePlot || presetMode) return
    const targets = targetLabels()
    if (!targets.length) return
    setAnalysisTab("standard")
    setSplit(true)
    const ref = focusKey ?? targets[0]
    const dest: 0 | 1 = (plotAssign[ref] ?? 0) === 1 ? 0 : 1
    setPlotAssign((prev) => {
      const next = { ...prev }
      for (const l of targets) next[l] = dest
      return next
    })
    // Clear the multi-selection once moved — the gesture is complete.
    setSelected(new Set())
  }
  async function requestBrowserFullscreen() {
    const el = plotRef.current as FullscreenElement | null
    if (!el) return
    try {
      if (el.requestFullscreen) await el.requestFullscreen()
      else await el.webkitRequestFullscreen?.()
    } catch {
      // Mobile browsers can reject fullscreen unless it follows a trusted tap.
      // The in-app fullscreen state still gives the user the larger plot.
    }
  }

  async function exitBrowserFullscreen() {
    const doc = document as FullscreenDocument
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else if (doc.webkitFullscreenElement) await doc.webkitExitFullscreen?.()
    } catch {
      /* keep the in-app state authoritative */
    }
  }

  function toggleFullscreen() {
    const next = !fullscreen
    if (next) {
      setMobileAutoSuppressed(false)
      setMobileAutoFullscreen(false)
      if (mobilePlot) {
        setDockOpen(false)
        void requestBrowserFullscreen()
      }
      setFullscreen(true)
      return
    }

    if (mobilePlot && mobileLandscapeTight) setMobileAutoSuppressed(true)
    setMobileAutoFullscreen(false)
    setFullscreen(false)
    if (browserFullscreen) void exitBrowserFullscreen()
  }

  function resetPlotSurface() {
    setHighlightKey(null)
    setHoverKey(null)
    setSelected(new Set())
    setSearchOpen(false)
    setQuery("")
    if (!presetMode) setDockOpen(!mobilePlot)
    onResetPlot?.()
  }

  // Windowed peak of the highlighted line.
  const peak = useMemo<Peak | null>(() => {
    if (!markPeaks || !highlightKey) return null
    const s = seriesByLabel[highlightKey]
    if (!s) return null
    const [lo, hi] = domain
    let bt: number | null = null
    let bv = -Infinity
    for (const d of s.signal.data) {
      if (d.value == null || !Number.isFinite(d.value)) continue
      if (d.t < lo || d.t > hi) continue
      if (d.value > bv) {
        bv = d.value
        bt = d.t
      }
    }
    if (bt == null) return null
    const range = s.signal.max - s.signal.min || 1
    return {
      label: highlightKey,
      t: bt,
      value: bv,
      norm: (bv - s.signal.min) / range,
      unit: s.signal.unit,
      decimals: s.signal.decimals,
      color: colorOf[highlightKey],
    }
  }, [markPeaks, highlightKey, seriesByLabel, domain, colorOf])

  const shownAnnotations = useMemo(() => annotations.filter((a) => !a.channel), [annotations])

  function cycleFocus(dir: number) {
    if (!labels.length) return
    setFocusKey((prev) => {
      const idx = prev ? labels.indexOf(prev) : -1
      return labels[(idx + dir + labels.length) % labels.length]
    })
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return
      if (matchesKey(e, bindings.focusNext)) {
        e.preventDefault()
        cycleFocus(1)
      } else if (matchesKey(e, bindings.focusPrev)) {
        e.preventDefault()
        cycleFocus(-1)
      } else if (matchesKey(e, bindings.selectLine)) {
        e.preventDefault()
        if (focusKey) toggleSelected(focusKey)
      } else if (matchesKey(e, bindings.movePlot)) {
        e.preventDefault()
        moveTargetsToOtherPlot()
      } else if (matchesKey(e, bindings.peakToggle)) {
        e.preventDefault()
        setMarkPeaks((v) => !v)
      } else if (matchesKey(e, bindings.fullscreen)) {
        e.preventDefault()
        toggleFullscreen()
      } else if (matchesKey(e, bindings.quickSearch)) {
        if (presetMode) return
        e.preventDefault()
        setSearchOpen(true)
        setDockOpen(true)
        setTimeout(() => searchRef.current?.focus(), 0)
      } else if (e.key === "Escape") {
        if (modalOpen) return // a dialog is open — let the dashboard close it first
        if (fullscreen) toggleFullscreen()
        else {
          setFocusKey(null)
          setSelected(new Set())
        }
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [series, bindings, fullscreen, modalOpen, focusKey, selected, plotAssign, mobilePlot, presetMode]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (markPeaks && focusKey) setHighlightKey(focusKey)
  }, [focusKey, markPeaks])

  useEffect(() => {
    if (!mobilePlot) return
    if (split) setSplit(false)
    if (analysisTab !== "standard") setAnalysisTab("standard")
    setMarkPeaks(false)
    setPlotAssign((prev) => (Object.keys(prev).length ? {} : prev))
  }, [analysisTab, mobilePlot, split, setMarkPeaks, setPlotAssign, setSplit])

  const groupMode = presetMode || analysisTab === "groups"
  const manualSplit = !presetMode && analysisTab === "standard" && split && !mobilePlot
  const groupPaneGroups = useMemo<PaneGroup[]>(
    () =>
      groups
        .map((group) => ({
          id: group.id,
          title: group.name,
          series: group.labels.map((label) => seriesByLabel[label]).filter((item): item is ChartSeries => Boolean(item)),
        }))
        .filter((group) => group.series.length > 0),
    [groups, seriesByLabel],
  )

  // Partition series into panes.
  const paneOf = (label: string): 0 | 1 => (manualSplit ? (plotAssign[label] ?? 0) : 0)
  const paneGroups: PaneGroup[] = presetMode
    ? presetGroups
    : groupMode
      ? groupPaneGroups
    : manualSplit
      ? [
          { id: "plot-1", title: "Plot 1", series: series.filter((s) => paneOf(s.signal.label) === 0) },
          { id: "plot-2", title: "Plot 2", series: series.filter((s) => paneOf(s.signal.label) === 1) },
        ]
      : [{ id: "overlay", title: "Overlay", series }]

  function paneAxisLabel(paneSeries: ChartSeries[]): string | null {
    if (focusKey && paneSeries.some((s) => s.signal.label === focusKey)) return focusKey
    return paneSeries[0]?.signal.label ?? null
  }
  // Panes always fill available height (windowed too) so the plot isn't a tiny
  // strip on a big screen; split simply halves the space. Min keeps it usable small.
  const paneHeight = (count: number) =>
    workbench && groupMode && count <= 3
      ? "min-h-[15rem] flex-1"
      : workbench && groupMode
        ? "min-h-[13rem] shrink-0"
      : groupMode
      ? "min-h-[12rem] shrink-0"
      : cn("min-h-0 flex-1", count === 1 ? "min-h-[16rem]" : "min-h-[11rem]")

  // Plot quick-search: filter the dock list; matches feed Enter (focus + hide).
  const q = query.trim().toLowerCase()
  const dockMatches = q ? series.filter((s) => s.signal.label.toLowerCase().includes(q)) : []
  const dockSeries = searchOpen && q ? dockMatches : series
  const mobileChannelSeries = q ? allSeries.filter((s) => s.signal.label.toLowerCase().includes(q)) : allSeries
  const channelPanelSeries = mobilePlot ? mobileChannelSeries : dockSeries
  const mobileChannelLimitReached = mobilePlot && visibleLabels.size >= MOBILE_ANALYSIS_MAX_CHANNELS
  function closeSearch() {
    setSearchOpen(false)
    setQuery("")
  }
  function focusMatch() {
    const first = (mobilePlot ? mobileChannelSeries : dockMatches)[0]?.signal.label
    if (first) {
      if (mobilePlot && !visibleLabels.has(first)) {
        if (visibleLabels.size >= MOBILE_ANALYSIS_MAX_CHANNELS) return
        onToggleChannelLabel?.(first)
      }
      setFocusKey(first)
    }
    closeSearch() // search disappears while the line stays highlighted
  }
  function togglePanelChannel(label: string, isVisible: boolean) {
    if (mobilePlot) {
      if (!isVisible && visibleLabels.size >= MOBILE_ANALYSIS_MAX_CHANNELS) return
      onToggleChannelLabel?.(label)
      return
    }
    toggleSelected(label)
  }
  function activatePanelChannel(label: string, focused: boolean, isVisible: boolean) {
    if (mobilePlot) {
      if (!isVisible && visibleLabels.size >= MOBILE_ANALYSIS_MAX_CHANNELS) return
      onToggleChannelLabel?.(label)
      return
    }
    setFocusKey(focused ? null : label)
  }
  function applyTemplateById(templateId: string) {
    const template = templates.find((t) => t.id === templateId)
    if (template && onApplyTemplate) onApplyTemplate(template)
  }
  const toolbarButtonClass = (active = false) =>
    cn(
      "inline-flex h-8 items-center justify-center gap-1.5 rounded-md border px-2 text-[11px] transition-colors max-[420px]:w-8 max-[420px]:px-0",
      active ? "border-primary bg-primary/15 text-foreground" : "border-border bg-card text-muted-foreground hover:bg-secondary hover:text-foreground",
    )
  const sidePanelOpen = presetMode ? false : groupMode ? groupEditorOpen : dockOpen
  const openSidePanel = () => (groupMode ? setGroupEditorOpen(true) : setDockOpen(true))
  const closeSidePanel = () => (groupMode ? setGroupEditorOpen(false) : setDockOpen(false))

  return (
    <section
      data-panes={paneGroups.length}
      data-layout={presetMode ? "preset" : groupMode ? "groups" : manualSplit ? "split" : "overlay"}
      data-workbench={workbench ? "true" : undefined}
      data-fullscreen={fullscreen ? "true" : undefined}
      data-mobile-auto-fullscreen={mobileAutoFullscreen ? "true" : undefined}
      data-has-timeline={timelineSlot ? "true" : undefined}
      ref={plotRef}
      className={cn(
        "octane-analysis-plot relative overflow-hidden border border-border",
        fullscreen
          ? "fixed inset-0 z-50 flex flex-col rounded-none bg-background/90 backdrop-blur-2xl"
          : workbench
            ? "flex min-h-0 flex-1 flex-col rounded-none border-0 bg-black"
            : "flex min-h-0 flex-1 flex-col rounded-xl bg-card/60",
      )}
    >
      {!workbench && <header className="flex flex-wrap items-center justify-between gap-2 px-2 py-2 sm:flex-nowrap sm:px-4 sm:py-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h3 className="shrink-0 text-sm font-semibold text-foreground">{panelTitle}</h3>
          <span className="hidden truncate font-mono text-[11px] text-muted-foreground min-[520px]:block lg:hidden">
            {selected.size ? `${selected.size} selected` : focusKey ? `Focused: ${focusKey}` : cursorT != null ? `t = ${fmt(cursorT, 2)}${timeUnit}` : "Channels ready"}
          </span>
        </div>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5 sm:gap-2">
          <span className="mr-1 hidden font-mono text-[11px] text-muted-foreground lg:inline">
            {selected.size ? `${selected.size} selected` : focusKey ? `Focused: ${focusKey}` : "focus a line to scale it"}
          </span>
          {!presetMode && analysisTab === "standard" && !mobilePlot && templates.length > 0 && onApplyTemplate && (
            <select
              aria-label="Apply channel template"
              value=""
              onChange={(event) => applyTemplateById(event.target.value)}
              className="octane-template-select h-8 min-w-0 max-w-[10rem] rounded-md border border-border bg-card px-2 text-[11px] text-foreground outline-none transition-colors hover:bg-secondary focus:border-ring focus:ring-2 focus:ring-ring/30 max-[420px]:order-10 max-[420px]:w-full max-[420px]:max-w-none"
            >
              <option value="" disabled>
                Template
              </option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
          )}
          {!presetMode && mobilePlot && (
            <button
              type="button"
              onClick={() => setDockOpen((value) => !value)}
              aria-pressed={dockOpen}
              title={dockOpen ? "Close channels" : "Select channels"}
              className={toolbarButtonClass(dockOpen)}
            >
              <PanelRightOpen className="size-3.5" />
              <span className="hidden min-[420px]:inline">Channels</span>
            </button>
          )}
          {mobilePlot && (
            <button
              type="button"
              onClick={toggleFullscreen}
              aria-pressed={fullscreen}
              title={fullscreen ? "Exit fullscreen" : mobileLandscapeTight ? "Landscape fullscreen active" : "Fullscreen plot"}
              aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen plot"}
              className={toolbarButtonClass(fullscreen)}
            >
              {fullscreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
              <span className="hidden min-[420px]:inline">{fullscreen ? "Exit" : "Full"}</span>
            </button>
          )}
          {onFitWindow && (
            <button
              type="button"
              onClick={onFitWindow}
              title="Fit full time window"
              aria-label="Fit full time window"
              className={toolbarButtonClass()}
            >
              <ScanSearch className="size-3.5" />
              <span className="hidden sm:inline">Fit</span>
            </button>
          )}
          {onResetPlot && (
            <button
              type="button"
              onClick={resetPlotSurface}
              title="Reset plot"
              aria-label="Reset plot"
              className={toolbarButtonClass()}
            >
              <RefreshCw className="size-3.5" />
              <span className="hidden sm:inline">Reset</span>
            </button>
          )}
          {!presetMode && !mobilePlot && !sidePanelOpen && (
            <button
              type="button"
              onClick={openSidePanel}
              title={groupMode ? "Open group editor" : "Open channel panel"}
              aria-label={groupMode ? "Open group editor" : "Open channel panel"}
              className={cn(toolbarButtonClass(), "sm:hidden")}
            >
              {groupMode ? <SlidersHorizontal className="size-3.5" /> : <PanelRightOpen className="size-3.5" />}
              <span className="hidden min-[520px]:inline">{groupMode ? "Groups" : "Channels"}</span>
            </button>
          )}
          {!presetMode && groupMode && !mobilePlot && (
            <button
              type="button"
              onClick={() => setGroupEditorOpen((value) => !value)}
              aria-pressed={groupEditorOpen}
              title={groupEditorOpen ? "Close group editor" : "Open group editor"}
              className={toolbarButtonClass(groupEditorOpen)}
            >
              <SlidersHorizontal className="size-3.5" />
              <span className="hidden sm:inline">Edit groups</span>
            </button>
          )}
          {!presetMode && analysisTab === "standard" && !mobilePlot && (
            <button
              type="button"
              onClick={() => {
                setSplit((v) => !v)
              }}
              aria-pressed={manualSplit}
              title={manualSplit ? "Single plot" : "Split into two plots"}
              className={toolbarButtonClass(manualSplit)}
            >
              {manualSplit ? <Rows2 className="size-3.5" /> : <Columns2 className="size-3.5" />}
              <span className="hidden sm:inline">{manualSplit ? "2 plots" : "Split"}</span>
            </button>
          )}
          {!mobilePlot && (
          <button
            type="button"
            onClick={() => onReadoutPickingChange?.(!readoutPicking)}
            aria-pressed={readoutPicking}
            disabled={!onReadoutPickingChange}
            title={readoutPicking ? "Disable readout hover/click line picking" : "Enable readout hover/click line picking"}
            className={toolbarButtonClass(readoutPicking)}
          >
            <MousePointerClick className="size-3.5" />
            <span className="hidden sm:inline">Pick</span>
          </button>
          )}
          {!mobilePlot && (
          <button
            type="button"
            onClick={() =>
              setMarkPeaks((v) => {
                if (v) setHighlightKey(null)
                return !v
              })
            }
            aria-pressed={markPeaks}
            title="Mark the focused line's peak"
            className={toolbarButtonClass(markPeaks)}
          >
            <TrendingUp className="size-3.5" />
            <span className="hidden sm:inline">Mark peaks</span>
          </button>
          )}
          {!mobilePlot && (
          <button
            type="button"
            onClick={toggleFullscreen}
            aria-pressed={fullscreen}
            title={fullscreen ? "Exit fullscreen (Esc)" : "Fullscreen plot"}
            className={toolbarButtonClass(fullscreen)}
          >
            {fullscreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
            <span className="hidden sm:inline">{fullscreen ? "Exit" : "Fullscreen"}</span>
          </button>
          )}
        </div>
      </header>}

      <div className={cn("relative flex min-h-0 flex-1", !workbench && "border-t border-border")}>
        <div className={cn("flex min-w-0 flex-1 flex-col", groupMode && "overflow-y-auto", workbench && "octane-workbench-panes bg-black")}>
          {paneGroups.length > 0 ? (
            paneGroups.map((pane, p) => (
              <AnalysisPane
                key={pane.id}
                paneTitle={pane.title}
                paneSeries={pane.series}
                domain={domain}
                sync={sync}
                cursorT={cursorT}
                display={display}
                timeUnit={timeUnit}
                transforms={transforms}
                focusKey={focusKey}
                selected={selected}
                colorOf={colorOf}
                seriesByLabel={seriesByLabel}
                axisLabel={workbench ? null : paneAxisLabel(pane.series)}
                peak={peak && pane.series.some((s) => s.signal.label === peak.label) ? peak : null}
                annotateMode={annotateMode}
                markPeaks={markPeaks}
                shownAnnotations={shownAnnotations}
                heightClass={cn(paneHeight(paneGroups.length), p > 0 && "border-t border-border")}
                readoutMode={presetMode || mobilePlot || !sidePanelOpen ? "ghost" : groupMode ? "pane" : "none"}
                readoutLimit={workbench ? 5 : presetMode || mobilePlot || !sidePanelOpen ? 7 : 5}
                readoutInteractive={!mobilePlot && readoutPicking}
                hoverKey={hoverKey}
                onCursorChange={onCursorChange}
                onApplyGain={applyGain}
                onApplyOffset={applyOffset}
                onMarkNearest={setHighlightKey}
                onLineHover={setHoverKey}
                onLinePick={pickLine}
                onAddAnnotation={onAddAnnotation}
              />
            ))
          ) : (
            <div className="flex min-h-[16rem] flex-1 items-center justify-center px-4 text-center text-sm text-muted-foreground">
              No grouped channels selected.
            </div>
          )}
        </div>

        {/* Dock */}
        {!presetMode && (sidePanelOpen ? (
          groupMode ? (
            <GroupEditor
              groups={groups}
              activeGroupId={activeGroupId}
              availableSeries={allSeries}
              colorOf={colorOf}
              onSetActiveGroup={setActiveGroupId}
              onClose={closeSidePanel}
              onUpdateGroups={updateGroups}
            />
          ) : (
          <aside className="octane-analysis-dock absolute inset-x-0 bottom-0 z-20 flex max-h-[58%] flex-col border-t border-border bg-popover/95 shadow-2xl backdrop-blur sm:static sm:max-h-none sm:w-64 sm:shrink-0 sm:border-l sm:border-t-0 sm:bg-transparent sm:shadow-none sm:backdrop-blur-0">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <span className="font-mono text-[11px] text-muted-foreground">
                {mobilePlot
                  ? `${visibleLabels.size}/${MOBILE_ANALYSIS_MAX_CHANNELS} selected`
                  : selected.size
                    ? `${selected.size} selected`
                    : cursorT != null
                      ? `t = ${fmt(cursorT, 2)}${timeUnit}`
                      : "Channels"}
              </span>
              <div className="flex items-center gap-1">
                {!mobilePlot && selected.size > 0 && (
                  <button
                    type="button"
                    onClick={() => setSelected(new Set())}
                    className="rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-secondary hover:text-foreground"
                  >
                    Clear
                  </button>
                )}
                <button
                  type="button"
                  onClick={closeSidePanel}
                  aria-label="Collapse panel"
                  className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-secondary hover:text-foreground"
                >
                  <ChevronRight className="size-4" />
                </button>
              </div>
            </div>
            {(mobilePlot || searchOpen) && (
              <div className="border-b border-border px-2 py-1.5">
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault()
                      focusMatch()
                    } else if (e.key === "Escape") {
                      e.preventDefault()
                      e.stopPropagation()
                      closeSearch()
                    }
                  }}
                  placeholder={mobilePlot ? "Search channels..." : "Search channels... Enter to highlight"}
                  className="h-7 w-full rounded-md border border-border bg-card px-2 text-xs text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none"
                />
                {mobileChannelLimitReached && (
                  <p className="mt-1 px-0.5 text-[10px] text-muted-foreground">6 selected. Deselect a channel before adding another.</p>
                )}
              </div>
            )}
            <ul className="min-h-0 flex-1 overflow-y-auto py-1">
              {channelPanelSeries.map((s) => {
                const label = s.signal.label
                const focused = focusKey === label
                const isSel = selected.has(label)
                const isVisible = visibleLabels.has(label)
                const blocked = mobilePlot && !isVisible && visibleLabels.size >= MOBILE_ANALYSIS_MAX_CHANNELS
                const t = transforms[label]
                const v = cursorT != null ? sampleAt(s.signal.data, cursorT)?.value ?? null : null
                return (
                  <li
                    key={s.id}
                    className={cn(
                      "flex items-center gap-1.5 px-2 py-1.5 transition-colors",
                      focused || (mobilePlot && isVisible) ? "bg-secondary" : blocked ? "opacity-45" : "hover:bg-secondary/50",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => togglePanelChannel(label, isVisible)}
                      aria-pressed={mobilePlot ? isVisible : isSel}
                      disabled={blocked}
                      title={mobilePlot ? (isVisible ? "Hide channel" : "Show channel") : "Select for group scaling"}
                      className={cn(
                        "flex size-4 shrink-0 items-center justify-center rounded border transition-colors disabled:cursor-not-allowed",
                        (mobilePlot ? isVisible : isSel) ? "border-primary bg-primary text-primary-foreground" : "border-border",
                      )}
                    >
                      {(mobilePlot ? isVisible : isSel) && <span className="size-1.5 rounded-[1px] bg-primary-foreground" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => activatePanelChannel(label, focused, isVisible)}
                      disabled={blocked}
                      title={label}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-not-allowed"
                    >
                      <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: colorOf[label] }} />
                      <span className={cn("min-w-0 flex-1 truncate text-xs", focused || (mobilePlot && isVisible) ? "text-foreground" : "text-muted-foreground")}>
                        {label}
                      </span>
                    </button>
                    {!mobilePlot && manualSplit && (
                      <div className="flex shrink-0 overflow-hidden rounded border border-border text-[9px] font-mono">
                        {([0, 1] as const).map((pi) => (
                          <button
                            key={pi}
                            type="button"
                            onClick={() => setPlotAssign((prev) => ({ ...prev, [label]: pi }))}
                            className={cn("px-1", paneOf(label) === pi ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary")}
                          >
                            {pi + 1}
                          </button>
                        ))}
                      </div>
                    )}
                    {!mobilePlot && t && (
                      <button
                        type="button"
                        onClick={() => resetTransform(label)}
                        title={`Scale ×${t.gain.toFixed(1)} — reset`}
                        className="inline-flex shrink-0 items-center rounded px-1 text-[10px] font-mono text-primary hover:bg-secondary"
                      >
                        ×{t.gain.toFixed(1)}
                        <RotateCcw className="ml-0.5 size-3" />
                      </button>
                    )}
                    {!mobilePlot && (
                      <span className="w-12 shrink-0 text-right font-mono text-[11px] tabular-nums" style={{ color: focused ? colorOf[label] : undefined }}>
                        {v == null ? "—" : fmt(v, s.signal.decimals)}
                      </span>
                    )}
                  </li>
                )
              })}
            </ul>
            <div className="hidden border-t border-border px-3 py-2 text-[10px] leading-relaxed text-muted-foreground sm:block">
              Tick channels to scale several at once · Shift+scroll scales · Shift+drag moves · the left axis shows the focused line's real
              values.
            </div>
          </aside>
          )
        ) : (
          <button
            type="button"
            onClick={openSidePanel}
            aria-label="Expand panel"
            className="absolute bottom-3 right-3 z-20 flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-popover/95 text-muted-foreground shadow-lg backdrop-blur hover:bg-secondary hover:text-foreground sm:static sm:h-auto sm:w-7 sm:rounded-none sm:border-y-0 sm:border-r-0 sm:bg-transparent sm:shadow-none sm:backdrop-blur-0"
          >
            <ChevronLeft className="size-4" />
          </button>
        ))}
      </div>

      {timelineSlot && (
        <div className={cn("octane-analysis-timeline border-t border-border bg-background/90 px-2 py-2 backdrop-blur", !fullscreen && "lg:hidden")}>
          {timelineSlot}
        </div>
      )}
    </section>
  )
}

function GroupEditor({
  groups,
  activeGroupId,
  availableSeries,
  colorOf,
  onSetActiveGroup,
  onClose,
  onUpdateGroups,
}: {
  groups: EditableGroup[]
  activeGroupId: string | null
  availableSeries: ChartSeries[]
  colorOf: Record<string, string>
  onSetActiveGroup: (id: string | null) => void
  onClose: () => void
  onUpdateGroups: (updater: (current: EditableGroup[]) => EditableGroup[]) => void
}) {
  const [query, setQuery] = useState("")
  const active = groups.find((group) => group.id === activeGroupId) ?? groups[0] ?? null
  const activeLabels = new Set(active?.labels ?? [])
  const filteredSeries = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return availableSeries
    return availableSeries.filter((item) => {
      const label = item.signal.label.toLowerCase()
      const unit = item.signal.unit.toLowerCase()
      return label.includes(q) || unit.includes(q)
    })
  }, [availableSeries, query])

  function addGroup() {
    const id = makeGroupId()
    onUpdateGroups((current) => [...current, { id, name: `Group ${current.length + 1}`, labels: [] }])
    onSetActiveGroup(id)
  }

  function deleteActiveGroup() {
    if (!active) return
    const next = groups.filter((group) => group.id !== active.id)
    if (next.length === 0) {
      const id = makeGroupId()
      const fallback = { id, name: "Group 1", labels: [] }
      onUpdateGroups(() => [fallback])
      onSetActiveGroup(id)
      return
    }
    onUpdateGroups(() => next)
    onSetActiveGroup(next[0].id)
  }

  function renameActive(name: string) {
    if (!active) return
    onUpdateGroups((current) => current.map((group) => (group.id === active.id ? { ...group, name } : group)))
  }

  function toggleLabel(label: string) {
    if (!active) return
    onUpdateGroups((current) =>
      current.map((group) => {
        if (group.id !== active.id) return group
        const has = group.labels.includes(label)
        return { ...group, labels: has ? group.labels.filter((item) => item !== label) : [...group.labels, label] }
      }),
    )
  }

  return (
    <aside className="octane-analysis-dock absolute inset-x-0 bottom-0 z-20 flex max-h-[62%] flex-col border-t border-border bg-popover/95 shadow-2xl backdrop-blur sm:static sm:max-h-none sm:w-80 sm:shrink-0 sm:border-l sm:border-t-0 sm:bg-transparent sm:shadow-none sm:backdrop-blur-0">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Groups</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={addGroup}
            title="Add group"
            aria-label="Add group"
            className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <Plus className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Collapse panel"
            className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>

      <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-2 py-2">
        {groups.map((group) => (
          <button
            key={group.id}
            type="button"
            onClick={() => onSetActiveGroup(group.id)}
            className={cn(
              "inline-flex h-7 shrink-0 items-center gap-1 rounded-md border px-2 text-[11px] transition-colors",
              active?.id === group.id
                ? "border-primary bg-primary/15 text-foreground"
                : "border-border bg-card text-muted-foreground hover:bg-secondary hover:text-foreground",
            )}
          >
            <span className="max-w-24 truncate">{group.name}</span>
            <span className="font-mono text-[10px] opacity-75">{group.labels.length}</span>
          </button>
        ))}
      </div>

      {active && (
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
          <input
            value={active.name}
            onChange={(event) => renameActive(event.target.value)}
            className="h-8 min-w-0 flex-1 rounded-md border border-border bg-card px-2 text-sm text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
          />
          <button
            type="button"
            onClick={deleteActiveGroup}
            title="Delete group"
            aria-label="Delete group"
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      )}

      <div className="relative shrink-0 border-b border-border px-2 py-2">
        <Search className="pointer-events-none absolute left-4 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search channels..."
          className="h-8 w-full rounded-md border border-border bg-card pl-8 pr-8 text-xs text-foreground placeholder:text-muted-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="Clear search"
            className="absolute right-3 top-1/2 inline-flex size-5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <X className="size-3" />
          </button>
        )}
      </div>

      <ul className="min-h-0 flex-1 overflow-y-auto py-1">
        {filteredSeries.map((item) => {
          const label = item.signal.label
          const checked = activeLabels.has(label)
          return (
            <li key={item.id} className="flex items-center gap-2 px-2 py-1.5 transition-colors hover:bg-secondary/50">
              <button
                type="button"
                onClick={() => toggleLabel(label)}
                aria-pressed={checked}
                aria-label={checked ? `Remove ${label}` : `Add ${label}`}
                className={cn(
                  "flex size-4 shrink-0 items-center justify-center rounded border transition-colors",
                  checked ? "border-primary bg-primary" : "border-border",
                )}
              >
                {checked && <span className="size-1.5 rounded-[1px] bg-primary-foreground" />}
              </button>
              <button
                type="button"
                onClick={() => toggleLabel(label)}
                title={label}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
              >
                <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: colorOf[label] ?? "var(--muted-foreground)" }} />
                <span className={cn("min-w-0 flex-1 truncate text-xs", checked ? "text-foreground" : "text-muted-foreground")}>{label}</span>
                {unitText(item.signal.unit) && <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{item.signal.unit}</span>}
              </button>
            </li>
          )
        })}
      </ul>
    </aside>
  )
}

function AnalysisPane({
  paneTitle,
  paneSeries,
  domain,
  sync,
  cursorT,
  display,
  timeUnit,
  transforms,
  focusKey,
  selected,
  colorOf,
  seriesByLabel,
  axisLabel,
  peak,
  annotateMode,
  markPeaks,
  shownAnnotations,
  heightClass,
  readoutMode,
  readoutLimit,
  readoutInteractive,
  hoverKey,
  onCursorChange,
  onApplyGain,
  onApplyOffset,
  onMarkNearest,
  onLineHover,
  onLinePick,
  onAddAnnotation,
}: {
  paneTitle: string
  paneSeries: ChartSeries[]
  domain: [number, number]
  sync: boolean
  cursorT: number | null
  display: DisplaySettings
  timeUnit: string
  transforms: Record<string, Transform>
  focusKey: string | null
  selected: Set<string>
  colorOf: Record<string, string>
  seriesByLabel: Record<string, ChartSeries>
  axisLabel: string | null
  peak: Peak | null
  annotateMode: boolean
  markPeaks: boolean
  shownAnnotations: Annotation[]
  heightClass: string
  readoutMode: ReadoutMode
  readoutLimit: number
  readoutInteractive: boolean
  hoverKey: string | null
  onCursorChange: (t: number | null) => void
  onApplyGain: (factor: number) => void
  onApplyOffset: (delta: number) => void
  onMarkNearest: (label: string) => void
  onLineHover: (label: string | null) => void
  onLinePick: (label: string) => void
  onAddAnnotation: (t: number, channel: string) => void
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ moved: boolean } | null>(null)
  const clickRef = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  const offsetDragRef = useRef<{ startY: number } | null>(null)
  // latest gesture handlers (so the wheel listener binds once)
  const gainRef = useRef(onApplyGain)
  gainRef.current = onApplyGain

  const tf = (label: string): Transform => transforms[label] ?? { gain: 1, offset: 0 }

  const { rows, keys } = useMemo(() => {
    const map = new Map<number, Record<string, number | null>>()
    paneSeries.forEach((s, si) => {
      const key = `k${si}`
      const range = s.signal.max - s.signal.min || 1
      for (const d of lttb(s.signal.data, RENDER_POINTS)) {
        let row = map.get(d.t)
        if (!row) {
          row = { t: d.t }
          map.set(d.t, row)
        }
        row[key] = d.value == null ? null : (d.value - s.signal.min) / range
      }
    })
    return { rows: [...map.values()].sort((a, b) => (a.t as number) - (b.t as number)), keys: paneSeries.map((_, i) => `k${i}`) }
  }, [paneSeries])

  // Re-render on pane resize so the cursor/peak overlays (positioned from the
  // measured height) stay correct as the window or split layout changes.
  const [, forceTick] = useState(0)
  useEffect(() => {
    const el = wrapRef.current
    if (!el || typeof ResizeObserver === "undefined") return
    const ro = new ResizeObserver(() => forceTick((n) => n + 1))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Shift+scroll → scale targeted lines (non-passive listener).
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    function onWheel(e: WheelEvent) {
      if (!e.shiftKey) return
      e.preventDefault()
      gainRef.current(e.deltaY < 0 ? 1.12 : 1 / 1.12)
    }
    el.addEventListener("wheel", onWheel, { passive: false })
    return () => el.removeEventListener("wheel", onWheel)
  }, [])

  function pointerToT(clientX: number) {
    const r = wrapRef.current!.getBoundingClientRect()
    const left = (readoutMode === "none" ? LEFT : 12) + 4
    const w = Math.max(1, r.width - left - RIGHT)
    return +clamp(domain[0] + ((clientX - r.left - left) / w) * (domain[1] - domain[0]), domain[0], domain[1]).toFixed(3)
  }
  function usableH() {
    return Math.max(1, (wrapRef.current?.getBoundingClientRect().height ?? 300) - AXIS_H - PLOT_TOP)
  }

  function markNearest(clientX: number, clientY: number) {
    const r = wrapRef.current!.getBoundingClientRect()
    const ratio = clamp(1 - (clientY - r.top - PLOT_TOP) / usableH(), 0, 1)
    const t = pointerToT(clientX)
    if (!rows.length) return
    const row = rows.reduce((best, x) => (Math.abs((x.t as number) - t) < Math.abs((best.t as number) - t) ? x : best), rows[0])
    let bestLabel = paneSeries[0]?.signal.label
    let bd = Infinity
    keys.forEach((k, i) => {
      const label = paneSeries[i].signal.label
      const disp = applyTf(row?.[k] ?? null, tf(label))
      if (disp == null) return
      const d = Math.abs(disp - ratio)
      if (d < bd) {
        bd = d
        bestLabel = label
      }
    })
    if (bestLabel) onMarkNearest(bestLabel)
  }

  function onPointerDown(e: React.PointerEvent) {
    if (!wrapRef.current) return
    if (e.shiftKey) {
      e.preventDefault()
      offsetDragRef.current = { startY: e.clientY }
      wrapRef.current.setPointerCapture(e.pointerId)
      return
    }
    if (annotateMode || markPeaks) {
      clickRef.current = { x: e.clientX, y: e.clientY, moved: false }
      wrapRef.current.setPointerCapture(e.pointerId)
      return
    }
    dragRef.current = { moved: false }
    wrapRef.current.setPointerCapture(e.pointerId)
    e.preventDefault()
    onCursorChange(pointerToT(e.clientX))
  }
  function onPointerMove(e: React.PointerEvent) {
    if (offsetDragRef.current) {
      e.preventDefault()
      const dy = e.clientY - offsetDragRef.current.startY
      offsetDragRef.current.startY = e.clientY
      onApplyOffset(-dy / usableH())
      return
    }
    if (clickRef.current) {
      if (Math.abs(e.clientX - clickRef.current.x) > 3 || Math.abs(e.clientY - clickRef.current.y) > 3) clickRef.current.moved = true
      return
    }
    if (dragRef.current) {
      dragRef.current.moved = true
      e.preventDefault()
      onCursorChange(pointerToT(e.clientX))
    }
  }
  function onPointerUp(e: React.PointerEvent) {
    if (offsetDragRef.current) {
      offsetDragRef.current = null
      return
    }
    if (clickRef.current) {
      const c = clickRef.current
      clickRef.current = null
      if (!c.moved) {
        if (annotateMode) onAddAnnotation(pointerToT(e.clientX), "")
        else if (markPeaks) markNearest(e.clientX, e.clientY)
      }
      return
    }
    dragRef.current = null
  }
  function onPointerCancel() {
    offsetDragRef.current = null
    clickRef.current = null
    dragRef.current = null
  }

  const activeSet = new Set(selected)
  if (focusKey) activeSet.add(focusKey)
  if (hoverKey) activeSet.add(hoverKey)
  const hasActive = activeSet.size > 0

  // Real-units Y axis for the pane's axis channel.
  const axisSig = axisLabel ? seriesByLabel[axisLabel] : null
  const axisColor = axisLabel ? colorOf[axisLabel] : "var(--muted-foreground)"
  function realAt(y: number): string {
    if (!axisSig) return ""
    const t = tf(axisLabel!)
    const range = axisSig.signal.max - axisSig.signal.min || 1
    const norm = (y - 0.5 - t.offset) / t.gain + 0.5
    const real = axisSig.signal.min + range * norm
    return fmt(real, Math.abs(real) >= 100 ? 0 : axisSig.signal.decimals <= 1 ? 1 : 2)
  }

  const peakDispY = peak ? clamp(applyTf(peak.norm, tf(peak.label)) ?? peak.norm, 0, 1) : 0
  const readoutRows = useMemo(() => {
    if (cursorT == null || readoutMode === "none") return []
    const ordered: ChartSeries[] = []
    const seen = new Set<string>()
    const add = (item: ChartSeries | undefined) => {
      if (!item || seen.has(item.signal.label)) return
      seen.add(item.signal.label)
      ordered.push(item)
    }

    add(focusKey ? paneSeries.find((item) => item.signal.label === focusKey) : undefined)
    for (const label of selected) add(paneSeries.find((item) => item.signal.label === label))
    for (const item of paneSeries) add(item)

    return ordered.slice(0, readoutLimit).map((item) => {
      const sample = sampleAt(item.signal.data, cursorT)
      const value = sample?.value
      return {
        label: item.signal.label,
        color: colorOf[item.signal.label],
        value: value == null ? "--" : `${fmt(value, item.signal.decimals)}${unitText(item.signal.unit)}`,
      }
    })
  }, [colorOf, cursorT, focusKey, paneSeries, readoutLimit, readoutMode, selected])

  const cursorDots = useMemo(() => {
    if (!sync || cursorT == null) return []
    return paneSeries.flatMap((item) => {
      const sample = sampleAt(item.signal.data, cursorT)
      if (sample?.value == null) return []
      const range = item.signal.max - item.signal.min || 1
      const norm = (sample.value - item.signal.min) / range
      return [
        {
          label: item.signal.label,
          t: cursorT,
          y: clamp(applyTf(norm, tf(item.signal.label)) ?? norm, 0, 1),
          color: colorOf[item.signal.label],
        },
      ]
    })
  }, [colorOf, cursorT, paneSeries, sync, transforms]) // eslint-disable-line react-hooks/exhaustive-deps
  const readoutCanPick = readoutInteractive

  return (
    <div
      ref={wrapRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      className={cn(
        "octane-analysis-pane relative w-full touch-none select-none px-2",
        heightClass,
        annotateMode ? "cursor-crosshair" : "cursor-ew-resize",
      )}
    >
      {axisLabel && axisSig && (
        <span className="pointer-events-none absolute right-3 top-1 z-10 rounded bg-background/70 px-1 font-mono text-[10px]" style={{ color: axisColor }}>
          {axisLabel}
          {axisSig.signal.unit !== "—" ? ` (${axisSig.signal.unit})` : ""}
        </span>
      )}
      {markPeaks && (
        <div className="pointer-events-none absolute left-1/2 top-1 z-10 -translate-x-1/2 rounded-full bg-primary/15 px-2 py-0.5 text-center text-[10px] text-foreground">
          Peak mode — click a line to mark its max · turn off “Mark peaks” to scrub the cursor
        </div>
      )}
      {readoutRows.length > 0 && (
        <div
          data-readout={readoutMode}
          data-picking={readoutCanPick ? "true" : "false"}
          className={cn(
            "octane-pane-readout absolute left-3 top-3 z-20 min-w-40 max-w-[min(18rem,70vw)] rounded-md border border-border/80 bg-background/72 p-2 shadow-xl backdrop-blur-md",
            readoutMode === "ghost"
              ? cn(readoutCanPick ? "pointer-events-auto" : "pointer-events-none", "border-transparent bg-transparent shadow-none backdrop-blur-0")
              : "pointer-events-auto",
          )}
          style={
            readoutMode === "ghost"
              ? {
                  textShadow: "0 1px 2px #000, 0 0 5px #000",
                  background: "transparent",
                  borderColor: "transparent",
                  boxShadow: "none",
                  backdropFilter: "none",
                }
              : undefined
          }
        >
          <div className={cn("mb-1 flex items-center justify-between gap-3 border-b pb-1", readoutMode === "ghost" ? "border-transparent" : "border-border/70")}>
            <span className="truncate text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{paneTitle}</span>
            <span className="font-mono text-[10px] tabular-nums text-foreground">
              {fmt(cursorT!, 2)}
              {timeUnit}
            </span>
          </div>
          <div className="flex max-h-28 flex-col gap-0.5 overflow-hidden">
            {readoutRows.map((row) => (
              <button
                key={row.label}
                type="button"
                disabled={!readoutCanPick}
                onPointerDown={(event) => event.stopPropagation()}
                onMouseEnter={() => {
                  if (readoutCanPick) onLineHover(row.label)
                }}
                onMouseLeave={() => {
                  if (readoutCanPick) onLineHover(null)
                }}
                onFocus={() => {
                  if (readoutCanPick) onLineHover(row.label)
                }}
                onBlur={() => {
                  if (readoutCanPick) onLineHover(null)
                }}
                onClick={() => {
                  if (readoutCanPick) onLinePick(row.label)
                }}
                className={cn(
                  "grid w-full grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3 rounded px-1 py-0.5 text-left font-mono text-[11px] leading-tight",
                  readoutCanPick && "cursor-pointer",
                  readoutCanPick && readoutMode !== "ghost" && "hover:bg-secondary/70",
                  !readoutCanPick && "cursor-default disabled:opacity-100",
                )}
              >
                <span className="truncate" style={{ color: row.color }}>
                  {row.label}
                </span>
                <span className="tabular-nums text-foreground">{row.value}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={rows} margin={{ top: PLOT_TOP, right: RIGHT, left: 4, bottom: 4 }}>
          {display.showGrid && (
            <CartesianGrid stroke="var(--muted-foreground)" strokeOpacity={0.22} strokeDasharray="2 4" vertical horizontal />
          )}
          <XAxis
            dataKey="t"
            type="number"
            domain={domain}
            allowDataOverflow
            tickLine={false}
            axisLine={{ stroke: "var(--border)" }}
            tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            minTickGap={40}
            unit={timeUnit}
          />
          <YAxis
            width={readoutMode === "none" ? LEFT : 12}
            domain={[0, 1]}
            allowDataOverflow
            ticks={[0, 0.25, 0.5, 0.75, 1]}
            tickLine={false}
            axisLine={false}
            tick={readoutMode === "none" && axisSig ? { fill: axisColor, fontSize: 10 } : false}
            tickFormatter={readoutMode === "none" && axisSig ? realAt : undefined}
          />
          {sync && cursorT != null && (
            <ReferenceLine x={cursorT} stroke="var(--muted-foreground)" strokeOpacity={0.7} strokeDasharray="4 3" />
          )}
          {cursorDots.map((dot) => (
            <ReferenceDot
              key={dot.label}
              x={dot.t}
              y={dot.y}
              r={3}
              fill={dot.color}
              stroke="var(--background)"
              strokeWidth={1.5}
              isFront
            />
          ))}
          {shownAnnotations.map((a) => (
            <ReferenceLine
              key={a.id}
              x={a.t}
              stroke={colorForType(a.type)}
              strokeWidth={1.5}
              label={{ value: a.type, position: "insideTopLeft", fontSize: 10, fill: colorForType(a.type) }}
            />
          ))}
          {keys.map((key, i) => {
            const label = paneSeries[i].signal.label
            const isActive = activeSet.has(label)
            return (
              <Area
                key={key}
                type={display.curve}
                dataKey={(d: Record<string, number | null>) => applyTf(d[key] ?? null, tf(label))}
                name={label}
                stroke={colorOf[label]}
                strokeWidth={isActive ? display.lineWidth + 1 : display.lineWidth}
                strokeOpacity={!hasActive || isActive || !display.focusDim ? 1 : 0.22}
                fill="none"
                dot={false}
                activeDot={false}
                isAnimationActive={false}
                connectNulls
              />
            )
          })}
          {peak && (
            <ReferenceDot
              x={peak.t}
              y={peakDispY}
              r={5}
              fill={peak.color}
              stroke="var(--background)"
              strokeWidth={2}
              isFront
              label={{
                value: `▲ ${fmt(peak.value, peak.decimals)}${peak.unit !== "—" ? " " + peak.unit : ""}`,
                position: peakDispY > 0.6 ? "bottom" : "top",
                fontSize: 11,
                fontWeight: 600,
                fill: peak.color,
              }}
            />
          )}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

export const CombinedChart = memo(CombinedChartImpl)
