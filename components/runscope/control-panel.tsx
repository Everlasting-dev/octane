"use client"

import { useRef, useState, type ReactNode, type RefObject } from "react"
import { Check, Crosshair, Download, HelpCircle, Lock, LockOpen, Maximize2, Pencil, RefreshCw, RotateCcw, Save, Search, Upload, X } from "lucide-react"
import { Toggle } from "./toggle"
import { cn } from "@/lib/utils"
import type { Template } from "@/lib/templates"

export interface ChannelItem {
  key: string
  label: string
  unit: string
  color: string
}

interface ControlPanelProps {
  query: string
  onQueryChange: (v: string) => void
  searchRef: RefObject<HTMLInputElement | null>

  sync: boolean
  onSyncChange: (v: boolean) => void
  annotate: boolean
  onAnnotateChange: (v: boolean) => void

  onReset: () => void
  onFit: () => void

  windowSlot?: ReactNode

  channels: ChannelItem[]
  hidden: Set<string>
  onToggleChannel: (key: string) => void
  onScrollToChannel: (key: string) => void
  onShowAll: () => void
  onHideAll: () => void

  templates: Template[]
  onApplyTemplate: (t: Template) => void
  onSaveTemplate: (name: string) => void
  onDeleteTemplate: (id: string) => void
  onRenameTemplate: (id: string, name: string) => void
  onUpdateTemplate: (id: string) => void
  onImportTemplates: (file: File) => void
  onExportTemplates: () => void
}

export function ControlPanel(props: ControlPanelProps) {
  const {
    query,
    onQueryChange,
    searchRef,
    sync,
    onSyncChange,
    annotate,
    onAnnotateChange,
    onReset,
    onFit,
    windowSlot,
    channels,
    hidden,
    onToggleChannel,
    onScrollToChannel,
    onShowAll,
    onHideAll,
    templates,
    onApplyTemplate,
    onSaveTemplate,
    onDeleteTemplate,
    onRenameTemplate,
    onUpdateTemplate,
    onImportTemplates,
    onExportTemplates,
  } = props

  const importRef = useRef<HTMLInputElement>(null)
  const [savingName, setSavingName] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState("")
  const [editLocked, setEditLocked] = useState(true)

  const filtered = channels.filter((c) => c.label.toLowerCase().includes(query.toLowerCase()))
  const activeCount = channels.filter((c) => !hidden.has(c.key)).length

  function commitSave() {
    const name = (savingName ?? "").trim()
    if (name) onSaveTemplate(name)
    setSavingName(null)
  }

  function startRename(id: string, current: string) {
    setEditingId(id)
    setEditName(current)
  }
  function commitRename() {
    if (editingId && editName.trim()) onRenameTemplate(editingId, editName.trim())
    setEditingId(null)
  }

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      {/* 1 · Search (fixed) */}
      <div className="relative shrink-0">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          ref={searchRef}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search channels…"
          className="h-9 w-full rounded-md border border-border bg-card pl-9 pr-10 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
        />
        {query ? (
          <button
            type="button"
            onClick={() => {
              onQueryChange("")
              searchRef.current?.focus()
            }}
            aria-label="Clear search"
            className="absolute right-1.5 top-1/2 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        ) : (
          <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-border bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            ⌘K
          </kbd>
        )}
      </div>

      {/* 2 · Controls (fixed) */}
      <div className="flex shrink-0 flex-col gap-2">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Controls</span>
        <div className="grid grid-cols-2 gap-2">
          <Toggle pressed={sync} onPressedChange={onSyncChange} label="Sync" />
          <button
            type="button"
            onClick={() => onAnnotateChange(!annotate)}
            aria-pressed={annotate}
            className={cn(
              "inline-flex items-center justify-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm transition-colors",
              annotate
                ? "border-primary bg-primary/15 text-foreground"
                : "border-border bg-card text-foreground hover:bg-secondary",
            )}
          >
            <Crosshair className="size-3.5" />
            Annotate
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onReset}
            title="Reset view: full time range, clear the cursor, expand all plots"
            className="inline-flex items-center justify-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-sm text-foreground transition-colors hover:bg-secondary"
          >
            <RotateCcw className="size-3.5" />
            Reset
          </button>
          <button
            type="button"
            onClick={onFit}
            title="Fit: zoom out to the full time range (keeps the cursor)"
            className="inline-flex items-center justify-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-sm text-foreground transition-colors hover:bg-secondary"
          >
            <Maximize2 className="size-3.5" />
            Fit
          </button>
        </div>

      </div>

      {/* 3 · Templates (fixed) */}
      <div className="flex shrink-0 flex-col gap-2">
        <input
          ref={importRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) onImportTemplates(f)
            e.target.value = ""
          }}
        />
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Templates</span>
          <div className="flex items-center gap-1 text-[11px]">
            <button
              type="button"
              onClick={() => setSavingName("")}
              title="Save current channels as a template"
              className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <Save className="size-3" />
              Save
            </button>
            <button
              type="button"
              onClick={() => setEditLocked((v) => !v)}
              aria-pressed={!editLocked}
              title={editLocked ? "Editing locked — click to allow rename/update/delete" : "Editing unlocked — click to lock"}
              className={cn(
                "inline-flex size-6 items-center justify-center rounded border transition-colors",
                editLocked
                  ? "border-border text-muted-foreground hover:bg-secondary hover:text-foreground"
                  : "border-primary bg-primary/15 text-foreground",
              )}
            >
              {editLocked ? <Lock className="size-3" /> : <LockOpen className="size-3" />}
            </button>
            <button
              type="button"
              onClick={() => importRef.current?.click()}
              title="Import templates"
              className="inline-flex size-6 items-center justify-center rounded border border-border text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <Upload className="size-3" />
            </button>
            <button
              type="button"
              onClick={onExportTemplates}
              disabled={templates.length === 0}
              title="Export templates"
              className="inline-flex size-6 items-center justify-center rounded border border-border text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent"
            >
              <Download className="size-3" />
            </button>
          </div>
        </div>

        {savingName !== null && (
          <div className="flex items-center gap-1">
            <input
              autoFocus
              value={savingName}
              onChange={(e) => setSavingName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitSave()
                if (e.key === "Escape") setSavingName(null)
              }}
              placeholder="Template name…"
              className="h-8 min-w-0 flex-1 rounded-md border border-border bg-card px-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none"
            />
            <button
              type="button"
              onClick={commitSave}
              className="rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setSavingName(null)}
              aria-label="Cancel"
              className="inline-flex size-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          </div>
        )}

        {templates.length > 0
          ? (
            <ul className="flex max-h-[4.75rem] flex-col gap-0.5 overflow-y-auto pr-1">
              {templates.map((t) =>
                editingId === t.id ? (
                  <li key={t.id} className="flex items-center gap-1">
                    <input
                      autoFocus
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitRename()
                        if (e.key === "Escape") setEditingId(null)
                      }}
                      className="h-8 min-w-0 flex-1 rounded-md border border-border bg-card px-2 text-sm text-foreground focus:border-ring focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={commitRename}
                      aria-label="Save name"
                      className="inline-flex size-7 items-center justify-center rounded text-primary transition-colors hover:bg-secondary"
                    >
                      <Check className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      aria-label="Cancel rename"
                      className="inline-flex size-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                    >
                      <X className="size-3.5" />
                    </button>
                  </li>
                ) : (
                  <li key={t.id} className="group flex items-center gap-0.5 rounded-md pr-1 transition-colors hover:bg-secondary/60">
                    <button
                      type="button"
                      onClick={() => onApplyTemplate(t)}
                      title="Apply template"
                      className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left"
                    >
                      <span className="min-w-0 flex-1 truncate text-sm text-foreground">{t.name}</span>
                      <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{t.channels.length} ch</span>
                    </button>
                    {!editLocked && (
                      <>
                        <button
                          type="button"
                          onClick={() => onUpdateTemplate(t.id)}
                          title="Overwrite with current channels"
                          aria-label={`Update ${t.name}`}
                          className="inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                        >
                          <RefreshCw className="size-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => startRename(t.id, t.name)}
                          title="Rename"
                          aria-label={`Rename ${t.name}`}
                          className="inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                        >
                          <Pencil className="size-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteTemplate(t.id)}
                          title="Delete"
                          aria-label={`Delete ${t.name}`}
                          className="inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                        >
                          <X className="size-3.5" />
                        </button>
                      </>
                    )}
                  </li>
                ),
              )}
            </ul>
          )
          : savingName === null && (
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Save the current channel selection as a reusable template.
              </p>
            )}
      </div>

      {/* 4 · Window plot (fixed) */}
      {windowSlot && (
        <div className="flex shrink-0 flex-col gap-2">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Window</span>
          {windowSlot}
        </div>
      )}

      {/* 4 · Channels (scrolls) */}
      <div className="flex min-h-0 flex-1 flex-col gap-2">
        <div className="flex shrink-0 items-center justify-between">
          <span className="flex items-center gap-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Channels <span className="text-muted-foreground/60">· {activeCount}/{channels.length}</span>
            <span title="Click a channel name to jump to its plot" className="inline-flex">
              <HelpCircle className="size-3 text-muted-foreground/60" aria-hidden />
            </span>
          </span>
          <div className="flex items-center gap-1 text-[11px]">
            <button
              type="button"
              onClick={onShowAll}
              title="Select all channels"
              className="rounded border border-border px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              All
            </button>
            <button
              type="button"
              onClick={onHideAll}
              title="Deselect all channels"
              className="rounded border border-border px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              None
            </button>
          </div>
        </div>

        <ul className="-mr-2 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto pr-2">
          {filtered.map((c) => {
            const on = !hidden.has(c.key)
            return (
              <li key={c.key} className="flex items-center gap-1.5 rounded-md pr-2 transition-colors hover:bg-secondary/60">
                <button
                  type="button"
                  onClick={() => onToggleChannel(c.key)}
                  aria-label={on ? `Hide ${c.label}` : `Show ${c.label}`}
                  aria-pressed={on}
                  className="flex shrink-0 items-center justify-center py-1.5 pl-2 pr-1"
                >
                  <span
                    className={cn(
                      "flex size-4 items-center justify-center rounded border transition-colors",
                      on ? "border-primary bg-primary" : "border-border bg-transparent",
                    )}
                  >
                    {on && (
                      <svg viewBox="0 0 24 24" className="size-3 text-primary-foreground" fill="none" stroke="currentColor" strokeWidth={3}>
                        <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => onScrollToChannel(c.key)}
                  title={c.label}
                  className="flex min-w-0 flex-1 items-center gap-2.5 py-1.5 text-left"
                >
                  <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: c.color }} />
                  <span className={cn("min-w-0 flex-1 truncate text-sm", on ? "text-foreground" : "text-muted-foreground")}>
                    {c.label}
                  </span>
                  {c.unit !== "—" && <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{c.unit}</span>}
                </button>
              </li>
            )
          })}
          {filtered.length === 0 && (
            <li className="px-2 py-3 text-center text-xs text-muted-foreground">No channels match “{query}”.</li>
          )}
        </ul>
      </div>
    </div>
  )
}
