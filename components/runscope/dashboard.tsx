"use client"

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react"
import {
  ChevronLeft,
  ChevronRight,
  Cloud,
  Download,
  HelpCircle,
  Keyboard,
  LayoutList,
  LineChart,
  MousePointerClick,
  MoveHorizontal,
  Plus,
  RefreshCw,
  ScanSearch,
  Search,
  SlidersHorizontal,
  TriangleAlert,
  Upload,
  X,
} from "lucide-react"
import { type SignalKey } from "@/lib/telemetry"
import { parseLogFile, type ParsedLog } from "@/lib/csv"
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
  DEFAULT_TEMPLATES,
  missingTemplateEntries,
  resolveEntry,
  resolveTemplateLabels,
  withChannelsFromGroups,
  type Template,
} from "@/lib/templates"
import { TemplateEditor, templateGroups } from "./template-editor"
import { useShortcuts, type Shortcut } from "@/hooks/use-shortcuts"
import { canonicalKey, keyLabel, matchesKey, useBindings } from "@/lib/keybindings"
import { useCursorSpeed } from "@/lib/cursor-speed"
import { isMobileViewportNow, useMobileViewport } from "@/lib/viewport"
import { Rail, type ViewMode } from "./rail"
import { ControlPanel, type ChannelItem } from "./control-panel"
import { CombinedChart, MOBILE_ANALYSIS_MAX_CHANNELS, type PaneGroup, type Transform } from "./combined-chart"
import { CompareView } from "./compare-view"
import { KpiCards } from "./kpi-cards"
import { RangeBrush, type OverviewSeries } from "./range-brush"
import { LoadedFiles } from "./loaded-files"
import { CHART_INTRINSIC_HEIGHT, SignalChart, type ChartSeries } from "./signal-chart"
import { DEFAULT_DISPLAY, type DisplaySettings } from "./display-panel"
import { UploadZone } from "./upload-zone"
import { AboutModal } from "./about-modal"
import { SettingsModal } from "./settings-modal"
import { MetadataModal } from "./metadata-modal"
import { ShortcutsModal } from "./shortcuts-modal"
import { AnnotationDialog, type AnnotationDraft } from "./annotation-dialog"
import { LicenseBadge } from "./license-badge"
import { CloudLogsDialog } from "./cloud-logs-dialog"
import { FlagStrip } from "./flag-strip"
import { decodeValue, decoderFor, describe, stepValueAt, useFlagDecoders } from "@/lib/flag-decoders"
import { cn } from "@/lib/utils"
import { COMPARE_FILE_COLORS, assignLineColors } from "@/lib/palette"
import { loadLineStyles, saveLineStyles } from "@/lib/line-style"
import { friendlyFileError } from "@/lib/friendly-errors"
import { isCloudLogAdmin } from "@/lib/cloud-logs"
import { isOwnerUser } from "@/lib/auth"
import { LicensesDialog } from "./licenses-dialog"
import type { AuthUser } from "@/lib/auth"

const MIN_ZOOM = 100
// 50x: drag-selecting a few seconds out of a long session must not be clamped.
const MAX_ZOOM = 5000
const DEFAULT_VISIBLE = 6
const FILE_COLORS = COMPARE_FILE_COLORS

/** Stable identity for a loaded log (two files can share a name). */
function logKey(log: ParsedLog): string {
  return `${log.fileName}|${log.samples}|${log.duration}`
}

/**
 * Mount a chart only while it is near the scroll viewport. With every channel
 * visible by default, this keeps cursor/zoom updates cheap on big logs.
 */
function LazyMount({
  id,
  root,
  estimate,
  className,
  children,
}: {
  id?: string
  root: React.RefObject<HTMLElement | null>
  estimate: number
  className?: string
  children: React.ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const heightRef = useRef(estimate)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true)
      return
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) heightRef.current = Math.max(40, el.getBoundingClientRect().height || heightRef.current)
        setVisible(entry.isIntersecting)
      },
      { root: root.current, rootMargin: "900px 0px" },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [root])
  return (
    <div ref={ref} id={id} className={className} style={visible ? undefined : { minHeight: heightRef.current }}>
      {visible ? children : null}
    </div>
  )
}

const READOUT_PICKING_STORAGE_KEY = "octane:readout-picking:v1"

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

/** Lines on the desktop Analysis Plot by default (the General template). */
const DESKTOP_ANALYSIS_DEFAULT_MAX = 12

function defaultAnalysisLabels(log: ParsedLog, mobile: boolean, template?: Template | null): Set<string> {
  if (!mobile) {
    const resolved = resolveTemplateLabels(template ?? DEFAULT_TEMPLATES[0], log.signals.map((s) => s.label))
    const labels = new Set(resolved.slice(0, DESKTOP_ANALYSIS_DEFAULT_MAX))
    if (labels.size) return labels
  }
  return defaultMobileAnalysisLabels(log)
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
  // Desktop: every channel is visible on load (Signal Matrix shows all parameters).
  return new Set()
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
  analysisLabels?: Set<string>
  /** Time window per view, so each file keeps its own Analysis/Matrix range. */
  viewWindows?: Partial<Record<ViewMode, { domain: [number, number]; zoom: number }>>
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

export const Dashboard = forwardRef<
  DashboardHandle,
  { initialLog?: ParsedLog | null; onHome?: () => void; accountUser?: AuthUser | null; accountEmail?: string | null }
>(
  function Dashboard({ initialLog = null, onHome, accountUser = null, accountEmail = null }, ref) {
  const [logs, setLogs] = useState<ParsedLog[]>(initialLog ? [initialLog] : [])
  const [activeIndex, setActiveIndex] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [sync, setSync] = useState(true)
  const [view, setView] = useState<ViewMode>("matrix")
  const mobileViewport = useMobileViewport()
  // Channels view: which shared template is open.
  const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null)
  // Channels view opens graph-only; the Values pane is opt-in.
  const [channelsPaneOpen, setChannelsPaneOpen] = useState(false)
  const [channelsPaneQuery, setChannelsPaneQuery] = useState("")
  const [channelsHelpOpen, setChannelsHelpOpen] = useState(false)
  const [channelsEditOpen, setChannelsEditOpen] = useState(false)
  const [readoutPicking, setReadoutPicking] = useState(loadReadoutPicking)
  const [annotate, setAnnotate] = useState(false)
  const [windowMode, setWindowMode] = useState(false)
  const [compareMode, setCompareMode] = useState<"matrix" | "areas">("matrix")
  const [zoom, setZoom] = useState(100)
  const [domain, setDomain] = useState<[number, number]>(initialLog ? [0, initialLog.duration] : [0, 0])
  const [cursorT, setCursorT] = useState<number | null>(null)
  const [query, setQuery] = useState("")
  const [collapsed, setCollapsed] = useState<Set<SignalKey>>(new Set())
  const [hidden, setHidden] = useState<Set<SignalKey>>(initialLog ? defaultHidden(initialLog, isMobileViewportNow()) : new Set())
  // Lines on the Analysis Plot. Separate from the Signal Matrix selection so the
  // matrix can show every channel while the overlay stays readable.
  const [analysisLabels, setAnalysisLabels] = useState<Set<string>>(() =>
    initialLog ? defaultAnalysisLabels(initialLog, isMobileViewportNow()) : new Set(),
  )
  const [display, setDisplay] = useState<DisplaySettings>(DEFAULT_DISPLAY)

  // Per-file working state, so switching logs resumes where you left off.
  const sessionsRef = useRef<Map<string, Session>>(new Map())
  const [templates, setTemplates] = useState<Template[]>([])
  const templatesRef = useRef<Template[]>([])
  templatesRef.current = templates
  useEffect(() => {
    loadTemplates().then(ensureSeedTemplates).then(setTemplates)
  }, [])
  // Old separate Channels-preset storage was merged into the template file (see lib/templates.ts).
  useEffect(() => {
    if (mobileViewport && view !== "matrix" && view !== "plot") setView("plot")
  }, [mobileViewport, view])
  useEffect(() => {
    saveReadoutPicking(readoutPicking)
  }, [readoutPicking])

  // Analysis Plot state (persisted across view switches).
  // Line styles (colour, weight, scale range…) are keyed by channel label and
  // saved locally, so a tuned layout carries across logs and restarts.
  const [analysisTransforms, setAnalysisTransforms] = useState<Record<string, Transform>>({})
  const [lineStylesReady, setLineStylesReady] = useState(false)
  useEffect(() => {
    setAnalysisTransforms(loadLineStyles())
    setLineStylesReady(true)
  }, [])
  useEffect(() => {
    if (lineStylesReady) saveLineStyles(analysisTransforms)
  }, [analysisTransforms, lineStylesReady])
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
  const [settingsPage, setSettingsPage] = useState<"main" | "keys">("main")
  const [showMetadata, setShowMetadata] = useState(false)
  const [showCloudLogs, setShowCloudLogs] = useState(false)
  const [quickOpen, setQuickOpen] = useState(false)
  const [mobileControlsOpen, setMobileControlsOpen] = useState(false)
  const [mobileWindowOpen, setMobileWindowOpen] = useState(false)
  const [desktopControlsOpen, setDesktopControlsOpen] = useState(true)
  const [matrixQuery, setMatrixQuery] = useState("")
  const [highlightChannel, setHighlightChannel] = useState<SignalKey | null>(null)
  const quickRef = useRef<HTMLInputElement>(null)
  const mobileQuickRef = useRef<HTMLInputElement>(null)
  const [mobileSearchActive, setMobileSearchActive] = useState(false)
  const analysisLabelsLogRef = useRef<ParsedLog | null>(null)

  const searchRef = useRef<HTMLInputElement>(null)
  const mainRef = useRef<HTMLDivElement>(null)
  const viewWindowsRef = useRef<Partial<Record<ViewMode, { domain: [number, number]; zoom: number }>>>({})
  const bindings = useBindings()

  const hasLogs = logs.length > 0
  const displayEmail = accountUser?.email ?? accountEmail
  const canUseCloudLogs = accountUser ? isOwnerUser(accountUser) : isCloudLogAdmin(displayEmail)
  const [showLicenses, setShowLicenses] = useState(false)
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
    // Apply the Compare alignment offsets so the matrix matches the overlay areas.
    const shifted = (sig: ParsedLog["signals"][number], off: number) =>
      off ? { ...sig, data: sig.data.map((d) => ({ t: d.t + off, value: d.value })) } : sig
    return common
      .sort((a, b) => a.localeCompare(b))
      .map((lab) => {
      const series: ChartSeries[] = logs.map((l, li) => ({
        id: `${li}-${lab}`,
        name: l.fileName,
        color: FILE_COLORS[li % FILE_COLORS.length],
        signal: shifted(labelMaps[li].get(lab)!, fileOffsets[l.fileName] ?? 0),
      }))
      const diff = calculateDiff(series[0].signal.data, series[1].signal.data)
      const base = labelMaps[0].get(lab)!
      return { key: `cmp-${lab}`, label: lab, unit: base.unit, decimals: base.decimals, series, diffStats: diff?.stats ?? null }
    })
  }, [logs, comparing, activeIndex, fileOffsets])

  useEffect(() => {
    if (!activeLog || channels.length === 0) return
    const fresh = analysisLabelsLogRef.current !== activeLog
    analysisLabelsLogRef.current = activeLog
    const availableLabels = new Set(channels.map((channel) => channel.label))
    setAnalysisLabels((current) => {
      const kept = [...current].filter((label) => availableLabels.has(label)).slice(0, MOBILE_ANALYSIS_MAX_CHANNELS)
      // A new log with nothing usable gets the defaults; an empty set chosen by
      // the user ("Deselect all") stays empty.
      if (fresh && kept.length === 0) return analysisDefaults(activeLog)
      if (kept.length === current.size) return current
      return new Set(kept)
    })
  }, [activeLog, channels]) // eslint-disable-line react-hooks/exhaustive-deps -- defaults read refs/viewport only

  const channelItems: ChannelItem[] = useMemo(
    () => channels.map((c) => ({ key: c.key, label: c.label, unit: c.unit, color: c.series[0].color })),
    [channels],
  )
  const activeTemplate = templates.find((t) => t.id === activeTemplateId) ?? templates[0] ?? null
  const activePreset = activeTemplate ?? { id: "none", name: "No template", channels: [] as string[] }
  const presetMatch = useMemo(() => {
    const empty = { channels: [] as Channel[], missing: [] as string[], groups: [] as PaneGroup[] }
    if (!activeTemplate) return empty
    const labels = channels.map((c) => c.label)
    const byLabel = new Map(channels.map((c) => [c.label, c]))
    const selected: Channel[] = []
    const seen = new Set<string>()
    const groups: PaneGroup[] = templateGroups(activeTemplate)
      .map((group) => {
        const groupSeen = new Set<string>()
        const series: ChartSeries[] = []
        for (const entry of group.channels) {
          for (const label of resolveEntry(entry, labels)) {
            if (groupSeen.has(label)) continue
            groupSeen.add(label)
            const channel = byLabel.get(label)
            if (!channel) continue
            if (!seen.has(label)) {
              seen.add(label)
              selected.push(channel)
            }
            series.push(channel.series[0])
          }
        }
        return { id: `${activeTemplate.id}-${group.id}`, title: group.title, series }
      })
      .filter((group) => group.series.length > 0)
    return { channels: selected, missing: missingTemplateEntries(activeTemplate, labels), groups }
  }, [activeTemplate, channels])

  function saveAllTemplates(next: Template[]) {
    setTemplates(next)
    persistTemplates(next)
    if (activeTemplateId && !next.some((t) => t.id === activeTemplateId)) setActiveTemplateId(next[0]?.id ?? null)
  }

  // Load annotations whenever the active log changes.
  useEffect(() => {
    if (activeLog) setAnnotations(loadAnnotations(activeLog.fileName))
    else setAnnotations([])
  }, [activeLog])

  function analysisDefaults(log: ParsedLog): Set<string> {
    const general = templatesRef.current.find((t) => t.name.toLowerCase() === "general") ?? templatesRef.current[0] ?? null
    return defaultAnalysisLabels(log, mobileViewport || isMobileViewportNow(), general)
  }

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
    const viewWindows = { ...viewWindowsRef.current, [view]: { domain, zoom } }
    sessionsRef.current.set(logKey(activeLog), { hidden, domain, zoom, collapsed, cursorT, analysisLabels, viewWindows })
  }

  /** Restore a saved session; the current view's own window wins. */
  function restoreSession(target: ParsedLog, s: Session, forView: ViewMode) {
    viewWindowsRef.current = { ...(s.viewWindows ?? {}) }
    const w = s.viewWindows?.[forView]
    const valid = w && w.domain[0] >= 0 && w.domain[1] <= target.duration + 0.01 && w.domain[1] > w.domain[0]
    setHidden(s.hidden)
    if (valid) {
      setDomain(w.domain)
      setZoom(w.zoom)
    } else {
      setDomain([0, target.duration])
      setZoom(100)
    }
    setCollapsed(s.collapsed)
    setCursorT(s.cursorT)
    setAnalysisLabels(s.analysisLabels ?? analysisDefaults(target))
  }

  function applyDefaults(log: ParsedLog) {
    setHidden(defaultHidden(log, mobileViewport || isMobileViewportNow()))
    setAnalysisLabels(analysisDefaults(log))
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

  function loadCloudParsedLog(parsed: ParsedLog) {
    loadParsedLog(parsed)
    setShowCloudLogs(false)
  }

  function selectLog(i: number) {
    if (i < 0 || i >= logs.length) return
    if (i === activeIndex) return
    saveSession()
    const target = logs[i]
    setActiveIndex(i)
    const s = sessionsRef.current.get(logKey(target))
    // Resume where the user left off on this file (its own window for every view).
    if (s) restoreSession(target, s, view)
    else applyDefaults(target)
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
    sessionsRef.current.delete(logKey(logs[i]))
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
    const s = sessionsRef.current.get(logKey(target))
    if (s && nextView !== "compare") {
      restoreSession(target, s, nextView)
    } else {
      const dur = nextView === "compare" && next.length > 1 ? Math.max(...next.map((l) => l.duration)) : target.duration
      setHidden(defaultHidden(target, mobileViewport || isMobileViewportNow()))
      setAnalysisLabels(analysisDefaults(target))
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
    const c = resolveTemplateLabels(t, channels.map((ch) => ch.label))
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
    const minWidth = duration / (MAX_ZOOM / 100)
    let s = Math.max(0, start)
    let e = Math.min(duration, end)
    if (e - s < minWidth) {
      const mid = (s + e) / 2
      s = Math.max(0, mid - minWidth / 2)
      e = Math.min(duration, s + minWidth)
    }
    s = +s.toFixed(3)
    e = +e.toFixed(3)
    if (e <= s) return
    setDomain([s, e])
    setZoom(Math.round((duration / (e - s)) * 100))
  }

  // Keyboard time zoom: keeps the cursor (if inside the window) where it is on screen.
  function zoomBy(factor: number) {
    if (duration <= 0) return
    const width = domain[1] - domain[0] || duration
    const minWidth = duration / (MAX_ZOOM / 100)
    const nextW = Math.min(duration, Math.max(minWidth, width / factor))
    const anchor = cursorT != null && cursorT >= domain[0] && cursorT <= domain[1] ? cursorT : (domain[0] + domain[1]) / 2
    const rel = width > 0 ? (anchor - domain[0]) / width : 0.5
    const start = Math.max(0, Math.min(duration - nextW, anchor - rel * nextW))
    setWindow(start, start + nextW)
  }

  // Keyboard pan by a fraction of the current window width.
  function panBy(fraction: number) {
    const width = domain[1] - domain[0]
    if (width <= 0 || width >= duration) return
    const start = Math.max(0, Math.min(duration - width, domain[0] + width * fraction))
    setDomain([+start.toFixed(3), +(start + width).toFixed(3)])
  }

  // Stable callbacks for the memoized charts.
  const setWindowRef = useRef(setWindow)
  setWindowRef.current = setWindow
  // A drag-selection is a one-shot: set the window, then leave Window mode.
  const selectWindow = useCallback((start: number, end: number) => {
    setWindowRef.current(start, end)
    setWindowMode(false)
  }, [])
  const fitWindowRef = useRef<() => void>(() => {})
  const fitWindowStable = useCallback(() => fitWindowRef.current(), [])

  const toggleChannel = useCallback((key: string) => {
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  // Replace the plotted set (templates, "Deselect all"); order follows the request.
  const setVisibleLabels = useCallback(
    (labels: string[]) => {
      const byLower = new Map(channels.map((c) => [c.label.toLowerCase(), c.label]))
      const wanted = [...new Set(labels.map((label) => byLower.get(label.toLowerCase())).filter((l): l is string => Boolean(l)))]
      setAnalysisLabels(new Set(mobileViewport ? wanted.slice(0, MOBILE_ANALYSIS_MAX_CHANNELS) : wanted))
    },
    [channels, mobileViewport],
  )

  const toggleAnalysisLabel = useCallback(
    (label: string) => {
      setAnalysisLabels((current) => {
        const next = new Set(current)
        if (next.has(label)) {
          next.delete(label)
          return next
        }
        if (mobileViewport && next.size >= MOBILE_ANALYSIS_MAX_CHANNELS) return current
        next.add(label)
        return next
      })
    },
    [mobileViewport],
  )

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
  // The Analysis Plot has its own line set; everything else edits the matrix set.
  function currentViewLabels(): string[] {
    return view === "plot" ? analysisChannels.map((c) => c.label) : visibleChannels.map((c) => c.label)
  }

  function applyTemplate(t: Template) {
    const resolved = resolveTemplateLabels(t, channels.map((c) => c.label))
    if (view === "plot") {
      setVisibleLabels(resolved)
      return
    }
    const labels = new Set(resolved)
    setHidden(new Set(channels.filter((c) => !labels.has(c.label)).map((c) => c.key)))
  }

  function saveTemplate(name: string) {
    const next = [...templates, { id: makeTemplateId(), name, channels: currentViewLabels() }]
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
  // Overwrite a template's channels with the current selection, keeping its
  // graph layout where the channels are unchanged (new channels get auto graphs).
  function updateTemplate(id: string) {
    const labels = currentViewLabels()
    const all = channels.map((c) => c.label)
    const keep = new Set(labels)
    const next = templates.map((t) => {
      if (t.id !== id) return t
      if (!t.groups?.length) return { ...t, channels: labels }
      const groups = t.groups
        .map((g) => ({
          ...g,
          channels: g.channels.filter((entry) => {
            const hit = resolveEntry(entry, all)
            return hit.length === 0 || hit.some((l) => keep.has(l))
          }),
        }))
        .filter((g) => g.channels.length)
      const covered = new Set(groups.flatMap((g) => g.channels.flatMap((e) => resolveEntry(e, all))))
      const extra = labels.filter((l) => !covered.has(l))
      const extraGroups = extra.length
        ? templateGroups({ id: t.id + "-new", name: "", channels: extra }).map((g) => ({ ...g, id: g.id + "-" + Date.now().toString(36) }))
        : []
      return withChannelsFromGroups({ ...t, channels: [], groups: [...groups, ...extraGroups] })
    })
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
  // Same unique colours the Channels graphs use (deterministic in preset order).
  const presetSeries = useMemo(() => presetMatch.channels.map((c) => c.series[0]), [presetMatch])
  const presetColors = useMemo(() => {
    const overrides: Record<string, string | undefined> = {}
    for (const [label, style] of Object.entries(analysisTransforms)) if (style.color) overrides[label] = style.color
    return assignLineColors(
      presetMatch.channels.map((c) => c.label),
      overrides,
    )
  }, [presetMatch, analysisTransforms])
  // Stable series arrays: the plots memoize their (expensive) downsampled data on
  // these, so they must not be rebuilt on every render (e.g. each cursor step).
  const allSeries = useMemo(() => channels.map((c) => c.series[0]), [channels])
  const analysisHidden = useMemo(
    () => new Set(channels.filter((c) => !analysisLabels.has(c.label)).map((c) => c.key)),
    [channels, analysisLabels],
  )
  const analysisChannels = useMemo(
    () => {
      const list = channels.filter((channel) => analysisLabels.has(channel.label))
      return mobileViewport ? list.slice(0, MOBILE_ANALYSIS_MAX_CHANNELS) : list
    },
    [channels, analysisLabels, mobileViewport],
  )
  const analysisSeries = useMemo(() => analysisChannels.map((c) => c.series[0]), [analysisChannels])
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
    if (activeLog) setAnalysisLabels(analysisDefaults(activeLog))
    // Reset scale/shift, but keep the colours and line weights the user picked.
    setAnalysisTransforms((prev) => {
      const next: Record<string, Transform> = {}
      for (const [label, style] of Object.entries(prev)) {
        if (style.color || style.width != null) next[label] = { gain: 1, offset: 0, color: style.color, width: style.width }
      }
      return next
    })
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
  fitWindowRef.current = fitWindow

  // Typing in quick search always shows the matches from the top of the list.
  useEffect(() => {
    if (matrixQuery) mainRef.current?.scrollTo({ top: 0 })
  }, [matrixQuery])

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
        windowMode={windowMode}
        onWindowModeChange={setWindowMode}
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
        hidden={view === "plot" ? analysisHidden : hidden}
        onToggleChannel={
          view === "plot"
            ? (key: string) => {
                const target = channels.find((c) => c.key === key)
                if (target) toggleAnalysisLabel(target.label)
              }
            : toggleChannel
        }
        onScrollToChannel={onScrollToVisibleChannel}
        onShowAll={() => (view === "plot" ? setVisibleLabels(channels.map((c) => c.label)) : setHidden(new Set()))}
        onHideAll={() => (view === "plot" ? setAnalysisLabels(new Set()) : setHidden(new Set(channels.map((c) => c.key))))}
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

  // Arrow keys walk the value cursor sample-by-sample through the active log.
  // If it leaves the visible window, the window follows.
  function moveCursor(dir: -1 | 1) {
    const source = (comparing ? logs[0] : activeLog)?.signals[0]?.data
    if (!source?.length || duration <= 0) return
    if (!sync) setSync(true)
    const width = domain[1] - domain[0]
    let target: number
    if (cursorT == null || cursorT < domain[0] || cursorT > domain[1]) {
      target = (domain[0] + domain[1]) / 2
      // snap to the nearest sample
      let lo = 0
      let hi = source.length - 1
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        if (source[mid].t < target) lo = mid + 1
        else hi = mid
      }
      target = source[lo].t
    } else {
      let lo = 0
      let hi = source.length - 1
      if (dir > 0) {
        // first sample strictly after the cursor
        while (lo < hi) {
          const mid = (lo + hi) >> 1
          if (source[mid].t <= cursorT + 1e-9) lo = mid + 1
          else hi = mid
        }
        target = source[lo].t > cursorT ? source[lo].t : cursorT
      } else {
        // last sample strictly before the cursor
        while (lo < hi) {
          const mid = (lo + hi + 1) >> 1
          if (source[mid].t < cursorT - 1e-9) lo = mid
          else hi = mid - 1
        }
        target = source[lo].t < cursorT ? source[lo].t : cursorT
      }
    }
    setCursorT(target)
    if (width > 0 && width < duration && (target < domain[0] || target > domain[1])) {
      const start = Math.max(0, Math.min(duration - width, target - width / 2))
      setDomain([+start.toFixed(3), +(start + width).toFixed(3)])
    }
  }

  const shortcuts: Shortcut[] = [
    { ...bindings.openLog, description: "Open log", handler: () => openCsvDialog(loadFile) },
    { ...bindings.searchChannels, description: "Search channels", handler: () => searchRef.current?.focus() },
    { ...bindings.sync, description: "Toggle signal sync", handler: () => setSync((v) => !v) },
    { ...bindings.annotate, description: "Toggle annotate mode", handler: () => setAnnotate((v) => !v) },
    { ...bindings.viewMatrix, description: "Signal Matrix view", handler: () => changeView("matrix") },
    { ...bindings.viewPlot, description: "Analysis Plot view", handler: () => changeView("plot") },
    { ...bindings.viewChannels, description: "Channels view", handler: () => !mobileViewport && changeView("channels") },
    { ...bindings.viewCompare, description: "Compare view", handler: () => !mobileViewport && changeView("compare") },
    { ...bindings.togglePick, description: "Toggle readout picking", handler: () => setReadoutPicking((value) => !value) },
    { ...bindings.editChannels, description: "Edit templates", handler: () => !mobileViewport && view === "channels" && setChannelsEditOpen(true) },
    { ...bindings.reset, description: "Reset view", handler: resetControls },
    { ...bindings.toggleGrid, description: "Toggle grid lines", handler: () => setDisplay((d) => ({ ...d, showGrid: !d.showGrid })) },
    { ...bindings.lockCompare, description: "Lock alignment (Compare)", handler: () => setCompareLocked((v) => !v) },
    { ...bindings.windowMode, description: "Toggle window mode", handler: () => setWindowMode((v) => !v) },
    { ...bindings.zoomIn, description: "Zoom time window in", handler: () => zoomBy(1.5) },
    { ...bindings.zoomOut, description: "Zoom time window out", handler: () => zoomBy(1 / 1.5) },
    { ...bindings.panLeft, description: "Shift time window left", handler: () => panBy(-0.2) },
    { ...bindings.panRight, description: "Shift time window right", handler: () => panBy(0.2) },
    {
      ...bindings.quickSearch,
      description: "Quick search (Signal Matrix / Compare)",
      handler: () => {
        if (view !== "matrix" && !comparing) return
        if (comparing) setCompareMode("matrix")
        setQuickOpen(true)
        setTimeout(() => quickRef.current?.focus(), 0)
      },
    },
    { ...bindings.previousFile, description: "Previous loaded / reference file", handler: () => switchLoadedLog(-1) },
    { ...bindings.cycleFile, description: "Next loaded / reference file", handler: () => switchLoadedLog(1) },
    {
      ...bindings.heightCycle,
      description: "Cycle chart height (Signal Matrix)",
      handler: () =>
        setDisplay((d) => {
          const order = ["mini", "compact", "normal", "tall"] as const
          return { ...d, height: order[(order.indexOf(d.height) + 1) % order.length] }
        }),
    },
    { ...bindings.scrollTop, description: "Scroll to top", handler: () => mainRef.current?.scrollTo({ top: 0, behavior: "smooth" }) },
    { ...bindings.shortcutsHelp, description: "Toggle keyboard shortcuts", handler: () => !mobileViewport && setShowShortcuts((v) => !v) },
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
        else if (windowMode) setWindowMode(false)
      },
    },
  ]
  useShortcuts(shortcuts, hasLogs)

  // Value cursor on the arrow keys (remappable): a tap moves exactly one sample;
  // holding the key glides the cursor at a steady on-screen speed (Settings →
  // Cursor glide speed), driven by animation frames instead of the OS
  // key-repeat, so it never queues up or jumps.
  const secondsPerScreen = useCursorSpeed()
  const glideState = useRef({ cursorT, domain, duration, secondsPerScreen })
  glideState.current = { cursorT, domain, duration, secondsPerScreen }
  const moveCursorRef = useRef(moveCursor)
  moveCursorRef.current = moveCursor
  useEffect(() => {
    if (!hasLogs) return
    let glide: { dir: -1 | 1; key: string; raf: number; timer: number; start: number; last: number } | null = null
    const stop = () => {
      if (!glide) return
      cancelAnimationFrame(glide.raf)
      window.clearTimeout(glide.timer)
      glide = null
    }
    const frame = (now: number) => {
      const g = glide
      if (!g) return
      const dt = Math.min(0.1, (now - g.last) / 1000)
      g.last = now
      const st = glideState.current
      let [a, b] = st.domain
      const width = b - a
      if (width <= 0 || st.duration <= 0) return
      // crosses the visible window in N seconds (Settings → Cursor glide speed)
      const speed = width / Math.max(1, st.secondsPerScreen)
      const from = st.cursorT ?? (a + b) / 2
      const t = Math.max(0, Math.min(st.duration, from + g.dir * speed * dt))
      // keep the cursor inside the window: the window slides along with it
      if (width < st.duration) {
        if (t > b) {
          b = t
          a = t - width
        } else if (t < a) {
          a = t
          b = t + width
        }
        if (a < 0) {
          a = 0
          b = width
        }
        if (b > st.duration) {
          b = st.duration
          a = st.duration - width
        }
        if (a !== st.domain[0]) setDomain([a, b])
      }
      setCursorT(t)
      glideState.current = { ...st, cursorT: t, domain: [a, b] }
      if ((g.dir > 0 && t >= st.duration) || (g.dir < 0 && t <= 0)) return stop()
      g.raf = requestAnimationFrame(frame)
    }
    const onDown = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return
      const dir = matchesKey(e, bindings.cursorRight) ? 1 : matchesKey(e, bindings.cursorLeft) ? -1 : 0
      if (!dir) return
      e.preventDefault()
      if (e.repeat) return // holding is handled by the glide, not by OS key-repeat
      stop()
      if (!sync) setSync(true)
      moveCursorRef.current(dir)
      const g = { dir: dir as -1 | 1, key: canonicalKey(e.key), raf: 0, timer: 0, start: 0, last: 0 }
      g.timer = window.setTimeout(() => {
        g.start = g.last = performance.now()
        g.raf = requestAnimationFrame(frame)
      }, 220)
      glide = g
    }
    const onUp = (e: KeyboardEvent) => {
      if (glide && canonicalKey(e.key) === glide.key) stop()
    }
    window.addEventListener("keydown", onDown)
    window.addEventListener("keyup", onUp)
    window.addEventListener("blur", stop)
    return () => {
      stop()
      window.removeEventListener("keydown", onDown)
      window.removeEventListener("keyup", onUp)
      window.removeEventListener("blur", stop)
    }
  }, [hasLogs, bindings, sync])

  return (
    <div
      className={cn(
        "isolate flex h-dvh overflow-hidden bg-background text-foreground",
        (view === "plot" || view === "channels") && "mobile-analysis-mode",
        view === "matrix" && "mobile-matrix-mode",
        hasLogs && view === "matrix" && "has-mobile-simple-actions",
        mobileSearchActive && "mobile-search-active",
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
              <LicenseBadge
                email={displayEmail}
                firstLoginAt={accountUser?.firstLoginAt}
                expiresAt={accountUser?.licenseExpiresAt}
                isOwner={accountUser?.isOwner}
                onClick={canUseCloudLogs && accountUser ? () => setShowLicenses(true) : undefined}
                compact
              />
            </span>
            {canUseCloudLogs && (
              <button
                type="button"
                onClick={() => setShowCloudLogs(true)}
                title="Cloud Logs"
                aria-label="Cloud Logs"
                className="hidden items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-secondary lg:inline-flex"
              >
                <Cloud className="size-3.5" />
                <span className="octane-action-label hidden xl:inline">Cloud Logs</span>
              </button>
            )}

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
              title="Add another local CSV/TXT log"
              aria-label="Add local CSV"
              className="hidden items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-secondary lg:inline-flex"
            >
              <Upload className="size-3.5" />
              <span className="octane-action-label hidden sm:inline">Add CSV</span>
            </button>
            {hasLogs && (
              <button
                type="button"
                onClick={exportCsv}
                title="Export only the currently visible channels"
                aria-label="Export visible channels"
                className="hidden items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-secondary lg:inline-flex"
              >
                <Download className="size-3.5" />
                <span className="octane-action-label hidden sm:inline">Export visible</span>
              </button>
            )}
          </div>
        </header>

        {!hasLogs ? (
          <div className="flex flex-1 items-center justify-center p-4 sm:p-6">
            <div className="w-full max-w-xl">
              <UploadZone onFile={loadFile} loading={loading} error={error} />
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

                {view !== "channels" && <div className={cn(
                  "analysis-heading mt-5 mb-3 flex flex-wrap items-center justify-between gap-2 sm:gap-3",
                  // Compare: keep search + files reachable while scrolling through the graphs
                  comparing && "sticky -top-4 z-20 -mx-3 border-b border-border bg-background/95 px-3 py-2 backdrop-blur sm:-top-5 sm:-mx-5 sm:px-5",
                )}>
                  <div className="flex shrink-0 items-center gap-3">
                    <h2 className="text-sm font-semibold text-foreground">
                      {view === "plot" ? "Analysis Plot" : comparing ? "Comparison" : "Signal Matrix"}
                    </h2>
                    {comparing && (
                      <div className="inline-flex items-center rounded-md border border-border bg-card p-0.5" role="tablist" aria-label="Compare layout">
                        {(["matrix", "areas"] as const).map((mode) => (
                          <button
                            key={mode}
                            type="button"
                            role="tab"
                            aria-selected={compareMode === mode}
                            onClick={() => setCompareMode(mode)}
                            className={cn(
                              "h-7 rounded px-2.5 text-[11px] font-semibold transition-colors",
                              compareMode === mode ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                            )}
                          >
                            {mode === "matrix" ? "Signal matrix" : "Overlay areas"}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {view !== "plot" && (
                    <div className="hidden flex-1 items-center justify-end gap-2 lg:flex">
                      {quickOpen ? (
                        <div className="relative w-full max-w-xs">
                          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                          <input
                            ref={quickRef}
                            autoFocus
                            value={matrixQuery}
                            onChange={(e) => {
                              if (comparing) setCompareMode("matrix")
                              setMatrixQuery(e.target.value)
                            }}
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
                          onClick={() => {
                            if (comparing) setCompareMode("matrix")
                            setQuickOpen(true)
                          }}
                          title="Quick search a plot (/)"
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
                  {comparing && (
                    <div className="flex w-full flex-wrap items-center gap-1.5" aria-label="Files in this comparison">
                      {logs.map((l, i) => (
                        <span
                          key={`${l.fileName}-${i}`}
                          className="inline-flex max-w-[22rem] items-center gap-1.5 rounded-md border border-border bg-card py-0.5 pl-2 pr-0.5 text-xs text-foreground"
                          title={l.fileName}
                        >
                          <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: FILE_COLORS[i % FILE_COLORS.length] }} />
                          <span className="truncate">{l.fileName.replace(/\.[^.]+$/, "")}</span>
                          <button
                            type="button"
                            onClick={() => removeLog(i)}
                            aria-label={`Close ${l.fileName}`}
                            title="Close this file"
                            className="inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive"
                          >
                            <X className="size-3.5" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>}

                {comparing && compareMode === "areas" ? (
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
                    windowMode={windowMode}
                    onWindowSelect={selectWindow}
                    onRemoveFile={(name) => {
                      const idx = logs.findIndex((l) => l.fileName === name)
                      if (idx >= 0) removeLog(idx)
                    }}
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
                      series={analysisSeries}
                      availableSeries={allSeries}
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
                      onToggleChannelLabel={toggleAnalysisLabel}
                      onSetVisibleLabels={setVisibleLabels}
                      windowMode={windowMode}
                      onWindowModeChange={setWindowMode}
                      onWindowSelect={selectWindow}
                      maxLines={MOBILE_ANALYSIS_MAX_CHANNELS}
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
                            <h3 className="text-sm font-semibold text-foreground">Template Diagnostics</h3>
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
                              Edit templates
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
                              onClick={() => setWindowMode((value) => !value)}
                              aria-pressed={windowMode}
                              title="Drag on a graph to set the shared time window (W)"
                              className={cn(
                                "inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors",
                                windowMode
                                  ? "border-primary bg-primary/15 text-foreground"
                                  : "border-border bg-card text-muted-foreground hover:bg-secondary hover:text-foreground",
                              )}
                            >
                              <MoveHorizontal className="size-3.5" />
                              Window
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
                        <div className="octane-channel-tabs flex flex-wrap items-center gap-1.5">
                          {templates.map((template) => (
                            <button
                              key={template.id}
                              type="button"
                              onClick={() => {
                                setActiveTemplateId(template.id)
                                setChannelsPaneQuery("")
                              }}
                              aria-pressed={activePreset.id === template.id}
                              className={cn(
                                "h-8 rounded-md border px-3 text-xs font-medium transition-colors",
                                activePreset.id === template.id
                                  ? "border-primary bg-primary/15 text-foreground shadow-[inset_0_-2px_0_var(--primary)]"
                                  : "border-border bg-background/60 text-muted-foreground hover:bg-secondary hover:text-foreground",
                              )}
                            >
                              {template.name}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="flex min-h-0 flex-1">
                        <div className="relative flex min-w-0 flex-1 flex-col">
                          {presetMatch.channels.length === 0 ? (
                            <div className="flex min-h-0 flex-1 items-center justify-center px-4 text-center text-sm text-muted-foreground">
                              No channels from the {activePreset.name} template were found in this log.
                            </div>
                          ) : (
                            <CombinedChart
                              series={presetSeries}
                              availableSeries={allSeries}
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
                              windowMode={windowMode}
                              onWindowSelect={selectWindow}
                              onFitWindow={fitWindowStable}
                            />
                          )}
                        </div>

                        {channelsPaneOpen && (
                          <ChannelsStatsPane
                            presetName={activePreset.name}
                            colorOf={presetColors}
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

                    {mobileViewport && (
                    <div className="flex min-h-0 flex-1 flex-col gap-3 lg:hidden">
                      <div className="flex gap-1 overflow-x-auto rounded-lg border border-border bg-card/50 p-1">
                        {templates.map((preset) => (
                          <button
                            key={preset.id}
                            type="button"
                            onClick={() => setActiveTemplateId(preset.id)}
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
                          No channels from the {activePreset.name} template were found in this log.
                        </div>
                      ) : (
                        <CombinedChart
                          series={presetSeries}
                          availableSeries={allSeries}
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
                          windowMode={windowMode}
                          onWindowModeChange={setWindowMode}
                          onWindowSelect={selectWindow}
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
                    )}
                  </div>
                ) : matrixChannels.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border py-16 text-center text-sm text-muted-foreground">
                    {matrixQuery ? `No channels match "${matrixQuery}".` : "No channels selected. Enable some from Controls."}
                  </div>
                ) : (
                  <div className="flex flex-col gap-4 pb-20 lg:pb-4">
                    {matrixChannels.map((c) => (
                      <LazyMount
                        key={c.key}
                        id={`chart-${c.key}`}
                        root={mainRef}
                        estimate={collapsed.has(c.key) ? 60 : CHART_INTRINSIC_HEIGHT[display.height] + (c.series.length > 1 ? 28 : 0)}
                        className={cn(
                          "rounded-xl transition-shadow",
                          matrixHighlight === c.key && "ring-2 ring-primary ring-offset-2 ring-offset-background",
                        )}
                      >
                      <SignalChart
                        channelKey={c.key}
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
                        windowMode={windowMode}
                        onWindowSelect={selectWindow}
                        onWindowReset={fitWindowStable}
                      />
                      </LazyMount>
                    ))}
                  </div>
                )}
              </main>
              {(comparing ? logs[0] : activeLog) && (
                <FlagStrip
                  signals={(comparing ? logs[0] : activeLog)!.signals}
                  cursorT={sync ? cursorT : null}
                  domain={domain}
                  timeUnit={timeUnit}
                  onJump={jumpToTime}
                />
              )}
            </div>
            </div>
          </>
        )}
      </div>

      {windowMode && hasLogs && (
        <div className="pointer-events-none fixed inset-x-0 top-16 z-[45] flex justify-center px-4 lg:top-[4.25rem]">
          <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-primary/50 bg-popover/95 px-4 py-1.5 text-xs text-foreground shadow-2xl backdrop-blur">
            <span className="size-2 animate-pulse rounded-full bg-primary" />
            <span>
              <span className="font-semibold">Window mode</span> · drag across any graph to choose a time range
            </span>
            <span className="hidden text-muted-foreground sm:inline">Esc cancels · {keyLabel(bindings.windowMode)} toggles</span>
            <button
              type="button"
              onClick={() => setWindowMode(false)}
              aria-label="Cancel window mode"
              className="inline-flex size-5 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          </div>
        </div>
      )}
      <AboutModal open={showAbout} onClose={() => setShowAbout(false)} />
      <ShortcutsModal
        open={showShortcuts}
        view={view}
        onClose={() => setShowShortcuts(false)}
        onEditBindings={() => {
          setShowShortcuts(false)
          setSettingsPage("keys")
          setShowSettings(true)
        }}
      />
      <SettingsModal
        open={showSettings}
        initialPage={settingsPage}
        settings={display}
        onChange={setDisplay}
        onReset={() => setDisplay(DEFAULT_DISPLAY)}
        onClose={() => {
          setShowSettings(false)
          setSettingsPage("main")
        }}
      />
      <MetadataModal open={showMetadata} log={activeLog ?? null} onClose={() => setShowMetadata(false)} />
      <LicensesDialog open={showLicenses} onClose={() => setShowLicenses(false)} />
      <CloudLogsDialog
        open={showCloudLogs}
        activeLog={activeLog ?? null}
        onClose={() => setShowCloudLogs(false)}
        onLoad={loadCloudParsedLog}
      />
      <ChannelsHelpDialog open={channelsHelpOpen} onClose={() => setChannelsHelpOpen(false)} />
      <TemplateEditor
        open={channelsEditOpen}
        templates={templates}
        activeTemplateId={activeTemplate?.id ?? null}
        channels={channels.map((c) => ({ key: c.key, label: c.label, unit: c.unit }))}
        onSave={saveAllTemplates}
        onClose={() => setChannelsEditOpen(false)}
      />
      {hasLogs && view === "matrix" && (
        <div className={cn("octane-mobile-quick-search fixed inset-x-3 z-40 lg:hidden", mobileSearchActive && "is-active")}>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={mobileQuickRef}
              value={matrixQuery}
              enterKeyHint="search"
              onFocus={() => {
                setQuickOpen(true)
                setMobileSearchActive(true)
                mainRef.current?.scrollTo({ top: 0 })
              }}
              onBlur={() => setMobileSearchActive(false)}
              onChange={(event) => {
                setQuickOpen(true)
                setMatrixQuery(event.target.value)
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === "Escape") {
                  event.preventDefault()
                  event.stopPropagation()
                  event.currentTarget.blur()
                  landOnChannel()
                }
              }}
              placeholder="Quick search channels..."
              className="h-10 w-full rounded-full border border-border bg-popover/95 pl-10 pr-10 text-sm text-foreground shadow-2xl backdrop-blur placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
            />
            {matrixQuery && (
              <button
                type="button"
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => {
                  setMatrixQuery("")
                  mobileQuickRef.current?.focus()
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
        <div className="octane-mobile-simple-actions fixed inset-x-0 z-40 grid grid-cols-5 gap-1 border-t border-border bg-background/95 px-2 py-2 backdrop-blur lg:hidden">
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
            onClick={() => setWindowMode((value) => !value)}
            aria-pressed={windowMode}
            title="Drag across a plot to set the time window"
            className={cn("octane-mobile-simple-button", windowMode && "is-active")}
          >
            <MoveHorizontal className="size-3.5" />
            Window
          </button>
          <button
            type="button"
            onClick={() => setMobileWindowOpen((value) => !value)}
            aria-pressed={mobileWindowOpen}
            className={cn("octane-mobile-simple-button", mobileWindowOpen && "is-active")}
          >
            <SlidersHorizontal className="size-3.5" />
            Range
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
  colorOf,
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
  colorOf: Record<string, string>
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
  const colorFor = (channel: Channel) => colorOf[channel.label] ?? "var(--muted-foreground)"
  const decoders = useFlagDecoders()

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
                {(() => {
                  const dec = decoderFor(channel.label, decoders)
                  if (!dec || cursorT == null) return null
                  const text = describe(dec, decodeValue(dec, stepValueAt(signal.data, cursorT)))
                  return <span className="ml-4 text-[10px] leading-snug text-muted-foreground">{text}</span>
                })()}
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
      title: "Template tabs",
      body: "Each tab is one of your templates (the same list the Analysis Plot and the phone picker use), split into a few graphs. Use Edit templates to change a template's channels or graphs.",
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
            <h3 className="mt-1 text-lg font-semibold text-foreground">Using template diagnostics</h3>
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
