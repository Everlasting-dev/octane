"use client"

import { HelpTip } from "./help-tip"
import { useEffect, useMemo, useRef, useState } from "react"
import { ChevronDown, ChevronRight, CircleCheck, CircleSlash, Crosshair, LineChart, RotateCcw, ShieldAlert, TriangleAlert, Info, X } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  RULES,
  RULE_BY_ID,
  SYSTEM_ORDER,
  ruleEnabled,
  ruleParams,
  type CheckReport,
  type CheckSeverity,
  type Finding,
  type RuleDef,
  type SelfCheckConfig,
} from "@/lib/self-check"
import type { SelfCheckPrefs } from "@/lib/self-check-store"
import { ResizeHandle, usePanelWidth } from "./resizable"

export const SEVERITY_TONE: Record<CheckSeverity, { text: string; bg: string; border: string; fill: string; label: string }> = {
  critical: { text: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/40", fill: "#f87171", label: "Critical" },
  warn: { text: "text-amber-300", bg: "bg-amber-400/10", border: "border-amber-400/40", fill: "#fcd34d", label: "Warning" },
  info: { text: "text-sky-300", bg: "bg-sky-400/10", border: "border-sky-400/30", fill: "#7dd3fc", label: "Info" },
}

export function SeverityIcon({ severity, className }: { severity: CheckSeverity; className?: string }) {
  const Icon = severity === "critical" ? ShieldAlert : severity === "warn" ? TriangleAlert : Info
  return <Icon className={cn("shrink-0", SEVERITY_TONE[severity].text, className)} />
}

const RANK: Record<CheckSeverity, number> = { info: 0, warn: 1, critical: 2 }

function fmtT(t: number, unit: string) {
  return `${t.toFixed(t >= 100 ? 1 : 2)}${unit}`
}

interface SelfCheckPanelProps {
  report: CheckReport | null
  fileName: string
  timeUnit: string
  mobile: boolean
  prefs: SelfCheckPrefs
  onPrefsChange: (p: SelfCheckPrefs) => void
  config: SelfCheckConfig
  onConfigChange: (c: SelfCheckConfig) => void
  selectedId: string | null
  onJump: (f: Finding) => void
  onPlot: (f: Finding) => void
  onClose: () => void
}

export function SelfCheckPanel({
  report,
  fileName,
  timeUnit,
  mobile,
  prefs,
  onPrefsChange,
  config,
  onConfigChange,
  selectedId,
  onJump,
  onPlot,
  onClose,
}: SelfCheckPanelProps) {
  const [tab, setTab] = useState<"findings" | "tune">("findings")
  const [filter, setFilter] = useState<CheckSeverity | null>(null)
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [showPassed, setShowPassed] = useState(false)
  const panel = usePanelWidth("self-check", 432, 320, 960)
  const ref = useRef<HTMLElement>(null)

  // Close on a click or tap anywhere outside the panel (the header toggle and
  // the strip chip handle themselves), and on Esc.
  useEffect(() => {
    function onDown(e: PointerEvent) {
      const t = e.target as Element | null
      if (!t || ref.current?.contains(t) || t.closest?.("[data-self-check-toggle]")) return
      onClose()
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("pointerdown", onDown, true)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("pointerdown", onDown, true)
      document.removeEventListener("keydown", onKey)
    }
  }, [onClose])

  const groups = useMemo(() => {
    if (!report) return []
    const out: { rule: RuleDef; findings: Finding[]; worst: CheckSeverity }[] = []
    for (const r of report.results) {
      const findings = r.findings.filter((f) => !filter || f.severity === filter)
      if (!findings.length) continue
      const rule = RULE_BY_ID[r.ruleId]
      const worst = findings.reduce<CheckSeverity>((w, f) => (RANK[f.severity] > RANK[w] ? f.severity : w), "info")
      out.push({ rule, findings: [...findings].sort((a, b) => a.start - b.start), worst })
    }
    return out.sort(
      (a, b) => RANK[b.worst] - RANK[a.worst] || SYSTEM_ORDER.indexOf(a.rule.system) - SYSTEM_ORDER.indexOf(b.rule.system),
    )
  }, [report, filter])

  const passed = report?.results.filter((r) => !r.skipped && !r.findings.length) ?? []
  const skipped = report?.results.filter((r) => r.skipped) ?? []

  function toggle(id: string) {
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const btn = mobile ? "h-9 px-3 text-xs" : "h-7 px-2 text-[11px]"

  return (
    <aside
      ref={ref}
      className={cn(
        "octane-self-check z-[60] flex flex-col border-border bg-popover/95 shadow-2xl backdrop-blur",
        mobile
          ? "fixed inset-x-0 bottom-0 max-h-[82dvh] rounded-t-2xl border-t pb-[env(safe-area-inset-bottom,0px)]"
          : "fixed inset-y-0 right-0 max-w-[calc(100vw-3.5rem)] border-l",
      )}
      style={mobile ? undefined : { width: panel.width }}
      role="dialog"
      aria-label="Self check"
      onPointerDown={(e) => e.stopPropagation()}
    >
      {!mobile && <ResizeHandle panel={panel} label="Resize Self check panel" />}
      <div className="flex shrink-0 items-start justify-between gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-1 text-sm font-semibold text-foreground">
            Self check
            <HelpTip title="Self check">
              Octane scans the log for things worth a look: clutch slip, lean AFR under boost, fuel pressure drop, coolant pressure, wheel slip and more. Red = critical, yellow = warning, blue = info. <b>Jump</b> moves the cursor there, <b>Plot</b> opens the channels that explain it. <b>Tune checks</b> changes the limits. Findings are prompts to look, not a diagnosis.
            </HelpTip>
          </h3>
          <p className="truncate text-[11px] text-muted-foreground" title={fileName}>
            {fileName}
          </p>
          {report && (
            <p className="mt-0.5 text-[10px] text-muted-foreground/80">
              {report.results.filter((r) => !r.skipped).length} checks ran · {report.shifts} shifts · {report.sampleRate.toFixed(0)} Hz
              {report.sampleRate < 15 ? " (low rate: shift checks are approximate)" : ""}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close self check"
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2">
        <div className="flex rounded-lg border border-border bg-secondary/40 p-0.5">
          {(["findings", "tune"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cn(
                "rounded-md px-3 py-1 text-[11px] font-medium transition-colors",
                tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t === "findings" ? "Findings" : "Tune checks"}
            </button>
          ))}
        </div>
        {tab === "findings" && report && (
          <div className="ml-auto flex items-center gap-1">
            {(["critical", "warn", "info"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setFilter((f) => (f === s ? null : s))}
                title={`${SEVERITY_TONE[s].label}: ${filter === s ? "show all" : "show only these"}`}
                aria-pressed={filter === s}
                className={cn(
                  "inline-flex h-7 items-center gap-1 rounded-md border px-2 font-mono text-[11px] tabular-nums transition-colors",
                  filter === s ? cn(SEVERITY_TONE[s].border, SEVERITY_TONE[s].bg) : "border-transparent hover:bg-secondary",
                  report.counts[s] === 0 && "opacity-40",
                )}
              >
                <SeverityIcon severity={s} className="size-3.5" />
                {report.counts[s]}
              </button>
            ))}
          </div>
        )}
      </div>

      {!prefs.enabled ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <CircleSlash className="size-6 text-muted-foreground" />
          <p className="text-xs text-muted-foreground">Self check is switched off.</p>
          <button
            type="button"
            onClick={() => onPrefsChange({ ...prefs, enabled: true })}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
          >
            Turn on
          </button>
        </div>
      ) : tab === "findings" ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {!report ? (
            <p className="p-4 text-xs text-muted-foreground">Load a log to run the self check.</p>
          ) : groups.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
              <CircleCheck className="size-7 text-emerald-400" />
              <p className="text-sm font-medium text-foreground">{filter ? `No ${SEVERITY_TONE[filter].label.toLowerCase()} findings` : "Nothing flagged"}</p>
              <p className="text-[11px] text-muted-foreground">{passed.length} checks passed. Checks that could not run (channels not logged) are listed below.</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {groups.map(({ rule, findings, worst }) => {
                const expanded = open.has(rule.id)
                const tone = SEVERITY_TONE[worst]
                return (
                  <li key={rule.id} className={cn("overflow-hidden rounded-lg border bg-card/60", tone.border)}>
                    <button type="button" onClick={() => toggle(rule.id)} className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-secondary/40">
                      <SeverityIcon severity={worst} className="mt-0.5 size-4" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs font-semibold text-foreground">{rule.title}</span>
                        <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">
                          {rule.system} · {findings.length} {findings.length === 1 ? "finding" : "findings"}
                          {rule.dtc?.length ? ` · ${rule.dtc.join(" / ")}` : ""}
                        </span>
                      </span>
                      {expanded ? <ChevronDown className="mt-0.5 size-4 text-muted-foreground" /> : <ChevronRight className="mt-0.5 size-4 text-muted-foreground" />}
                    </button>
                    {expanded && (
                      <div className="space-y-2 border-t border-border/60 bg-background/40 px-3 py-2 text-[11px] leading-relaxed">
                        <p className="text-muted-foreground">{rule.summary}</p>
                        <div>
                          <p className="font-semibold text-foreground">Likely causes / what to check</p>
                          <p className="text-foreground/85">{rule.advice}</p>
                        </div>
                        <p className="text-[10px] text-muted-foreground/80">Refs: {rule.refs.join(" · ")}</p>
                      </div>
                    )}
                    <ul className="divide-y divide-border/50 border-t border-border/60">
                      {(expanded ? findings : findings.slice(0, 3)).map((f) => (
                        <li key={f.id} className={cn("flex items-start gap-2 px-3 py-2", selectedId === f.id && "bg-primary/10")}>
                          <SeverityIcon severity={f.severity} className="mt-0.5 size-3.5" />
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-medium text-foreground">{f.title}</p>
                            <p className="text-[11px] leading-snug text-muted-foreground">{f.detail}</p>
                            <p className="mt-0.5 font-mono text-[10px] text-muted-foreground/80">
                              {fmtT(f.start, timeUnit)}
                              {f.end > f.start ? ` – ${fmtT(f.end, timeUnit)}` : ""}
                            </p>
                          </div>
                          <div className="flex shrink-0 flex-col gap-1">
                            <button
                              type="button"
                              onClick={() => onJump(f)}
                              title="Move the cursor and window to this moment"
                              className={cn("inline-flex items-center gap-1 rounded-md border border-border bg-card font-medium text-foreground hover:bg-secondary", btn)}
                            >
                              <Crosshair className="size-3" />
                              Jump
                            </button>
                            <button
                              type="button"
                              onClick={() => onPlot(f)}
                              title={`Open in Analysis with: ${f.channels.join(", ")}`}
                              className={cn("inline-flex items-center gap-1 rounded-md border border-border bg-card font-medium text-foreground hover:bg-secondary", btn)}
                            >
                              <LineChart className="size-3" />
                              Plot
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                    {!expanded && findings.length > 3 && (
                      <button type="button" onClick={() => toggle(rule.id)} className="w-full border-t border-border/60 px-3 py-1.5 text-left text-[11px] text-muted-foreground hover:bg-secondary/40">
                        Show all {findings.length}
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
          )}

          {report && (
            <div className="mt-4 border-t border-border pt-3">
              <button type="button" onClick={() => setShowPassed((v) => !v)} className="flex w-full items-center gap-1.5 text-left text-[11px] font-medium text-muted-foreground hover:text-foreground">
                {showPassed ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                {passed.length} passed · {skipped.length} not run
              </button>
              {showPassed && (
                <div className="mt-2 space-y-2 text-[11px]">
                  <ul className="space-y-0.5">
                    {passed.map((r) => (
                      <li key={r.ruleId} className="flex items-center gap-1.5 text-foreground/80">
                        <CircleCheck className="size-3 text-emerald-400" />
                        {RULE_BY_ID[r.ruleId].title}
                      </li>
                    ))}
                  </ul>
                  <ul className="space-y-0.5">
                    {skipped.map((r) => (
                      <li key={r.ruleId} className="flex items-start gap-1.5 text-muted-foreground">
                        <CircleSlash className="mt-0.5 size-3 shrink-0" />
                        <span>
                          {RULE_BY_ID[r.ruleId].title}: <span className="text-muted-foreground/70">{r.skipped}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <TunePane config={config} onConfigChange={onConfigChange} prefs={prefs} onPrefsChange={onPrefsChange} mobile={mobile} />
      )}
    </aside>
  )
}

function TunePane({
  config,
  onConfigChange,
  prefs,
  onPrefsChange,
  mobile,
}: {
  config: SelfCheckConfig
  onConfigChange: (c: SelfCheckConfig) => void
  prefs: SelfCheckPrefs
  onPrefsChange: (p: SelfCheckPrefs) => void
  mobile: boolean
}) {
  const [query, setQuery] = useState("")
  const q = query.trim().toLowerCase()
  const rules = RULES.filter((r) => !q || `${r.title} ${r.system} ${r.summary}`.toLowerCase().includes(q))
  const changed = (r: RuleDef) => !!config.params[r.id] && Object.keys(config.params[r.id]).length > 0

  function setEnabled(rule: RuleDef, on: boolean) {
    const disabled = config.disabled.filter((id) => id !== rule.id)
    const enabled = config.enabled.filter((id) => id !== rule.id)
    if (rule.defaultOff ? on : !on) (rule.defaultOff ? enabled : disabled).push(rule.id)
    onConfigChange({ ...config, disabled, enabled })
  }

  function setParam(rule: RuleDef, key: string, value: number) {
    const def = rule.params.find((p) => p.key === key)?.default
    const cur = { ...(config.params[rule.id] ?? {}) }
    if (!Number.isFinite(value) || value === def) delete cur[key]
    else cur[key] = value
    const params = { ...config.params }
    if (Object.keys(cur).length) params[rule.id] = cur
    else delete params[rule.id]
    onConfigChange({ ...config, params })
  }

  function resetRule(rule: RuleDef) {
    const params = { ...config.params }
    delete params[rule.id]
    onConfigChange({
      params,
      disabled: config.disabled.filter((id) => id !== rule.id),
      enabled: config.enabled.filter((id) => id !== rule.id),
    })
  }

  const field = mobile ? "h-9 text-sm" : "h-7 text-xs"

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
      <div className="mb-3 space-y-2 rounded-lg border border-border bg-card/60 p-3">
        <label className="flex items-center justify-between gap-2 text-xs text-foreground">
          <span>Shade findings on plots</span>
          <input type="checkbox" checked={prefs.markPlots} onChange={(e) => onPrefsChange({ ...prefs, markPlots: e.target.checked })} className="size-4 accent-[var(--primary)]" />
        </label>
        <div className="flex items-center justify-between gap-2 text-xs text-foreground">
          <span>Shade and strip from</span>
          <div className="flex rounded-lg border border-border bg-secondary/40 p-0.5">
            {(["info", "warn", "critical"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => onPrefsChange({ ...prefs, minSeverity: s })}
                className={cn(
                  "rounded-md px-2 py-0.5 text-[11px] font-medium",
                  prefs.minSeverity === s ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {SEVERITY_TONE[s].label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a check"
            className={cn("w-full rounded-md border border-border bg-background px-2 text-foreground outline-none focus:ring-2 focus:ring-ring/30", field)}
          />
          <button
            type="button"
            onClick={() => onConfigChange({ disabled: [], enabled: [], params: {} })}
            title="Reset every check to its default thresholds"
            className={cn("inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-card px-2 font-medium text-foreground hover:bg-secondary", field)}
          >
            <RotateCcw className="size-3" />
            Reset all
          </button>
        </div>
      </div>

      <ul className="space-y-2">
        {rules.map((rule) => {
          const on = ruleEnabled(rule, config)
          const values = ruleParams(rule, config)
          return (
            <li key={rule.id} className={cn("rounded-lg border border-border bg-card/60 p-3", !on && "opacity-60")}>
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-foreground">{rule.title}</p>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {rule.system}
                    {rule.defaultOff ? " · off by default" : ""}
                  </p>
                </div>
                {changed(rule) && (
                  <button type="button" onClick={() => resetRule(rule)} title="Reset this check" className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-secondary hover:text-foreground">
                    <RotateCcw className="size-3" />
                  </button>
                )}
                <button
                  type="button"
                  role="switch"
                  aria-checked={on}
                  aria-label={`${rule.title}: ${on ? "on" : "off"}`}
                  onClick={() => setEnabled(rule, !on)}
                  className={cn("relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors", on ? "bg-primary" : "bg-muted-foreground/40")}
                >
                  <span className={cn("absolute size-3 rounded-full bg-background shadow transition-transform", on ? "translate-x-3.5" : "translate-x-0.5")} />
                </button>
              </div>
              <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{rule.summary}</p>
              {on && rule.params.length > 0 && (
                <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
                  {rule.params.map((p) => {
                    const v = values[p.key]
                    const isChanged = v !== p.default
                    return (
                      <label key={p.key} className="flex min-w-0 flex-col gap-0.5">
                        <span className="truncate text-[10px] text-muted-foreground" title={`${p.label} (default ${p.default} ${p.unit})`}>
                          {p.label}
                        </span>
                        <span className="flex items-center gap-1">
                          <input
                            type="number"
                            inputMode="decimal"
                            step={p.step ?? 1}
                            value={v}
                            onChange={(e) => setParam(rule, p.key, e.target.value === "" ? p.default : Number(e.target.value))}
                            className={cn(
                              "w-full min-w-0 rounded-md border bg-background px-1.5 font-mono tabular-nums text-foreground outline-none focus:ring-2 focus:ring-ring/30",
                              field,
                              isChanged ? "border-primary/60" : "border-border",
                            )}
                          />
                          <span className="shrink-0 text-[10px] text-muted-foreground">
                            {p.unit}
                            {p.unit === "bar" ? ` ≈${(v * 14.5038).toFixed(1)} psi` : ""}
                          </span>
                        </span>
                      </label>
                    )
                  })}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
