"use client"

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react"
import { Download, Search, TriangleAlert, Upload, X } from "lucide-react"
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
  persistTemplates,
  serializeTemplates,
  parseImportedTemplates,
  makeTemplateId,
  type Template,
} from "@/lib/templates"
import { useShortcuts, type Shortcut } from "@/hooks/use-shortcuts"
import { useBindings } from "@/lib/keybindings"
import { Rail, type ViewMode } from "./rail"
import { ControlPanel, type ChannelItem } from "./control-panel"
import { CombinedChart, type Transform } from "./combined-chart"
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
import { AnnotationDialog, type AnnotationDraft } from "./annotation-dialog"
import { cn } from "@/lib/utils"

const MIN_ZOOM = 100
const MAX_ZOOM = 800
const DEFAULT_VISIBLE = 6
const FILE_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"]

function defaultHidden(log: ParsedLog): Set<string> {
  return new Set(log.signals.slice(DEFAULT_VISIBLE).map((s) => s.key))
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

export const Dashboard = forwardRef<DashboardHandle, { initialLog?: ParsedLog | null; onHome?: () => void }>(
  function Dashboard({ initialLog = null, onHome }, ref) {
  const [logs, setLogs] = useState<ParsedLog[]>(initialLog ? [initialLog] : [])
  const [activeIndex, setActiveIndex] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [sync, setSync] = useState(true)
  const [view, setView] = useState<ViewMode>("matrix")
  const [annotate, setAnnotate] = useState(false)
  const [zoom, setZoom] = useState(100)
  const [domain, setDomain] = useState<[number, number]>(initialLog ? [0, initialLog.duration] : [0, 0])
  const [cursorT, setCursorT] = useState<number | null>(null)
  const [query, setQuery] = useState("")
  const [collapsed, setCollapsed] = useState<Set<SignalKey>>(new Set())
  const [hidden, setHidden] = useState<Set<SignalKey>>(initialLog ? defaultHidden(initialLog) : new Set())
  const [display, setDisplay] = useState<DisplaySettings>(DEFAULT_DISPLAY)

  // Per-file working state, so switching logs resumes where you left off.
  const sessionsRef = useRef<Map<string, Session>>(new Map())
  const [templates, setTemplates] = useState<Template[]>([])
  useEffect(() => {
    loadTemplates().then(setTemplates)
  }, [])

  // Analysis Plot state (persisted across view switches).
  const [analysisTransforms, setAnalysisTransforms] = useState<Record<string, Transform>>({})
  const [analysisFocus, setAnalysisFocus] = useState<string | null>(null)
  const [analysisMarkPeaks, setAnalysisMarkPeaks] = useState(false)

  // Compare workspace state.
  const [compareAreas, setCompareAreas] = useState<string[][]>([[], [], []])
  const [fileOffsets, setFileOffsets] = useState<Record<string, number>>({})
  const [activeCompareFile, setActiveCompareFile] = useState<string | null>(null)
  const [compareLocked, setCompareLocked] = useState(false)

  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [annotationDraft, setAnnotationDraft] = useState<AnnotationDraft | null>(null)
  const [showAbout, setShowAbout] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showMetadata, setShowMetadata] = useState(false)
  const [quickOpen, setQuickOpen] = useState(false)
  const [matrixQuery, setMatrixQuery] = useState("")
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

  const duration = useMemo(() => {
    if (!logs.length) return 0
    if (comparing) return Math.max(...logs.map((l) => l.duration))
    return (logs[activeIndex] ?? logs[0]).duration
  }, [logs, comparing, activeIndex])

  const channels = useMemo<Channel[]>(() => {
    if (!logs.length) return []
    if (!comparing) {
      const log = logs[activeIndex] ?? logs[0]
      return log.signals.map((sig) => ({
        key: sig.key,
        label: sig.label,
        unit: sig.unit,
        decimals: sig.decimals,
        series: [
          { id: `${activeIndex}-${sig.key}`, name: log.fileName, color: `var(--chart-${sig.color})`, signal: sig },
        ],
        diffStats: null,
      }))
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

  const channelItems: ChannelItem[] = useMemo(
    () => channels.map((c) => ({ key: c.key, label: c.label, unit: c.unit, color: c.series[0].color })),
    [channels],
  )

  // Load annotations whenever the active log changes.
  useEffect(() => {
    if (activeLog) setAnnotations(loadAnnotations(activeLog.fileName))
    else setAnnotations([])
  }, [activeLog])

  function resetView(dur: number) {
    setZoom(100)
    setDomain([0, dur])
    setCursorT(null)
  }

  function saveSession() {
    if (!activeLog) return
    sessionsRef.current.set(activeLog.fileName, { hidden, domain, zoom, collapsed, cursorT })
  }

  function applyDefaults(log: ParsedLog) {
    setHidden(defaultHidden(log))
    setCollapsed(new Set())
    viewWindowsRef.current = {} // per-view windows don't carry across files
    resetView(log.duration)
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
      setError(e instanceof Error ? e.message : "Could not parse this file.")
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

  // Expose the open-log action to the Electron native menu (File → Open log).
  useEffect(() => {
    ;(window as unknown as { __octaneOpenLog?: () => void }).__octaneOpenLog = () => openCsvDialog(loadFile)
  })

  function loadSample() {
    setLogs([SAMPLE_LOG])
    setActiveIndex(0)
    setError(null)
    setQuery("")
    applyDefaults(SAMPLE_LOG)
  }

  function selectLog(i: number) {
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
    } else {
      applyDefaults(target)
    }
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
    } else {
      const dur = nextView === "compare" && next.length > 1 ? Math.max(...next.map((l) => l.duration)) : target.duration
      setHidden(defaultHidden(target))
      setCollapsed(new Set())
      resetView(dur)
    }
  }

  function changeView(next: ViewMode) {
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
  // Quick-search overrides the checklist for the Signal Matrix: type to view any plot fast.
  const matrixChannels = useMemo(() => {
    const q = matrixQuery.trim().toLowerCase()
    return q ? channels.filter((c) => c.label.toLowerCase().includes(q)) : visibleChannels
  }, [matrixQuery, channels, visibleChannels])
  const activeCount = visibleChannels.length

  const kpis = useMemo(
    () => (activeLog ? computeKpis(activeLog, activeCount) : []),
    [activeLog, activeCount],
  )

  const overview: OverviewSeries[] = useMemo(
    () => visibleChannels.slice(0, 3).map((c) => ({ color: c.series[0].color, data: c.series[0].signal.data })),
    [visibleChannels],
  )

  const shortcuts: Shortcut[] = [
    { key: "o", ctrl: true, description: "Open log", handler: () => openCsvDialog(loadFile) },
    { key: "k", ctrl: true, description: "Search channels", handler: () => searchRef.current?.focus() },
    { key: bindings.sync, description: "Toggle signal sync", handler: () => setSync((v) => !v) },
    { key: bindings.annotate, description: "Toggle annotate mode", handler: () => setAnnotate((v) => !v) },
    { key: bindings.viewMatrix, description: "Signal Matrix view", handler: () => changeView("matrix") },
    { key: bindings.viewPlot, description: "Analysis Plot view", handler: () => changeView("plot") },
    { key: bindings.viewCompare, description: "Compare view", handler: () => changeView("compare") },
    { key: bindings.reset, description: "Reset view", handler: () => resetView(duration) },
    { key: bindings.toggleGrid, description: "Toggle grid lines", handler: () => setDisplay((d) => ({ ...d, showGrid: !d.showGrid })) },
    { key: bindings.lockCompare, description: "Lock alignment (Compare)", handler: () => setCompareLocked((v) => !v) },
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
    { key: "?", shift: true, description: "About Octane", handler: () => setShowAbout((v) => !v) },
    {
      key: "Escape",
      description: "Close dialogs / exit annotate",
      // Priority: close the top-most thing only. The Analysis Plot handles its own
      // Escape (fullscreen → focus) when no modal/draft is open.
      handler: () => {
        if (showAbout) setShowAbout(false)
        else if (showSettings) setShowSettings(false)
        else if (annotationDraft) setAnnotationDraft(null)
        else if (annotate) setAnnotate(false)
        else if (quickOpen) {
          setMatrixQuery("")
          setQuickOpen(false)
        }
      },
    },
  ]
  useShortcuts(shortcuts, hasLogs)

  // Let the native Help → About menu open the in-app About modal.
  useEffect(() => {
    ;(window as unknown as { __octaneOpenAbout?: () => void }).__octaneOpenAbout = () => setShowAbout(true)
  })

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
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
        <header className="sticky top-0 z-20 flex h-14 items-center gap-4 border-b border-border bg-background/85 px-5 backdrop-blur">
          <div className="flex min-w-0 flex-col">
            <h1 className="truncate text-sm font-semibold tracking-tight">
              {activeLog ? activeLog.fileName : "Octane · Signal Matrix"}
            </h1>
            {activeLog && (
              <span className="font-mono text-[11px] text-muted-foreground">
                {activeLog.sizeLabel} · {activeLog.samples.toLocaleString()} samples · {duration.toFixed(1)}
                {timeUnit}
              </span>
            )}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => openCsvDialog(loadFile)}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-secondary"
            >
              <Upload className="size-3.5" />
              Import CSV
            </button>
            {hasLogs && (
              <button
                type="button"
                onClick={exportCsv}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-secondary"
              >
                <Download className="size-3.5" />
                Export
              </button>
            )}
          </div>
        </header>

        {!hasLogs ? (
          <div className="flex flex-1 items-center justify-center p-6">
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
            <aside className="hidden w-72 shrink-0 border-r border-border lg:block">
              <ControlPanel
                query={query}
                onQueryChange={setQuery}
                searchRef={searchRef}
                sync={sync}
                onSyncChange={setSync}
                annotate={annotate}
                onAnnotateChange={setAnnotate}
                onReset={() => {
                  resetView(duration)
                  setCollapsed(new Set())
                }}
                onFit={() => {
                  setZoom(100)
                  setDomain([0, duration])
                }}
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
                onScrollToChannel={scrollToChannel}
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
              />
            </aside>

            {/* Main content */}
            <div className="flex min-w-0 flex-1 flex-col">
              <main ref={mainRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
                {kpis.length > 0 && <KpiCards kpis={kpis} />}

                {logs.length > 1 && (
                  <div className="mt-4">
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

                <div className="mt-5 mb-3 flex items-center justify-between gap-3">
                  <h2 className="shrink-0 text-sm font-semibold text-foreground">
                    {view === "plot" ? "Analysis Plot" : comparing ? "Comparison" : "Signal Matrix"}
                  </h2>
                  {!comparing && view !== "plot" && (
                    <div className="flex flex-1 items-center justify-end gap-2">
                      {quickOpen ? (
                        <div className="relative w-full max-w-xs">
                          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                          <input
                            ref={quickRef}
                            autoFocus
                            value={matrixQuery}
                            onChange={(e) => setMatrixQuery(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Escape") {
                                setMatrixQuery("")
                                setQuickOpen(false)
                              }
                            }}
                            placeholder="Quick search — show a plot…"
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
                </div>

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
                  visibleChannels.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-border py-16 text-center text-sm text-muted-foreground">
                      No channels selected. Enable some from the panel on the left.
                    </div>
                  ) : (
                  <div className="pb-4">
                    <CombinedChart
                      series={visibleChannels.map((c) => c.series[0])}
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
                      modalOpen={showAbout || showSettings || annotationDraft != null}
                      onCursorChange={setCursorT}
                      onAddAnnotation={openAnnotation}
                    />
                  </div>
                  )
                ) : matrixChannels.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border py-16 text-center text-sm text-muted-foreground">
                    {matrixQuery ? `No channels match “${matrixQuery}”.` : "No channels selected. Enable some from the panel on the left."}
                  </div>
                ) : (
                  <div className="flex flex-col gap-4 pb-4">
                    {matrixChannels.map((c) => (
                      <SignalChart
                        key={c.key}
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
      <SettingsModal
        open={showSettings}
        settings={display}
        onChange={setDisplay}
        onReset={() => setDisplay(DEFAULT_DISPLAY)}
        onClose={() => setShowSettings(false)}
      />
      <MetadataModal open={showMetadata} log={activeLog ?? null} onClose={() => setShowMetadata(false)} />
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
