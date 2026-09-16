# Octane

Octane is a development-stage ECU telemetry log viewer for inspecting CSV/TXT log captures on desktop and mobile.

Current development version: `0.9.2`

## Mobile Web Preview

Open the public mobile build here:

https://everlasting-dev.github.io/octane/

The app is fully client-side. Imported logs stay in the browser/device session.

## Desktop Build

The Windows developer build is produced as an unpacked Electron app:

```powershell
npm run pack:win
```

Output:

```text
release/win-unpacked/Octane.exe
```

## Local Mobile LAN Preview

```powershell
npm run preview:mobile
```

Then open the printed local IP address from a phone on the same Wi-Fi network.

## Main Areas

- Signal Matrix: simple per-channel plot browsing and quick search.
- Analysis Plot: focused multi-line overlay analysis with cursor values and timeline control.
- Channels: editable diagnostic preset groups for PC tuning workflows.
- Compare: multi-log comparison workflow for desktop review.

Proprietary. All rights reserved.
