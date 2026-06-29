# Octane

**Octane** is a desktop analyzer for ECU telemetry logs. Open an EcuTek (or compatible) CSV datalog and explore it through an interactive multi-channel plot, a sortable signal matrix, and a run-to-run comparison view — with per-channel scaling, peak detection, annotations, and a built-in VIN decoder.

Built with Next.js + React on a static export, wrapped in an Electron desktop shell with auto-update.

---

## Features

- **Analysis Plot** — overlay any number of channels on a shared time axis with real-unit Y scaling, per-line gain/offset, a split second plot, peak markers, and a draggable cursor/readout.
- **Signal Matrix** — a dense, sortable grid of every channel with inline sparklines and quick search.
- **Compare Runs** — align multiple logs in faceted plots, lock-to-read, and step a cursor across runs.
- **Annotations** — drop time-stamped marks and jump back to them.
- **Templates** — save and reuse channel/layout setups; import & export as JSON.
- **VIN decoder** — detects the VIN in a log's metadata, validates it, and decodes the vehicle (year / make / model / trim / engine / transmission / assembly) via the public [NHTSA vPIC](https://vpic.nhtsa.dot.gov/) database, enriched with a local vehicle profile. Fully privacy-controlled (see below).
- **Keyboard-first** — remappable shortcuts for nearly every action; press `?` for the reference.
- **Auto-update** — the desktop app checks GitHub Releases on launch and via **Help → Check for Updates**.

---

## Install

Download the latest installer from the [Releases](https://github.com/Everlasting-dev/octane/releases/latest) page and run it.

The desktop app auto-updates itself from new releases — no need to reinstall manually.

---

## Develop

Requires Node.js 20+.

```bash
npm install

npm run dev          # Next.js dev server in the browser
npm run desktop      # build the static export and launch the Electron app
```

### Build & package

```bash
npm run build        # static export to ./out
npm run pack:win     # unpacked Electron build (no installer) → ./release/win-unpacked
npm run dist:win     # NSIS installer → ./release
npm run gen:icons    # regenerate app icons from the SVG masters
```

Publishing a release (`npm run publish:win`) requires a code-signing certificate
(`CSC_LINK` / `CSC_KEY_PASSWORD`) and a GitHub token (`GH_TOKEN`) in the environment.

---

## Project structure

```
app/                     Next.js app-router entry (single page + global styles)
components/runscope/      UI — dashboard, plots, matrix, compare, modals, rail
lib/                      App logic
  csv.ts                  EcuTek CSV parsing → ParsedLog
  downsample.ts           LTTB downsampling for fast rendering
  keybindings.ts          remappable shortcut system
  templates.ts            save/restore layouts
  compare.ts · kpis.ts    run comparison & summary stats
  vin/                    VIN decoder (validate · extract · nhtsa · enrich · identify)
electron/                 Desktop shell
  main.cjs                window, menu, IPC, auto-update
  preload.cjs             contextIsolated `window.octane` bridge
  static-server.cjs       serves the static export on a fixed localhost port
  auth.cjs                Supabase email/password sign-in
build/                   icon source + electron-builder resources
scripts/                 icon generation + installer helper
public/                  static assets / icons
```

---

## VIN decoding & privacy

The VIN decoder reads the VIN already present in a log's own metadata — it does not access any vehicle remotely. It has three modes (Settings → **VIN decoding**):

| Mode | Behavior |
| --- | --- |
| **Online** (default) | Decodes via the public NHTSA vPIC API and caches the result locally. |
| **Local only** | Decodes offline from the VIN structure; no network request. |
| **Off** | VIN decoding is disabled. |

VINs are **masked by default** in the UI (e.g. `JN1AR5EF2JM71••••`) with an explicit reveal toggle. Decoded results are cached in `localStorage`, keyed by VIN. No telemetry, logs, or VINs are uploaded by Octane other than the VIN string sent to NHTSA in Online mode.

---

## Tech

Next.js 16 (static export) · React 19 · Recharts · Tailwind v4 · Electron 42 · electron-updater · electron-builder.

## License

Proprietary — © AK Everlasting Dev. All rights reserved.
