"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Download, Plus, RotateCcw, Search, Trash2, Upload, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { groupChannelsForGraphs } from "@/lib/channel-groups"
import {
  BUILTIN_TEMPLATES,
  builtinById,
  cloneTemplate,
  isBuiltinTemplate,
  makeGroupId,
  makeTemplateId,
  parseImportedTemplates,
  resolveEntry,
  serializeTemplates,
  withChannelsFromGroups,
  type Template,
  type TemplateGroup,
} from "@/lib/templates"

export interface EditorChannel {
  key: string
  label: string
  unit: string
}

/** Explicit graph layout for a template (auto-split when it has none yet). */
export function templateGroups(t: Template): TemplateGroup[] {
  if (t.groups?.length) return t.groups
  const auto = groupChannelsForGraphs(t.channels)
  return auto.map((g) => ({ id: `${t.id}-${g.id}`, title: g.title, channels: g.labels }))
}

/**
 * Edits the ONE shared template list (the same list Analysis, Channels,
 * Compare and the phone picker use): templates, their graphs, and the
 * channels in each graph.
 */
export function TemplateEditor({
  open,
  templates,
  activeTemplateId,
  channels,
  onSave,
  onClose,
}: {
  open: boolean
  templates: Template[]
  activeTemplateId: string | null
  channels: EditorChannel[]
  onSave: (templates: Template[]) => void
  onClose: () => void
}) {
  const importRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState<Template[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const labels = useMemo(() => channels.map((c) => c.label), [channels])
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(templates.map(withGroups)), [draft, templates])

  function withGroups(t: Template): Template {
    return { ...cloneTemplate(t), groups: templateGroups(t).map((g) => ({ ...g, channels: [...g.channels] })) }
  }

  useEffect(() => {
    if (!open) return
    const next = templates.map(withGroups)
    const sel = next.find((t) => t.id === activeTemplateId) ?? next[0] ?? null
    setDraft(next)
    setSelectedId(sel?.id ?? null)
    setActiveGroupId(sel?.groups?.[0]?.id ?? null)
    setQuery("")
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps -- reseed only when the dialog opens

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

  const selected = draft.find((t) => t.id === selectedId) ?? draft[0] ?? null
  const groups = selected?.groups ?? []
  const active = groups.find((g) => g.id === activeGroupId) ?? groups[0] ?? null
  const q = query.trim().toLowerCase()
  const filtered = q ? channels.filter((c) => c.label.toLowerCase().includes(q) || c.unit.toLowerCase().includes(q)) : channels
  const activeResolved = new Set(active ? active.channels.flatMap((e) => resolveEntry(e, labels)) : [])
  const missing = active ? active.channels.filter((e) => resolveEntry(e, labels).length === 0) : []

  function updateSelected(fn: (t: Template) => Template) {
    if (!selected) return
    setDraft((cur) => cur.map((t) => (t.id === selected.id ? fn(t) : t)))
  }
  function updateGroup(groupId: string, fn: (g: TemplateGroup) => TemplateGroup) {
    updateSelected((t) => ({ ...t, groups: (t.groups ?? []).map((g) => (g.id === groupId ? fn(g) : g)) }))
  }
  function addTemplate() {
    const g = { id: makeGroupId(), title: "Graph 1", channels: [] }
    const t: Template = { id: makeTemplateId(), name: `Template ${draft.length + 1}`, channels: [], groups: [g] }
    setDraft((cur) => [...cur, t])
    setSelectedId(t.id)
    setActiveGroupId(g.id)
  }
  function deleteTemplate(id: string) {
    if (draft.length <= 1) return
    const next = draft.filter((t) => t.id !== id)
    setDraft(next)
    if (selectedId === id) {
      setSelectedId(next[0]?.id ?? null)
      setActiveGroupId(next[0]?.groups?.[0]?.id ?? null)
    }
  }
  function moveTemplate(id: string, dir: -1 | 1) {
    setDraft((cur) => {
      const i = cur.findIndex((t) => t.id === id)
      const j = i + dir
      if (i < 0 || j < 0 || j >= cur.length) return cur
      const next = [...cur]
      const [item] = next.splice(i, 1)
      next.splice(j, 0, item)
      return next
    })
  }
  function addGraph() {
    const g = { id: makeGroupId(), title: `Graph ${groups.length + 1}`, channels: [] }
    updateSelected((t) => ({ ...t, groups: [...(t.groups ?? []), g] }))
    setActiveGroupId(g.id)
  }
  function deleteGraph(id: string) {
    const next = groups.filter((g) => g.id !== id)
    const final = next.length ? next : [{ id: makeGroupId(), title: "Graph 1", channels: [] }]
    updateSelected((t) => ({ ...t, groups: final }))
    setActiveGroupId(final[0].id)
  }
  function toggleChannel(label: string) {
    if (!active) return
    if (activeResolved.has(label)) {
      // remove the entries that point at this channel
      updateGroup(active.id, (g) => ({ ...g, channels: g.channels.filter((e) => !resolveEntry(e, labels).includes(label)) }))
    } else {
      updateGroup(active.id, (g) => ({ ...g, channels: [...g.channels, label] }))
    }
  }
  function resetSelected() {
    if (!selected || !isBuiltinTemplate(selected.id)) return
    const original = builtinById(selected.id)
    if (!original) return
    const next = withGroups(original)
    setDraft((cur) => cur.map((t) => (t.id === selected.id ? next : t)))
    setActiveGroupId(next.groups?.[0]?.id ?? null)
  }
  function restoreBuiltins() {
    setDraft((cur) => {
      const custom = cur.filter((t) => !isBuiltinTemplate(t.id))
      return [...BUILTIN_TEMPLATES.map((t) => withGroups(t)), ...custom]
    })
  }
  async function importFile(file: File) {
    const imported = parseImportedTemplates(await file.text())
    if (!imported.length) return
    setDraft((cur) => {
      const byId = new Map(cur.map((t) => [t.id, t]))
      for (const t of imported) byId.set(t.id, withGroups(t))
      return [...byId.values()]
    })
  }
  function exportFile() {
    const blob = new Blob([serializeTemplates(draft.map(withChannelsFromGroups))], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "octane-templates.json"
    a.click()
    URL.revokeObjectURL(url)
  }
  function save() {
    onSave(draft.map((t) => withChannelsFromGroups({ ...t, groups: (t.groups ?? []).filter((g) => g.channels.length || t.groups!.length === 1) })))
    onClose()
  }

  const btn = "inline-flex items-center justify-center gap-1 rounded-md border border-border bg-card px-2 py-2 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40"

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Edit templates">
      <div className="flex max-h-[min(90dvh,54rem)] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">Templates</p>
            <h3 className="mt-1 text-lg font-semibold text-foreground">Templates and their graphs</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              One list, shared by the Analysis Plot, Channels, Compare and the phone picker. Each template&apos;s graphs are how the Channels view splits it.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Cancel template edits" className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-[16rem_17rem_minmax(0,1fr)]">
          <aside className="flex min-h-0 flex-col border-r border-border bg-card/35">
            <input
              ref={importRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void importFile(file)
                event.target.value = ""
              }}
            />
            <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Templates</span>
              <button type="button" onClick={addTemplate} className="inline-flex size-7 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground" aria-label="Add template" title="Add template">
                <Plus className="size-3.5" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {draft.map((t, index) => (
                <div
                  key={t.id}
                  className={cn(
                    "mb-1.5 flex items-center gap-1 rounded-md border px-2 py-1.5 transition-colors",
                    selected?.id === t.id ? "border-primary bg-primary/15 text-foreground" : "border-transparent bg-card/50 text-muted-foreground hover:border-border hover:text-foreground",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedId(t.id)
                      setActiveGroupId(t.groups?.[0]?.id ?? null)
                      setQuery("")
                    }}
                    className="min-w-0 flex-1 text-left"
                  >
                    <span className="block truncate text-sm font-medium">{t.name || `Template ${index + 1}`}</span>
                    <span className="font-mono text-[10px] opacity-70">
                      {(t.groups ?? []).length} graphs{isBuiltinTemplate(t.id) ? " · built-in" : ""}
                    </span>
                  </button>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <button type="button" onClick={() => moveTemplate(t.id, -1)} disabled={index === 0} className="rounded px-1 text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-30" aria-label={`Move ${t.name} up`}>
                      ↑
                    </button>
                    <button type="button" onClick={() => moveTemplate(t.id, 1)} disabled={index === draft.length - 1} className="rounded px-1 text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-30" aria-label={`Move ${t.name} down`}>
                      ↓
                    </button>
                    <button type="button" onClick={() => deleteTemplate(t.id)} disabled={draft.length <= 1} className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-30" aria-label={`Delete ${t.name}`}>
                      <Trash2 className="size-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="border-t border-border p-2">
              <div className="mb-2 grid grid-cols-2 gap-1.5">
                <button type="button" onClick={() => importRef.current?.click()} className={btn} title="Import a templates JSON file">
                  <Upload className="size-3" />
                  Import
                </button>
                <button type="button" onClick={exportFile} className={btn} title="Export all templates as JSON">
                  <Download className="size-3" />
                  Export
                </button>
              </div>
              <button type="button" onClick={restoreBuiltins} className={cn(btn, "w-full")} title="Put the built-in templates back as shipped (your own templates are kept)">
                Restore built-in templates
              </button>
            </div>
          </aside>

          <aside className="flex min-h-0 flex-col border-r border-border bg-card/20">
            <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Graphs</span>
              <button type="button" onClick={addGraph} disabled={!selected} className="inline-flex size-7 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground" aria-label="Add graph" title="Add graph">
                <Plus className="size-3.5" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {groups.map((g, index) => {
                const matched = new Set(g.channels.flatMap((e) => resolveEntry(e, labels))).size
                return (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => setActiveGroupId(g.id)}
                    className={cn(
                      "mb-1.5 flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left transition-colors",
                      active?.id === g.id ? "border-primary bg-primary/15 text-foreground" : "border-transparent bg-card/50 text-muted-foreground hover:border-border hover:text-foreground",
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{g.title || `Graph ${index + 1}`}</span>
                      <span className="font-mono text-[10px] opacity-70">
                        {g.channels.length} ch · {matched} in this log
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
            <div className="shrink-0 border-t border-border p-2">
              <button type="button" onClick={resetSelected} disabled={!selected || !isBuiltinTemplate(selected.id)} className={cn(btn, "w-full")}>
                <RotateCcw className="size-3" />
                Reset this built-in template
              </button>
            </div>
          </aside>

          <div className="flex min-h-0 flex-col">
            {selected && active ? (
              <>
                <div className="grid shrink-0 gap-2 border-b border-border px-4 py-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                  <input
                    value={selected.name}
                    onChange={(e) => updateSelected((t) => ({ ...t, name: e.target.value }))}
                    className="h-9 min-w-0 rounded-md border border-border bg-card px-3 text-sm font-semibold text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
                    aria-label="Template name"
                  />
                  <input
                    value={active.title}
                    onChange={(e) => updateGroup(active.id, (g) => ({ ...g, title: e.target.value }))}
                    className="h-9 min-w-0 rounded-md border border-border bg-card px-3 text-sm text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
                    aria-label="Graph name"
                  />
                  <button type="button" onClick={() => deleteGraph(active.id)} className="inline-flex size-9 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-secondary hover:text-foreground" aria-label="Delete graph" title="Delete graph">
                    <Trash2 className="size-4" />
                  </button>
                </div>

                <div className="shrink-0 border-b border-border px-4 py-3">
                  <div className="flex flex-col gap-2">
                    <div className="relative max-w-md">
                      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                      <input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search channels to add..."
                        className="h-9 w-full rounded-md border border-border bg-card pl-9 pr-9 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/30"
                      />
                      {query && (
                        <button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="absolute right-2 top-1/2 inline-flex size-5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-secondary hover:text-foreground">
                          <X className="size-3" />
                        </button>
                      )}
                    </div>
                    {missing.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">In template, not in this log</span>
                        {missing.map((entry) => (
                          <button
                            key={entry}
                            type="button"
                            onClick={() => updateGroup(active.id, (g) => ({ ...g, channels: g.channels.filter((e) => e !== entry) }))}
                            className="inline-flex items-center gap-1 rounded border border-border bg-card px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground hover:bg-secondary hover:text-foreground"
                            title={`Remove ${entry}`}
                          >
                            {entry}
                            <X className="size-2.5" />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto p-3">
                  <div className="grid gap-1.5 md:grid-cols-2">
                    {filtered.map((c) => {
                      const checked = activeResolved.has(c.label)
                      return (
                        <button
                          key={c.key}
                          type="button"
                          onClick={() => toggleChannel(c.label)}
                          aria-pressed={checked}
                          className={cn(
                            "flex min-w-0 items-center gap-2 rounded-md border px-3 py-2 text-left transition-colors",
                            checked ? "border-primary bg-primary/15 text-foreground" : "border-border bg-card/45 text-muted-foreground hover:bg-secondary hover:text-foreground",
                          )}
                        >
                          <span className={cn("flex size-4 shrink-0 items-center justify-center rounded border", checked ? "border-primary bg-primary" : "border-border")}>
                            {checked && <span className="size-1.5 rounded-[1px] bg-primary-foreground" />}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-sm" title={c.label}>
                            {c.label}
                          </span>
                          <span className="shrink-0 font-mono text-[10px] opacity-70">{c.unit}</span>
                        </button>
                      )
                    })}
                  </div>
                  {filtered.length === 0 && <div className="px-4 py-10 text-center text-sm text-muted-foreground">No channels match this search.</div>}
                </div>
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Add a template and a graph to start.</div>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-col gap-3 border-t border-border bg-card/35 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">{dirty ? "Unsaved template changes." : "Templates match the saved file."}</p>
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={onClose} className="inline-flex h-9 items-center justify-center rounded-md border border-border bg-card px-3 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground">
              Cancel
            </button>
            <button type="button" onClick={save} className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90">
              Save templates
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
