# Runscope — Signal Matrix: Rebuild Notes

This document records everything that was discussed and changed while rebuilding
Runscope's analysis UI on a new stack. It is the running history for the
`signal-matrix-analysis/` app.

## Background

- The screenshot/prototype that started this was **not C++** — it is a
  v0.dev-generated **Next.js** app. The original shipping app (`../` root,
  "ecutek-log-viewer") is a vanilla HTML/JS **Electron + Plotly.js** app.
- Decision: **adopt the prototype's stack** and grow it into the real app,
  wired to real ECU CSV data and packaged as a desktop app.

## Tech stack (the open-source tools behind the look)

| Purpose | Tool |
|---|---|
| Framework | Next.js 16 + React 19 |
| Components | shadcn/ui (style `base-nova`) + Base UI |
| Styling | Tailwind CSS v4 + `tw-animate-css` |
| Charts | Recharts |
| Icons | lucide-react |
| Fonts | Geist (sans + mono) |
| Desktop shell | Electron + electron-builder |

The black-and-white theme comes from the zero-chroma chart tokens
(`--chart-1..5`) in `app/globals.css` under `prefers-color-scheme: dark`.

---

## Phase 1 — Real data + foundation

- **`lib/csv.ts`** — dependency-free ECU CSV parser. Detects the Time column,
  turns every numeric column into a signal, parses units from headers
  (`Engine Speed (RPM)` → unit `RPM`), infers decimals, computes min/max/avg.
  Falls back to a sample-index x-axis when there is no Time column.
- **`components/runscope/upload-zone.tsx`** — drag/drop + browse empty state,
  with a "Load sample data" button.
- Charts render the parsed `Signal[]`; the synthetic generator
  (`lib/telemetry.ts`) is kept only for the sample dataset.

## Phase 2 — Electron desktop wrapper

- **`electron/main.cjs`** + **`electron/static-server.cjs`** — serves the static
  Next export (`out/`) from an in-process localhost server, then loads it in a
  BrowserWindow. This avoids `file://` asset-path breakage and works offline.
- Native **File / View / Help** menu (File → Open log = Ctrl+O).
- `next.config.mjs` set to `output: "export"` and a pinned `turbopack.root`.
- Next/React/Recharts moved to **devDependencies** — they are build-time only;
  the packaged app ships just the static files + Electron (no node_modules).
- Scripts: `npm run dev` (browser), `npm run desktop` (build + launch),
  `npm run dist:win` (NSIS installer), `npm run pack:win` (unpacked).
- Note: inside Claude Code the harness sets `ELECTRON_RUN_AS_NODE=1`; running
  electron there needs `env -u ELECTRON_RUN_AS_NODE`. Not an issue on a normal
  terminal.

## Phase 3 — Ported features

- **Multi-file comparison** — `lib/compare.ts` (time-aligned diff via
  interpolation, Δ stats). Load several logs, toggle Compare, common channels
  overlay one line per file with Δavg / Δmax / σ in the header.
- **Annotations** — `lib/annotations.ts`. Click a plot in Annotate mode to drop
  a knock/shift/boost/AFR/event marker (Recharts `ReferenceLine`), with a notes
  dialog and per-file localStorage persistence.
- **Keyboard shortcuts** — `hooks/use-shortcuts.ts` + `shortcuts-modal.tsx`.

## Phase 4 — Layout redesign (matching the reference design)

Requested changes and what was done:

1. **Removed the top channel pills** → channel **checklist in the left sidebar**.
2. **One top bar** — removed the in-app File/View/Help nav (Electron's native
   menu is the only one).
3. **No fill under the line** — charts are stroke-only.
4. **Removed** the Data points, Zero baseline, and Fill opacity options.
5. **Cursor behaviour** — desktop **click snaps to the nearest node** (no more
   cursor-follow on mousemove); mobile tap works the same way.
6. **Window function** — replaced with a draggable **range brush**.
7. **Search** — `⌘K / Ctrl+K` focuses the channel search.
8. **Controls moved into the left panel** — Sync, Annotate, Reset, Fit, Zoom.
9. **Performance** — LTTB downsampling (`lib/downsample.ts`, ~700 pts/series),
   only checked channels render (default first 6), `memo` on charts.

New structure: far-left icon **rail** (`rail.tsx`, Analysis/Compare on top,
Settings/Help at the bottom) → left **control panel** (`control-panel.tsx`) →
content with **KPI cards** (`kpi-cards.tsx`, adapts to RPM/speed/boost/temp) and
the **range brush** (`range-brush.tsx`). Display options live in a Settings
modal opened from the rail gear.

## Phase 5 — Control-panel polish

- Layout switched to fixed viewport height (`h-screen` + `overflow-hidden`), so
  the **left panel no longer scrolls with the page** — only the chart area
  scrolls.
- Left panel order: **Search → Controls → Window plot → Channels** (the channel
  list has its **own independent scroll**).
- The **window mini-map is permanently docked** in the panel (the old bottom bar
  and the now-redundant Window toggle were removed).
- **Select all / Deselect all** via the All / None buttons in the Channels
  header.

## Phase 6 — Bug fixes + responsiveness

- **Window mini-map fix** — in the vertical panel the track had both `flex-1`
  and a fixed height; `flex-1` collapsed it to zero height (rendered but
  invisible). The compact track now uses a fixed height + full width.
- **Click a channel name → jump to its plot** — channel rows now have a checkbox
  (toggles visibility) and a label button that scrolls the main view to that
  chart (revealing it first if hidden). Each chart has a `chart-<key>` id.
- **Faster search** — typing previously rebuilt inline callbacks and a fresh
  per-chart filtered-annotations array every keystroke, forcing every (heavy
  Recharts) chart to re-render. Fixes:
  - Stable `useCallback` handlers (`toggleCollapse`, `openAnnotation`,
    `toggleChannel`, `scrollToChannel`).
  - Charts receive the **full** annotations array and filter internally with
    `useMemo`, so the prop reference is stable while searching.
  - `visibleChannels` and the brush overview are memoized; the brush downsample
    is memoized.
  Net effect: typing in search only re-renders the channel list, not the charts.

## Phase 7 — KPI fixes, file metadata, landing page

- **KPI cards** (`lib/kpis.ts`): removed Duration + Samples (already in the top
  bar). Fixed Max Speed (it was matching *"Engine Speed"*; now requires vehicle
  speed and excludes engine/wheel). Boost Peak = `max(boost) − atmospheric
  pressure`. Added Max Coolant. Kept Channels.
- **File metadata** (`lib/csv.ts` `parseFileNameMeta` + comment-line parsing):
  ParsedLog now carries `meta` (VIN, calibration/dongle IDs, capture time parsed
  from the EcuTek filename, plus any `# key: value` lines). Shown in the Settings
  modal (opened from the rail gear).
- **Landing page** (`components/runscope/landing.tsx` + `app-shell.tsx`): the app
  now opens on a home screen (hero, Import CSV, drag-drop, Load sample, feature
  cards) and enters the Signal Matrix on import. The rail logo returns home.
  `app/page.tsx` renders `<AppShell/>`, which toggles Landing ↔ Dashboard and
  passes `initialLog` into the dashboard.
- **Sample data** moved to `lib/sample.ts` (shared by landing + dashboard).

### Direction: replace the legacy app

This Next.js + Electron app is now the product and supersedes the legacy vanilla
HTML/JS + Plotly app at the repo root (`ecutek-log-viewer/index.html`,
`compare.html`, `analysis.js`, `app.js`, `modules/`, etc.). The legacy files are
left in place for now (not deleted) but should be considered retired.

## Phase 8 — GPU/performance + three swappable views

- **GPU** (`electron/main.cjs`): enabled `ignore-gpu-blocklist`,
  `enable-gpu-rasterization`, `enable-zero-copy`, `enable-accelerated-2d-canvas`
  for smoother compositing/scrolling in the desktop app.
- **Off-screen skipping**: each chart card uses `content-visibility: auto` with a
  `contain-intrinsic-size`, so charts scrolled out of view skip layout/paint —
  the main lag win when many channels are enabled.
- **Three views** swap from the rail (`rail.tsx` `ViewMode`):
  - **Signal Matrix** (`matrix`) — stacked per-channel plots (default).
  - **Analysis Plot** (`plot`) — all selected channels normalized onto one
    overlay chart with a live per-channel value legend (`combined-chart.tsx`).
  - **Multi-Compare** (`compare`) — across-file overlay (needs 2+ logs).
  Shortcuts `1` / `2` / `3`. The old in-panel Compare toggle was removed (the rail
  now owns view switching).

## Phase 9 — Analysis Plot colors, templates, peaks, session memory

- **Colored lines** (`lib/palette.ts`): the Analysis Plot uses a distinct
  categorical palette per line (the rest of the app stays monochrome).
- **Templates** (`lib/templates.ts`): save the current channel selection as a
  named template (e.g. "Fuel" = AFR B1/B2, injector duty…), apply it to any log
  (matched by channel label), delete, and **export / import** templates as a
  JSON file to move between machines. Persisted in localStorage. UI lives in the
  control panel between Controls and the Window plot.
- **Mark peaks** (combined-chart): a toggle in the Analysis Plot header. When on,
  clicking a line selects the nearest one and marks its maximum with a labeled
  dot (value + unit); other lines dim. Off = click reads values at a point.
- **Per-file session memory** (`dashboard.tsx` `sessionsRef`): switching the
  active loaded file saves its working state (selected channels, window/domain,
  zoom, collapsed, cursor) and restores it when you switch back. Annotations were
  already per-file. (In-memory for the session; not yet persisted across restarts.)
- **Search clear**: an ✕ button clears the channel search (⌘K hint shows when
  empty).

## Phase 10 — Windowed peaks, file-backed templates, metadata icon

- **Windowed peak + visible value** (combined-chart): "Mark peaks" now finds the
  max **within the selected time window** (changes as you move the brush), places
  the dot on the line at that point (no longer clipped at the top), and shows the
  value prominently in the footer plus a non-clipping dot label.
- **Templates persist to a real folder** (`electron/preload.cjs`,
  `electron/main.cjs` IPC): in the desktop app templates are written to
  `<userData>/templates/templates.json` and reloaded on launch. Browser falls
  back to localStorage. `lib/templates.ts` `loadTemplates`/`persistTemplates` are
  now async (Electron file store first).
- **Stable server port** (`electron/static-server.cjs`, `main.cjs`): the static
  server now binds to a fixed port (43117, random fallback) so the origin is
  stable across restarts — this is what makes localStorage-based state
  (annotations, browser-fallback templates) survive a restart.
- **Metadata moved to its own rail icon**: an Info button above Settings opens a
  dedicated File-metadata modal (`metadata-modal.tsx` + shared `file-meta.tsx`).
  Settings is display-only again.

## Phase 11 — Navigation + import bug fixes

- **Home no longer loses your session**: the dashboard now stays mounted; Home
  shows the Landing as an overlay and the Landing gains a **"Back to analysis"**
  button. Opening a file from the Landing loads into the existing session
  (`app-shell.tsx` keeps `Dashboard` alive; `Dashboard` exposes `loadParsedLog`
  via a ref).
- **Silent import failures fixed**: a failed CSV import in the analysis view used
  to do nothing (the error only showed on the empty/landing screen). There's now
  a dismissible error banner in the analysis view, so a bad/unsupported second
  file reports why instead of "cancelling".

## Phase 12 — Layout, scrubbing, template editing, compare overhaul

- **Columns** (`display-panel.tsx` `columns` 1/2/3): the Signal Matrix can show 2
  or 3 charts per row (Settings → Display) so you see more than 3 plots at once.
- **Drag-scrub** (combined-chart): click-drag horizontally on the Analysis Plot
  to slide the cursor line continuously (single click still snaps).
- **Template editing** (control-panel): each saved template now has Update
  (overwrite with current channels), Rename, and Delete; Save still creates new.
- **Scroll to top**: `Home` key.
- **Compare workspace** (`compare-view.tsx`): the compare view is now a workspace
  with **3 plot areas**, each holding up to **3 channels** drawn for up to **3
  files** (≤9 lines). Files are distinguished by **color**, channels by **line
  style** (solid/dashed/dotted). Each file has its own **time offset** — pick the
  active file and **drag its trace** to align it (others dim but stay visible),
  or nudge with ±0.1s buttons; "Reset offsets" clears them. Channels per area are
  comparable across files (each channel normalized by its combined range). Plot
  areas can be filled from a saved **template**. Compare state lives in
  `dashboard.tsx` (`compareAreas`, `fileOffsets`, `activeCompareFile`).

## Phase 21 — Analysis Plot: split panes, real-units Y axis, multi-select scaling

- **Split toggle** (`combined-chart.tsx`): the Analysis Plot can render **two
  stacked panes**; each channel is assigned to plot 1 or 2 via a `1|2` control in
  the dock. Both panes share the X window + cursor. Refactored chart body into an
  `AnalysisPane` subcomponent.
- **Real-units Y axis**: the left axis now labels in the **focused line's real
  values** (inverse of the per-line gain/offset transform), tinted in that line's
  colour, with the channel+unit shown top-left — so the axis stays meaningful
  despite normalization/scaling. Per pane it follows the focused line (else the
  pane's first line).
- **Multi-select scaling**: dock rows have a checkbox; Shift+scroll / Shift+drag
  now scale/move **all selected lines together** (falls back to the focused line
  when nothing is selected). Peak highlight keyed by label.

## Phase 20 — Octane rebrand + go-live polish

- **Rebrand → Octane**: new flame+turbine logo (`scripts/gen-icons.mjs` → `components/runscope/logo.tsx`, `public/icon.svg`, `build/octane.svg`, PNGs incl. dark-tile `build/icon.png`). Renamed everywhere: package (`octane-signal-matrix`, productName **Octane**, appId `dev.everlasting.octane`, publish `Everlasting-dev/octane`, version 1.0.0), window title, layout metadata, brand text (rail/landing/login), env (`OCTANE_*`), window hooks (`__octaneOpenLog`/`__octaneOpenAbout`), localStorage keys (`octane:*`), and a consolidated `window.octane` preload bridge (templates/auth/app/updates). `lib/auth.ts` + `lib/templates.ts` read `window.octane.*`.
- **Settings → Key bindings sub-page** (`settings-modal.tsx` `page` state).
- **Analysis-plot + compare grid**: dotted H+V lines, distinct subtle colour, gated by the grid toggle.
- **Annotate**: auto-exits after a mark; clicking an annotation in the float list pans the window to it (width unchanged) via `jumpToTime`.
- **Template edit-lock**: lock button by Save hides Update/Rename/Delete (default locked); Save/Import/Export always available.
- **Per-view window memory**: `viewWindowsRef` remembers each view's window across Matrix/Plot/Compare; cleared on file load/select.
- **Help = Check for Updates + About**: native menu + in-app `about-modal.tsx` (version via `octane.app.getVersion`, signed-in email, GitHub link, update check). `lib/app-info.ts`.
- **Compare lock indicator**: `Lock` icon next to each facet's channel when alignment is locked.
- **No DevTools / simple menu**: `webPreferences.devTools:false`; menu trimmed to File/View(zoom+fullscreen)/Help.
- **Repo**: pushed to `Everlasting-dev/octane` (private). `scripts/install-octane.bat` uninstalls old Runscope/Octane then installs the latest release.
- ⚠ For the `.bat`/auto-updater to reach end users, the release assets must be **public** — either `gh repo edit Everlasting-dev/octane --visibility public` or publish releases to a separate public repo.

## Phase 19 — Grid/lock/dim toggles, matrix scrub, template scroll, unpacked build

- **Grid toggle shortcut** (`G`, remappable) — applies to all views incl. Analysis Plot.
- **Signal Matrix drag-scrub** — click-drag follows the cursor (charts are
  `select-none`, so no text highlighting).
- **Dim-unfocused toggle** — Settings → Display "Dim unfocused lines (Analysis
  Plot)" turns the single-line highlight on/off.
- **Templates list scrolls** — control-panel template list shows ~2 rows then
  scrolls.
- **Removed the −/+ zoom bar** from the control panel (the window mini-plot owns
  zoom).
- **Compare lock** — a Lock/Align toggle (and `L` shortcut) in the align bar.
  When locked, dragging a trace reads values (cursor) instead of nudging the
  offset, so alignment can't be disturbed while inspecting.
- **Offline unpacked build**: `npm run pack:win` → `release/win-unpacked/Runscope.exe`
  (double-click to run; no terminal). It enforces the login gate (Supabase) on
  launch; Sign out is in Settings (gear). Browser dev (`npm run dev`) bypasses auth.

## Phase 18 — Persistence, import regression, peak label, compare templates

- **Import regression fixed**: `openCsvDialog` now appends the throwaway `<input>`
  to the DOM before `.click()` (a detached input doesn't reliably open the dialog
  in Electron) and cleans it up after.
- **Analysis Plot scaling persists**: per-line gain/offset + focused line + peak
  toggle were lifted to the dashboard (`analysisTransforms/Focus/MarkPeaks`), so
  they survive leaving and returning to the plot.
- **Peak value stays inside the plot**: the peak dot is clamped into view and its
  `▲ value` label flips below the dot when high, so a scaled-to-top line no longer
  hides the readout above the plot.
- **Compare templates fill all 3 plots**: a "Template → all plots" selector in the
  align bar distributes a template's channels 3-per-area (1–3, 4–6, 7–9).

## Phase 17 — Remappable keys, fullscreen, peak-on-focus

- **Axis-label text selection on scroll fixed**: the plot wrapper is `select-none`
  so Shift-gestures no longer highlight the X-axis ticks.
- **Remappable shortcuts** (`lib/keybindings.ts` + Settings → Shortcuts editor):
  every single-key action (focus prev/next, peak toggle, fullscreen, height cycle,
  sync, annotate, reset, view 1/2/3) can be rebound (click → press a key; keys are
  kept unique by swapping). Stored in localStorage; dashboard and plot both read
  it live. Ctrl+O / Ctrl+K / ? stay fixed.
- **Peak follows focus**: with Mark-peaks on, cycling the focused line auto-marks
  that line's windowed max; peak markers have a toggle shortcut.
- **Fullscreen Analysis Plot** (incl. the value dock): a header button + shortcut
  expand the plot to fill the screen (Esc exits); hit-test geometry is computed
  from the live element size so scaling/peaks stay accurate at any height.
- **Signal-Matrix height shortcut** confirmed + remappable.

## Phase 16 — Analysis Plot focus/scale + value dock

- **Per-line focus**: `[` / `]` cycle the focused channel (or click it in the
  dock); the focused line goes bold/opaque, the rest fade — de-clutters the
  overlay. `Esc` clears focus.
- **Per-line scaling**: with a line focused, **Shift+scroll** scales just that
  line's vertical gain (function `dataKey` applies a per-line gain/offset over the
  normalized value; YAxis clips to 0–1); **Shift+drag** shifts it up/down. Each
  scaled line shows `×gain` + a reset in the dock.
- **Collapsible right dock** (`combined-chart.tsx`): per-channel color, name and
  **live value at the cursor**; click to focus; chevron collapses it to a thin
  strip so the plot reclaims full width.
- **`H`** cycles Signal-Matrix chart height (Mini→Compact→Normal→Tall).

## Phase 15 — Auth gate, auto-update, replace the legacy app

- **Import bug fixed permanently**: opening a file now creates a *fresh* `<input>`
  each time (`openCsvDialog`) instead of re-clicking one hidden input, which
  intermittently no-opped in Chromium ("second import does nothing"). The native
  File→Open menu calls `window.__runscopeOpenLog`.
- **Supabase auth ported** (`electron/auth.cjs`, `electron/preload.cjs`
  `apexDesktop.auth`, `lib/auth.ts`, `login-screen.tsx`): email/password against
  the same Supabase project as the legacy app; session encrypted with
  `safeStorage` in the user-data dir with a 7-day offline grace. `AppShell` gates
  the app behind a login screen in the desktop build; a plain browser (`npm run
  dev`) bypasses auth. Sign out lives in the Settings modal.
- **Becomes the legacy app via auto-update**: `appId` is now
  `dev.everlasting.runscope` (matches the old app) with productName **Runscope**
  and `publish` → GitHub `Everlasting-dev/runscope`; version 2.0.0 (> old 1.3.0).
  `electron-updater` runs `checkForUpdatesAndNotify()` on startup (packaged only).
  So a published release upgrades existing installs in place.

### Release checklist (manual — needs your credentials)
1. Code-sign: set `CSC_LINK` + `CSC_KEY_PASSWORD` to the same cert the old app
   used ("AK Everlasting Dev"), so the update is trusted / matches publisher.
2. Set `GH_TOKEN` to a token with write access to `Everlasting-dev/runscope`.
3. `npm run publish:win` — builds the NSIS installer + `latest.yml` and uploads
   to GitHub Releases (publish the draft if created as draft).
4. Existing users on 1.3.0 (same repo/appId) get 2.0.0 on next update check.

## Phase 14 — Faceted compare + distinct Reset/Fit

- **Reset vs Fit were identical** (both reset the view) — now distinct: **Fit** =
  zoom out to full time range (keeps cursor); **Reset** = full range + clear
  cursor + expand collapsed plots. Tooltips spell this out.
- **Compare is now faceted by channel** (`compare-view.tsx` `ChannelFacet`):
  instead of cramming a plot area's channels onto one (often normalized) axis,
  each channel gets its **own readable sub-chart with real units**, and the files
  are overlaid and distinguished **only by color**. Eliminates the
  normalized-spaghetti problem; the same-channel-across-files comparison is now
  one clean chart with true values + the per-file Δ readout. Values/Δ-Diff toggle
  still applies per plot area.

## Phase 13 — Rows + value-accurate comparison

- **Rows, not columns**: removed the columns setting; added a **Mini** chart
  height so the Signal Matrix stacks more plots as rows.
- **Compare now reads true values** (`compare-view.tsx`): when an area's channels
  share a unit it plots **real values on a real Y axis** (only normalizes when
  units are genuinely mixed, and says so).
- **Synchronized Δ readout**: the cursor table shows each file's actual value per
  channel **plus the delta vs the active "ref" file** (the active/align file
  doubles as the comparison baseline).
- **Difference mode**: a per-plot **Values / Δ Diff** toggle plots each non-ref
  file minus the reference over aligned time (zero baseline), built on
  `calculateDiff`.
  Design grounded in viz research (color = primary category, dash = secondary;
  overlay for value-at-point, real units for value reading).

---

## File map (key files)

```
app/                         Next.js app (layout, page, globals.css)
electron/
  main.cjs                   Electron entry: window + native menu
  static-server.cjs          in-process static server for out/
lib/
  csv.ts                     ECU CSV parser → Signal[]
  telemetry.ts               types + synthetic sample data
  compare.ts                 time-aligned diff + stats (multi-file compare)
  annotations.ts             annotation model + localStorage persistence
  downsample.ts              LTTB downsampling (render performance)
  kpis.ts                    adaptive KPI summary cards
hooks/
  use-shortcuts.ts           keyboard shortcut hook
components/runscope/
  dashboard.tsx              top-level state + layout
  rail.tsx                   far-left icon rail
  control-panel.tsx          left dock: search, controls, window, channels
  signal-chart.tsx           one channel plot (Recharts, memoized)
  range-brush.tsx            window selector (bottom + compact variants)
  kpi-cards.tsx              summary cards
  loaded-files.tsx           multi-file list
  upload-zone.tsx            empty-state importer
  display-panel.tsx          display settings (in Settings modal)
  settings-modal.tsx         Settings dialog
  shortcuts-modal.tsx        keyboard-shortcuts help
  annotation-dialog.tsx      add-annotation dialog
```

## Keyboard shortcuts

`Ctrl+O` open · `Ctrl+K` search · `S` sync · `A` annotate · `C` compare ·
`R` reset · `?` help · `Esc` close dialogs.

## Not yet ported / possible follow-ups

- Sessions/Logs list, Favorites/Presets, Quick Filters from the reference
  (need a persistence/session model).
- Export to PNG/SVG/PDF (currently Export = CSV of visible channels).
- Continuous finger-follow cursor on mobile (currently tap-to-snap).
