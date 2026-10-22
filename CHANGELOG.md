# Changelog

All notable changes to Octane are documented here.

Octane shipped a 1.0.x series before moving back to a pre-1.0 development
track. Those releases were withdrawn: `v1.0.0` through `v1.0.6` are no longer
published as GitHub releases or tags, and the only public release is the
current `0.9.x` line. Their entries are kept below for history and are marked
accordingly. Version numbers therefore decrease part-way down this file.

## v0.9.11 - 2026-10-22

### Added

- The Templates list in the side panel can be made taller by dragging the bar under it (double-click resets). Window and Channels move down and the Channels list gets shorter instead of the panel scrolling; it stops at a minimum that depends on the screen height (18 % of it, 96-240 px).
- "?" help on the side panel sections (Controls, Templates, Window, Channels), the Analysis Plot and Self check: click or tap for a short explanation of what it is and how to use it.

### Fixed

- Scroll zoom in the Analysis Plot on laptops: a precision touchpad or smooth-scrolling mouse sends many small scroll steps between two redraws, and each one started from the last drawn window, so they overwrote each other and the zoom hardly moved. Steps now add up (40 small steps zoom as far as one big one).
- Touchpad pinch (two fingers) zooms the Analysis Plot.
- Zooming out near the start or end of the log keeps widening the window (it used to be cut short at the edge).

## v0.9.10 - 2026-10-22

### Added

- **Tidy lanes** in the Analysis Plot (PC and phone): related channels share a lane and lanes stack top to bottom (RPM, speed, pedal / throttle, boost, AFR, timing / knock, pressures, trims, gear / clutch, temperatures, voltage, ethanol, flags). Channels with known ranges get a fixed scale so normal readings look calm (battery 10-16 V, ethanol 0-100 %, coolant 0-130 °C, AFR 9-16, pedal 0-100 %). Your own scaling in the Lines panel wins; Auto scale / Reset return a line to its lane. Settings -> Display -> Analysis lines switches between Tidy lanes and Overlay. The axis labels follow the focused line's lane.
- Zoom on the plot itself: pinch with two fingers on the phone (moving them pans), double-tap / double-click to zoom in 2x at that point, mouse wheel zooms around the pointer on the PC (Shift+wheel still stretches lines). Fit shows the whole log again.
- Templates on the phone: save the current lines as a new template, update a template with the current lines, rename and delete it (Select channels -> Templates).
- Templates in the phone Signal Matrix: a Templates button next to the channel search loads any template (the active one is ticked), All channels or the Default set, and saves the current channels as a new template.
- Owner: "Open from Cloud" on the start screen, next to Import CSV (PC and phone).
- Cloud Logs: the Upload tab says when the open log is already in the library (and which entry) before you try to save it.

### Changed

- Reset keeps the channels you picked, in the Analysis Plot (it resets time, scaling, split and peaks) and in the Signal Matrix (time, collapsed charts, search). Fit only shows the whole log.
- Findings are shaded in the Analysis Plot only when they involve a line on that plot.
- Display settings are remembered between sessions.

### Fixed

- Phone landscape: the time range bar sat on top of the bottom of the Analysis Plot (and its time labels); it now has its own space below the plot.
- The time range bar's handles have a finger-sized grab area on touch screens.

## v0.9.9 - 2026-10-21

### Added

- **Self check**: every loaded log is scanned automatically for things worth a second look. A header button shows the counts (critical / warnings) and opens the panel; `C` toggles it.
  - Transmission: clutch slipping under power, engine flare as a gear engages (up- and downshifts), slow or incomplete shifts, transmission fluid temperature, line / clutch pressure not reaching target, clutch pressure above the stock seal limit, CSP (clutch slip protection) interventions.
  - Fuel: lean AFR under boost (absolute and against target), AFR bank-to-bank split, fuel pressure dropping at full load, injector duty, fuel trims (the GT-R 100 = neutral scale is handled), unstable ethanol readings.
  - Boost and air: overboost, underboost once boost has plateaued, bank-to-bank boost split, wastegate duty maxed, saturated boost / MAP / oil pressure sensors, MAF voltage maxed, hot intake air, throttle closing at full pedal, pedal / throttle sensor disagreement.
  - Engine and chassis: knock retard, coolant temperature (boost restriction above 110 °C), coolant pressure (including pressure building while cold: a head gasket warning sign), oil pressure low for the rpm, VVT not following target, battery / charging voltage, wheel slip, traction control cuts, vehicle vs wheel speed mismatch, engine speed (8,192 rpm TCM limit), RaceROM failsafe / stored failsafe / MIL decoding.
  - Optional (off by default): warm idle compared with the factory CONSULT reference values.
- Each finding has its measured values, likely causes and what to check, related DTCs and references (Nissan GT-R service manual section EC, EcuTek RaceROM / TCM documentation). **Jump** moves the cursor to it, **Plot** opens Analysis with the channels that explain it.
- Findings are shaded on the Signal Matrix and Analysis plots, and the bottom strip shows the finding under the cursor.
- **Tune checks**: every threshold can be changed (and every check switched off) in the panel; changes re-run immediately and are remembered. Settings -> Self check turns the feature or the plot shading off.
- `scripts/self-check-report.mjs` runs the same checks on CSV files from the command line, for tuning thresholds against real logs.
- Cloud Logs on the phone (admin account only): save the open log to the cloud library from the web / phone app, then load it or **Save .csv** on the PC. Every library entry now has a Save .csv button that downloads the original file.
- The Lines panel, the Analysis line list and groups, the Channels Values panel and the Self check panel can be resized by dragging their left edge (double-click resets). Each remembers its width.
- New install command (see the install site README): locks the license to the PC, signs you in, removes every older version completely, installs the latest release after checking its checksum, signs the app in for you, deletes the downloaded files and finishes with a self diagnosis. `octane-check` runs the self diagnosis on its own.

### Changed

- Licenses last 30 days from an account's first ever sign-in (was 15); Renew adds 30 days. A deployed license database needs `supabase/licenses-30-days.sql` run once.
- The Self check panel closes when you click or tap anywhere outside it, or press Esc.

### Fixed

- The cursor dot now sits exactly on the drawn line. Plots used to downsample the whole log once, so a zoomed-in window drew only a few points with the smooth curve while the dot followed the real readings. Each plot now draws the visible window (every real sample once it fits) and places the dot with the same curve; the readout still shows the real value.

## v0.9.8 - 2026-10-03

### Added

- Compare: a bar pinned to the top while you scroll lists every file in the comparison, each with a close button, plus quick search (`/` or the Quick search button) to jump straight to one graph. Overlay areas has close buttons too.
- Settings -> Cursor glide speed: Crawl, Slow (default), Medium or Fast.
- A banner shows while Window mode is on (W toggles, Esc cancels); it switches off after one selection.

### Changed

- The value cursor glides smoothly at 60 fps while an arrow key is held (no more sticking and jumping on big logs); a tap moves exactly one sample. Graphs no longer redraw on every cursor step.
- The keyboard shortcuts list and the key-binding editor are grouped by task, with search, paired keys on one row and a reset for each changed shortcut.
- The plot readout lists every line (not just 6), on faint dark chips that keep the plot visible, and moves to the side away from the cursor.
- Clicking a graph hands the keyboard back to it, so arrow keys work right after using a dropdown such as Template.
- The Licenses panel opens from the owner badge; the separate button is gone.

### Fixed

- Window mode works in Compare -> Overlay areas, with alignment locked or unlocked.

## v0.9.7 - 2026-10-03

### Added (icon, license, install menu)

- New Octane icon everywhere: the app window and taskbar, the installer, browser favicons and the phone home-screen icon (PWA, maskable and Apple touch icons), plus the logo inside the app.
- Licenses are now kept on the Octane server: each account gets 15 days from its first ever sign-in. Logging out, reinstalling or deleting app data never restarts the clock, and every PC an account uses is recorded.
- When the 15 days run out the app shows a "License expired" screen until the owner renews it. The owner never expires.
- Owner-only **Licenses** panel (top bar, next to Cloud Logs): every account with its first sign-in, expiry, renewals and PCs, and a **Renew 15 days** button.
- Owner rights (Cloud Logs, Licenses, the shared template pack) now match one exact email set on the server, instead of any address containing a name.
- The install menu at `everlasting-dev.github.io/get` has an Octane section: install/update, check & repair, lock the license on this PC, get the shared template pack (the PC's own templates are backed up privately to the owner first), publish the pack and collect backups (owner). Every option in the Octane and Slip menus now has a one-line description.

### Changed

- Built-in templates installed from the shared pack are kept on first start instead of being replaced by the defaults.

### Added (ECU flag decoding)

- CSP Flags, Failsafe Flags, Failsafe Stored Flags and MIL Source are decoded into plain conditions, e.g. CSP 29 = outside upshift exclusion time + min input shaft speed + min load + min slip error.
- A subtle strip under the plots shows Failsafe, Stored, MIL and CSP at the cursor (or the end of the window), coloured by severity. Each failsafe trip in the log is a button that jumps the cursor to it.
- Matrix chart footers, the Analysis readout and the Channels Values pane show the decoded text for those channels, using the exact logged value rather than an interpolated one.
- Settings → Failsafe flag decoding: Phase 6 RaceROM (default; 16 = low relative fuel pressure, 32 = lean AFR) or newer RaceROM (16 and 32 swapped, plus bits 256 and up).

### Changed (templates and shortcuts)

- Templates and Channels presets are now one shared list, saved in one templates file. The Analysis Plot, the Channels tabs, Compare and the phone picker all use it. Built-ins: General, Fuel, Ignition, VVTi, Speeds (vehicle + wheel speeds, speed/RPM/gear, traction), GR6 (clutch slip with RPM and gear, shifts, torque, drivetrain), Boost, Temps, Idle, E-throttle and Ethanol, each with its own graphs. Your own templates and custom Channels presets carry over; the old duplicate Speed / Wheel speeds entries are gone.
- **Edit templates** (Channels view) edits that shared list: templates, their graphs and the channels in each graph.
- Window mode switches itself off once you've dragged out a time range (PC and phone).
- `←` / `→` now move the value cursor one sample at a time; `Shift` + `←` / `→` shift the time window.
- Every shortcut can be changed in Settings → Key bindings, including combos with Ctrl, Shift or Alt. Only Esc is fixed.

### Added

- Window mode: turn on **Window** (or press `W`) and drag across any Signal Matrix, Analysis or Channels graph to set the shared time window, like the old EcuTek viewer. Works with touch on phones; double-click a graph to fit the full log again.
- **Lines** panel (button or `T`): per-line colour, scale min/max with ▲/▼ nudges, gain, shift and line weight, plus Auto scale and Reset all. Opens as a side panel on desktop and a bottom sheet on phones.
- Keyboard line control in the Analysis Plot: `[` / `]` pick a line, `Ctrl` + `=`/`-` scale it, `Ctrl` + `↑`/`↓` move it, `Ctrl+Shift` + `=`/`-` change its weight, `Ctrl+0` resets it.
- Keyboard time control everywhere: `=`/`-` zoom the time window around the cursor, `←`/`→` pan it (hold `Shift` for bigger steps).
- Compare now opens as a signal matrix of every channel the loaded logs share, one graph per channel with each file overlaid and per-file values at the cursor. The previous overlay areas are one click away.
- Phone Analysis channel picker: large rows, **Channel list | Templates** tabs and a **Deselect all** button. Up to 10 lines (was 6).

### Changed

- Signal Matrix shows every channel when a log loads (desktop). Graphs mount as you scroll, so big logs stay responsive.
- The Analysis Plot keeps its own line selection, starting from the General template, so the matrix can show everything while the overlay stays readable.
- Channels presets list your templates first (General, Fuel, Ignition, Speed and your own), each split automatically into separate graphs by channel type. The specialist presets follow.
- The Channels view opens with just the graphs; the Values pane is opt-in.
- Low-variance channels such as battery voltage and ethanol content are drawn as quiet, near-flat lines instead of being stretched to full height.
- Every visible line gets its own colour; colours stay put while other lines are toggled.
- Each opened CSV remembers its own time window per view, so switching files and back restores the range you selected.
- Phone quick search moves to the top while you type and hides the bottom bar, so a single matching plot stays visible above the keyboard.
- Phone Signal Matrix bottom bar: **Window** toggles drag-to-select; the time brush moved to **Range**.

### Removed

- The "Load sample data" buttons on the landing page and empty state.

## v0.9.6 - 2026-09-25

### Added

- Added a PC-only admin Cloud Logs library backed by Supabase metadata and private Storage objects.
- Added cloud-log upload with custom names and comments, gzip compression, duplicate detection, and local desktop caching.
- Added cloud-log load/edit/delete actions with Octane-themed dialogs and friendly cloud-specific error messages.
- Added `supabase/cloud-logs.sql` for the admin-only table, bucket, and RLS policies.

### Changed

- Changed the PC toolbar wording from `Import CSV` to `Add CSV`, and from `Export` to `Export visible`, clarifying that export writes the currently visible channels rather than the original log.
- Updated Cloud Logs copy and buttons to show that lists are metadata-only and uncached logs download only when explicitly selected.
- Moved the 30-day subscription timer anchor into the encrypted desktop auth session and made the license badge refresh while the app is open.

## v0.9.5 - 2026-09-25

### Added

- Added a desktop-only loaded-log switcher in the top bar with previous/next controls and a direct active-log selector.
- Added a previous loaded/reference file shortcut with `,`; the existing `.` shortcut now explicitly moves to the next loaded/reference file.
- Added updater downgrade allowance for the withdrawn `1.0.x` installs so they can move onto the current `0.9.x` development track.

### Changed

- Updated the keyboard shortcut guide and keybinding settings to show the previous/next loaded file controls.
- Bumped the Octane development build to `0.9.5`.

## v0.9.4 - 2026-09-16

### Added

- Published a Windows installer, `Octane-Setup-0.9.4.exe`, with the Octane license bundled beside the app and attached to the GitHub release.
- Added a one-line installer command that downloads the latest setup, installs it silently, and deletes the downloaded setup files.

### Fixed

- Fixed mobile layout desyncing from its own stylesheet on iOS: viewport detection read `window.innerWidth`/`innerHeight`, which follow the visual viewport and shrink as Safari's toolbars slide in, while the CSS evaluated `max-height` against the large viewport. On a landscape iPhone the two straddled the 540px fullscreen threshold, so the app could drop the header while the CSS still reserved room for it. Both now subscribe to the same media queries.
- Fixed mobile landscape chrome sitting under the camera island: horizontal gutters used whichever of `safe-area-inset-left`/`right` matched the side the sensor housing was reported on, so rotating the phone the other way put the island over the unpadded edge. Mobile gutters now use the larger of the two insets and clear the island on both rotations.
- Added the missing left/right safe-area spacing to the Signal Matrix quick search bar, the `Sync`/`Window`/`Reset`/`Fit` action bar, the `Window` drawer, the Controls sheet, and the Analysis channel dock, all of which sat on the raw screen edge.
- Fixed Y-axis tick labels disappearing behind the camera island in the fullscreen landscape plot by insetting the plotting surface itself.
- Fixed the Signal Matrix bottom action bar floating above the bottom of the screen with the plot list scrolling visibly through the gap underneath. The bar was offset with `bottom`, which lifts its background off the physical edge as well; it now stays anchored at the edge and absorbs the inset as padding, so the background covers the home-indicator strip and the buttons sit above it.
- Fixed the Controls panel adding the bottom inset on top of the one its containing sheet already applies, which left an oversized gap above the home indicator.
- Fixed the Dashboard's fixed chrome painting through the landing page. The mobile header (`z-index: 60`), the fullscreen landscape plot shell (`45`) and the Controls sheet (`90`) all outranked the landing overlay (`z-40`), so the dashboard's blurred header showed over the top of the landing page and left its wordmark and the Controls icon half covered. The Dashboard now forms its own stacking context, so its internal z-indexes can no longer outrank app-level overlays.
- Added the missing safe-area spacing to the landing and login screens, which previously had none at all.

### Changed

- Moved the safe-area insets into `--octane-safe-*` custom properties and the mobile breakpoints into `lib/viewport.ts`, so the stylesheet and the components no longer keep separate copies of either.

## v0.9.3 - 2026-09-16

### Fixed

- Restored the compact mobile top toolbar icon design while keeping iPhone safe-area spacing.
- Added landscape safe-area spacing for the mobile Analysis ghost readout so it avoids the iPhone camera island.
- Added left/right/bottom safe-area spacing for the mobile Analysis timeline, channel sheet, and fullscreen plot header.

### Removed

- Removed the withdrawn `v1.0.0` through `v1.0.6` public releases and tags, leaving `0.9.3` as the only published release.

## v0.9.2 - 2026-09-16

### Fixed

- Enlarged the loaded-log mobile top toolbar so `Controls`, `Matrix`, and `Analysis` are easier to tap.
- Changed the mobile Controls sheet into a true top-layer panel so its close button is no longer hidden behind the app toolbar.
- Added a text `Close` action to the mobile Controls sheet header.

## v0.9.1 - 2026-09-16

### Fixed

- Fixed the mobile Matrix/Analysis top control bar so it stays reachable above the scrollable plot list with iPhone safe-area padding.
- Fixed mobile quick-search plot jumps so the selected plot is not hidden beneath the fixed top controls.
- Reset the mobile plot scroll position when loading logs, switching Matrix/Analysis, or resetting Matrix.

## v0.9.0 - 2026-09-15

Development-channel update. Octane remains pre-1.0 while the desktop installer, licensing/update flow, Channels presets, and mobile ergonomics are still being refined.

### Added

- Added a dedicated `Channels` view with ECU tuning preset tabs for General Tuning, Idle, Boost, VVT, E-Throttle, Temps, Wheel Speeds, GR6, Clutch Speeds, Clutch Temps, All Temps, and Ethanol.
- Added compact ECUtek-style grouped plots inside the `Channels` view, with each preset rendered as a small number of multi-line diagnostic graphs.
- Added grouped channel bundles for Engine/Air, Fuel/Ignition, Boost Response, Wastegate/Airflow, Cam Control, E-Throttle, GR6, clutch, temperature, and ethanol diagnostics.
- Added an Octane preset diagnostics workbench with wrapped preset chips, dense grouped plots, and a readable live Values inspector.
- Added an Octane-native Channels help window covering presets, values, cursor behavior, and plot adjustments.
- Added a Channels preset editor for adding/removing graph groups and adding/removing individual channel lines inside each graph.
- Added explicit Save/Cancel behavior to the Channels preset editor so custom graph/channel layouts can be staged, saved locally, or discarded.
- Added a full Channels layout manager for editing the entire Channels workspace: preset names/order, custom preset creation/removal, graph counts, graph names, and per-graph channel lines.
- Added dock-template integration inside the Channels layout manager so existing dock templates can create new Channels presets, be added into the active graph, or receive the current Channels preset as a saved dock template.
- Added Channels layout import/export as `octane-channels-layout.json` so a full preset/graph layout can be moved to another Octane install.
- Added translucent cursor readouts inside grouped panes.
- Added cursor dots on plotted lines so the selected time/value is easier to inspect.
- Added desktop ghost-readout line picking: hover a channel name in the transparent readout to highlight that plot line, or click it to focus/select it for scaling and adjustments.
- Added a desktop `Pick` toggle for enabling/disabling ghost-readout hover/click line selection in Analysis and Channels views.
- Added `V` as the shortcut for the plot readout picking toggle and `E` as the shortcut for the desktop Channels layout editor.
- Added desktop license status display with remaining subscription time; the `akramfariz` admin account reports a lifetime license.
- Added `TEMPLATE_REFERENCE.md` with the main dock templates, Channels preset graphs, graph names, and all default preset channel labels.
- Added mobile ghost readout text shadows so values remain readable without a background box.
- Added a mobile Signal Matrix quick-search bar at the bottom of the screen for faster channel jumps.
- Added unit-aware Signal Matrix Y-axis tick labels.
- Added a compact mobile header toggle for switching directly between Signal Matrix and Analysis Plot.
- Added touch scrubbing to mobile Signal Matrix plots so the dotted cursor snaps on tap and follows horizontal finger drags.
- Added mobile Signal Matrix default channel priority matching for common tuning channels such as accelerator pedal, AFR B1, battery voltage, boost, engine speed/load, ethanol content, fuel pressure/trims, ignition timing, MAP, torque, VVT, wastegate duty, wheel slip, and wheel speeds.
- Added a desktop top-bar toggle for minimizing and restoring the left Controls dock.
- Added a login quick guide covering app capabilities, common workflows, and shortcuts.
- Added signed-in account display and quick logout on the authenticated landing screen.
- Added certificate/trust guidance to the Octane updater UI and an admin helper script for installing an Octane signing certificate.
- Added mobile LAN preview support through `npm run serve:mobile` using the machine IP.
- Added mobile/PWA assets and manifest files for phone testing.
- Added a public GitHub Pages deployment workflow for mobile phone testing at `https://everlasting-dev.github.io/octane/`.
- Added GitHub Pages base-path handling so the same app can run under `/octane/` publicly and still run at root for Electron/LAN previews.

### Changed

- Restored the default Analysis Plot behavior to the original single overlay view.
- Changed the app package version to the pre-1.0 development track, starting at `0.9.0`.
- Updated public app descriptions, metadata, README, and PWA manifest wording for `Octane ECU Telemetry Viewer`.
- Kept the split/double graph workflow inside the desktop Analysis Plot toolbar.
- Removed the old Analysis Plot `Groups` sub-tab so grouped diagnostics live in the cleaner `Channels` workspace.
- Updated the grouped graph body so Channels preset panes scroll vertically instead of being trapped inside the viewport.
- Restyled the desktop Channels page as an Octane diagnostics workspace instead of a copied logger-style layout.
- Reworked the desktop Channels page away from the reference clone into an Octane preset diagnostics layout with larger graph rows, wrapped preset chips, a cleaner Values inspector, and no `Data (D)` rail.
- Reduced wasted vertical space in the desktop Channels workspace by removing the duplicate page heading and keeping preset controls inside the diagnostics surface.
- Changed desktop Channels ghost readouts back to a fully transparent window with only text-level black backing for readability.
- Changed ghost readouts across Analysis and Channels to use a fully transparent container with black text-level backing for better graph visibility.
- Changed the landing page and app metadata to present the product as `Octane` instead of `Signal Matrix`.
- Removed the desktop top menu `View` dropdown from the Electron shell.
- Improved mobile analysis mode so value readouts sit over the graph as a light "ghost" overlay.
- Simplified mobile Analysis Plot to the single overlay plot with a searchable Channels sheet for toggling visible lines.
- Simplified mobile navigation so phone users only move between Signal Matrix and Analysis Plot.
- Changed mobile landscape Analysis Plot to automatically behave like a fullscreen plotting surface on short screens while keeping the channel selection toggle available.
- Added an explicit mobile Analysis Plot fullscreen button; it attempts browser fullscreen from a tap and falls back to Octane's own fullscreen overlay when the phone browser blocks it.
- Added viewport width/height/orientation detection in the Analysis Plot so short landscape phone screens automatically enter Octane fullscreen mode.
- Added an old ECUtek-viewer style Signal Matrix mobile action bar with `Sync`, `Window`, `Reset`, and `Fit` controls directly above the mobile rail.
- Added a compact mobile `Window` drawer for Signal Matrix using the shared timeline brush, so range adjustment no longer requires opening the full Controls sheet.
- Moved mobile Import CSV and Export actions into the Controls sheet so the top bar can stay focused on view switching.
- Removed the redundant mobile bottom view rail after moving Matrix/Analysis switching into the header.
- Changed mobile Signal Matrix to open directly into plots by hiding top KPI cards, loaded-file cards, the section heading, and per-channel Max/Min/Avg header values.
- Changed mobile Analysis Plot to use its own independent six-line channel selection so Signal Matrix can show more diagnostic plots without overcrowding the single Analysis graph.
- Changed Signal Matrix readouts so disabling `Sync` keeps a local per-plot cursor/value readout instead of hiding the readout entirely.
- Changed the mobile analysis channel sheet into a taller scrollable bottom panel so it can show more channels without hiding the plot permanently.
- Changed the phone landscape channel selector into a compact side overlay so it does not consume the graph height.
- Simplified the mobile Controls sheet by hiding desktop-only template and annotation controls.
- Improved mobile landscape Controls behavior by allowing the sheet to use the full screen and scroll as one panel.
- Hid keyboard shortcut UI on mobile while keeping it available on PC.
- Added compact desktop sizing rules for lower-height or lower-width monitors so the control dock, KPIs, and plot chrome use less room.
- Changed mobile ghost readouts to use a fully transparent background so the graph stays visible underneath.
- Optimized mobile Analysis landscape mode by shrinking chrome, reducing the bottom rail height, and overlaying the timeline instead of letting it consume plot height.
- Changed collapsed desktop Analysis docks to show a transparent, clickable ghost readout over the plot.
- Reduced grouped-pane Y-axis clutter when readouts are visible.
- Removed GitHub-facing links and wording from the in-app GUI.
- Updated default view shortcuts so `1` opens Signal Matrix, `2` opens Analysis Plot, `3` opens Channels, and `4` opens Compare.
- Improved mobile safe-area handling for the bottom rail and analysis timeline.
- Rebuilt the Windows unpacked developer build at `release/win-unpacked/Octane.exe`.

### Fixed

- Fixed the grouped diagnostic view where lower graph panes could not be reached by scrolling.
- Fixed mobile Settings modal scrolling from Signal Matrix and other views.
- Fixed settings modal height behavior on mobile by using the actual `100dvh` viewport.
- Fixed settings and key binding pages so their content scrolls within the modal on mobile and desktop.
- Fixed mobile Analysis Plot channel selection when the right-side list was too tall to scroll comfortably.
- Fixed Channels presets so missing default pattern names do not block custom channel lines from appearing in graph groups.
- Fixed Channels preset customization so edited graph groups are persisted only after pressing Save and Cancel no longer leaves partial edits behind.
- Fixed Channels preset reset behavior so defaults are staged in the editor first instead of silently overwriting the saved preset.
- Fixed Channels customization scope so edits are no longer limited to the currently selected preset.
- Fixed Channels diagnostics so the visible graph count now matches the layout manager; hidden auto-generated `Other Matches` graphs are no longer appended.
- Fixed Channels layout manager `Esc` behavior so it closes and discards staged changes unless `Save channels` is pressed.
- Fixed native desktop `File > Open log...` by opening the dialog in Electron main and sending the selected file through the desktop file-open bridge.
- Fixed the Analysis Plot empty-selection state so mobile users can still open the channel picker and recover channels.
- Fixed cursor dots appearing offset from the dotted cursor line by sampling/interpolating values at the actual cursor timestamp.
- Fixed Analysis cursor dots and peak markers being clamped below the top edge of the plot.
- Fixed Matrix and Analysis `Fit`/`Reset` buttons so Fit only restores the full time window while Reset clears the relevant view state.
- Improved mobile Analysis Plot scrubbing so horizontal finger drags hold the cursor smoothly instead of competing with browser gestures.
- Fixed mobile browser auto-zoom when focusing compact search boxes by using a phone-safe input font size.
- Fixed mobile Analysis Plot channel selection so unchecked channels are disabled at 6/6 selected and re-enabled after a selected channel is removed.
- Fixed native menu `File > Open log...` so it works from the landing overlay through the AppShell file-open flow.
- Fixed native menu `Help > About Octane` so it opens from app-shell level screens.
- Fixed desktop update/auth failure messaging so common connection, session, certificate, signature, access, and installer failures show aligned human-readable messages with optional technical details.

### App Structure

- `app/`: Next.js app-router entry and global responsive/mobile styles.
- `components/runscope/`: shared UI for desktop and mobile, including dashboard, rail, plots, Channels presets, compare view, modals, and upload flow.
- `lib/`: shared parsing, telemetry, templates, downsampling, compare logic, KPIs, keybindings, updates, annotations, desktop file helpers, and VIN decoding.
- `electron/`: PC desktop shell, local static server, preload bridge, auth bridge, window/menu/file-open handling, and updater integration.
- `public/`: mobile/PWA icons, manifest, Open Graph image, and static assets.
- `scripts/`: icon generation, installer helper, and LAN mobile preview server.
- `out/`: generated static web/mobile build produced by `npm run build`.
- `release/win-unpacked/`: unpacked PC developer build produced by `npm run pack:win`.

### PC Version

- Built as an Electron desktop app.
- Loads the static Next.js export from `out/` through the local Electron static server.
- Supports CSV file association, native File > Open log flow, desktop templates storage, auth bridge, and auto-update plumbing.
- Supports ECUtek-style grouped Channels preset panes and click-to-focus ghost readout rows.
- Supports the Channels preset workspace and app-shell level native menu handlers.
- Developer test build is available at `release/win-unpacked/Octane.exe`.

### Mobile Version

- Uses the same Next.js/React app as the desktop build.
- Runs as a static web/mobile build served from `out/`.
- LAN testing is served with `npm run serve:mobile`, which binds to `0.0.0.0` and prints the local phone URL.
- Current mobile workflow is optimized around Signal Matrix, bottom quick search, a single Analysis Plot, six-line Analysis selection, searchable channel toggles, timeline adjustment, smooth touch scrubbing, transparent ghost cursor values, scrollable controls, and scrollable settings.

## v1.0.6 - 2026-07-23 (withdrawn)

Superseded by the `0.9.x` development track; no longer published.

### Added

- Octane desktop analyzer branding and packaging.
- Next.js static export wrapped in Electron.
- Signal Matrix view with searchable channel list and per-channel plots.
- Analysis Plot view with multi-channel overlay, cursor readout, scaling, offsets, split plotting, peak marking, annotations, and templates.
- Compare Runs view for multi-log inspection.
- VIN detection, validation, optional NHTSA decoding, and local privacy controls.
- Keyboard shortcuts and remappable key bindings.
- Windows packaging through electron-builder.

## v1.0.0 - 2026-06-27 (withdrawn)

Superseded by the `0.9.x` development track; no longer published.

### Added

- Initial EcuTek-compatible CSV/TXT parsing.
- Initial telemetry dashboard.
- Initial plot rendering with shared time domain.
- Initial responsive UI foundation.
