# Octane Major Update Plan

Prepared: 2026-09-14

This is a planning document only. No application behavior should be changed until implementation is explicitly approved.

## Goals

- Improve readability in Analysis/Groups plots by reducing text and axis clutter.
- Add a useful login/start guide with app capabilities, shortcuts, account status, and fast logout.
- Add a dedicated Channels view for preset channel collections so the Signal Matrix and Analysis views stay cleaner.
- Improve the installer/update experience with Octane-branded UI, certificate/signature validation, and an internal-certificate deployment path.
- Remove GitHub-facing links/wording from the app GUI.
- Fix app menu actions that currently do nothing.

## 1. Plot Readability And Ghost Readout

### Problem

The graph text is still interfering with the plotted lines. The left Y-axis legend values are redundant when the ghost readout already shows channel names and live values.

### Plan

- Hide or greatly reduce Y-axis numeric labels in Analysis Plot grouped panes when a ghost/pane readout is visible.
- Keep grid lines and cursor line visible, but avoid stacking Y-axis values behind channel names.
- Keep ghost readout text high contrast using text shadow, without a background box.
- Review whether the focused line should be the only line with a full Y-axis scale on desktop, while grouped panes use the readout for values.
- Add a display setting if needed: `Show Y-axis values in Analysis`.

### Acceptance Criteria

- Channel names and values are readable without covering too much plot area.
- The graph remains inspectable in Groups view.
- No duplicate value systems fight each other visually.

## 2. Login Page Guide, Account Status, And Logout

### Problem

The login screen is only a credential gate. It should explain what Octane can do, how to use it, and what shortcuts exist. If login is already saved, the user should see the logged-in account and have a quick logout path.

### Plan

- Expand the login screen into a two-column desktop layout and a stacked mobile layout:
  - Login form.
  - Quick start guide.
  - Capability overview.
  - Keyboard shortcuts.
  - Privacy/local-file note.
- Show account status when a saved session exists:
  - Email/account identifier if available from the auth state.
  - Session status such as `Signed in`.
  - Quick `Logout` button.
- Add guide sections:
  - Import CSV/TXT logs.
  - Use Signal Matrix for per-channel inspection.
  - Use Analysis Plot for overlay/split/grouped analysis.
  - Use Channels view for preset collections.
  - Use Compare Runs for multi-log comparison.
  - Use templates/presets for repeat workflows.
  - Use annotations and cursor readouts.
- Include shortcut list:
  - `Ctrl+O`: open log.
  - `Ctrl+K`: search channels.
  - `?`: shortcuts.
  - Analysis focus/selection shortcuts from the current key binding system.
- Keep language practical and not marketing-heavy.

### Acceptance Criteria

- Login page explains the app without requiring the user to reach the main app first.
- A saved login clearly shows which account is active.
- Logout is available without digging through Settings.

## 3. New Channels View

### Problem

The Signal Matrix and Analysis views are carrying too much responsibility. Preset channel collections should live in their own view so the main pages stay simple.

### Plan

- Add a new primary view beside Signal Matrix and Analysis Plot:
  - Suggested rail order: Signal Matrix, Analysis Plot, Channels, Compare.
  - Add a new `ViewMode`: `channels`.
- Channels view should not show the KPI cards at the top.
- Channels view should show preset collection tabs using the same simple segmented style as `Main` / `Groups`.
- Selecting a preset should show the relevant plots for that collection.
- Each preset should use fuzzy/pattern matching because ECUtek channel names vary between ROMs/logs.
- Missing channels should be handled cleanly:
  - Do not break the view.
  - Show available matched channels.
  - Optionally list missing suggested channels in a small secondary area.
- Presets should be editable later, but initial implementation can ship curated defaults.

### Draft Preset Collections

These are initial collections. Exact channel names should be matched using case-insensitive patterns and aliases.

#### General Tuning

- Engine Speed / RPM
- MAP / Manifold Absolute Pressure
- TPS / Throttle Angle
- Lambda / AFR
- Coolant Temperature
- Fuel Trim Short Term
- Fuel Trim Long Term
- Fuel Duty / Injector Duty
- Fuel Pressure
- Ignition Angle / Timing
- Battery Voltage

#### Idle

- Engine Speed / RPM
- MAP / Manifold Pressure
- Throttle Angle / TPS
- Accelerator Pedal
- Lambda / AFR
- Fuel Trim Short Term
- Fuel Trim Long Term
- Ignition Timing
- Coolant Temperature
- Intake Air Temperature
- Battery Voltage
- Idle Target / Idle Control channels if available

#### Boost

- Engine Speed / RPM
- Gear
- MAP / Manifold Absolute Pressure
- Boost Target
- Boost Bank 1
- Boost Bank 2
- Boost Error
- Wastegate Duty
- Wastegate Duty Base
- Wastegate Proportional
- Wastegate Integral
- Throttle Angle
- Atmospheric Pressure
- Intake Air Temperature

#### VVT

- Engine Speed / RPM
- Engine Load
- Intake Cam Angle / Target
- Exhaust Cam Angle / Target
- VVT Advance / Retard
- VVT Solenoid Duty
- Oil Pressure
- Oil Temperature
- Coolant Temperature

#### E-Throttle

- Accelerator Pedal Sensor
- Throttle Angle Bank 1
- Throttle Angle Bank 2
- Throttle Target / Desired Throttle
- Electronic Throttle Control channels
- Throttle Motor Duty
- Engine Speed / RPM
- MAP / Manifold Pressure
- Torque Request / Torque Limit if available

#### Temps

- Coolant Temperature
- Intake Air Temperature
- Oil Temperature
- Transmission Temperature
- Fuel Temperature
- Exhaust Gas Temperature / EGT
- Catalyst Temperature
- Ambient / Atmospheric Temperature if available

#### Wheel Speeds

- Vehicle Speed
- Wheel Speed Front Left
- Wheel Speed Front Right
- Wheel Speed Rear Left
- Wheel Speed Rear Right
- Gear
- Traction / Slip / ABS channels if available

#### GR6 Parameters

- Gear
- Transmission Temperature
- Clutch A/B Pressure
- Clutch A/B Slip
- Clutch A/B Speed
- Input Shaft Speed
- Output Shaft Speed
- Line Pressure
- Shift Status
- Solenoid Duty / Current
- Torque Request / Torque Reduction

#### Clutch Speeds

- Engine Speed / RPM
- Gear
- Clutch A Speed
- Clutch B Speed
- Input Shaft Speed
- Output Shaft Speed
- Clutch Slip

#### Clutch Temps

- Clutch A Temperature
- Clutch B Temperature
- Transmission Temperature
- Oil Temperature
- Gear
- Clutch Slip

#### All Temps

- Any channel matching `temp`, `temperature`, `coolant`, `IAT`, `EGT`, `cat`, `oil`, `trans`, `fuel temp`, `ambient`.

#### Ethanol / Flex Fuel

- Ethanol Content / FlexFuel Ethanol Content
- Fuel Pressure
- Fuel Temperature
- Lambda / AFR
- AFR Target
- Fuel Trim Short Term
- Fuel Trim Long Term
- Injector Duty / Fuel Duty
- Ignition Timing
- Boost / MAP if available

### Acceptance Criteria

- Channels view loads quickly and does not clutter Signal Matrix.
- Preset tabs are easy to scan.
- Missing channels are handled gracefully.
- KPI cards are not shown in Channels view.

## 4. Installer, Update Window, And Certificate Plan

### Problem

The installation/update experience should look like Octane, avoid GitHub-facing wording, and support a certificate workflow for machines that will install this software.

### Plan

- Replace generic update wording with Octane-branded copy:
  - `Checking Octane updates...`
  - `Downloading Octane update...`
  - `Ready to install`
  - No `GitHub Releases` wording in the GUI.
- Update the update modal design to match the dark Octane theme:
  - Version number.
  - Release date.
  - Download progress.
  - Signature/certificate status.
  - Clear install/restart buttons.
- Remove direct GitHub links from About/update UI.
- Add certificate validation status to the update/install flow:
  - Show whether the downloaded installer is signed.
  - Show signer name/subject.
  - Show whether the signer is trusted by Windows.
- For internal/self-owned certificate deployment:
  - Create a documented admin-only certificate install flow.
  - Install the internal root certificate into `LocalMachine\Root` and/or signing certificate into `LocalMachine\TrustedPublisher`, depending on certificate structure.
  - Prefer Group Policy/MDM for repeated shop/computer deployments.
  - Provide a manual script option only with clear admin prompts and visible confirmation.
- Ensure electron-builder signing is configured for the owned certificate:
  - `CSC_LINK`
  - `CSC_KEY_PASSWORD`
  - certificate subject/name validation
  - timestamp server
- Keep updater validation layered:
  - HTTPS transport.
  - Electron updater metadata.
  - Authenticode signature.
  - Optional checksum display.

### Acceptance Criteria

- Update UI looks like part of Octane.
- The app GUI does not link to GitHub.
- Installer/update flow communicates trust/signature state clearly.
- Internal certificate installation is explicit, admin-controlled, and documented.

## 5. Remove GitHub Links From GUI

### Problem

The app currently exposes an `Octane on GitHub` link and update wording references GitHub.

### Plan

- Remove `Octane on GitHub` from About modal.
- Remove `GITHUB_URL` usage from UI code.
- Replace update status text that mentions GitHub with neutral Octane wording.
- Keep repository/developer references out of the in-app GUI.
- README/developer files can still mention repository details if needed, but not the user-facing app.

### Acceptance Criteria

- No GitHub link/button appears in the app UI.
- No update status says `GitHub releases`.

## 6. Fix Native Menu Actions

### Problem

`File > Open log...` on the landing page does nothing. `Help > About Octane` also appears not to open the app modal reliably.

### Plan

- Audit Electron menu handlers in `electron/main.cjs`.
- Audit renderer hooks in `Dashboard`, `AppShell`, and landing/login states.
- Make `Open log...` work from any app state:
  - Logged in dashboard.
  - Landing page.
  - Empty/no-log state.
  - Possibly login state if app policy allows opening after login only.
- Use a single global renderer bridge/handler for menu-triggered file open:
  - If dashboard is mounted, load immediately.
  - If dashboard is not mounted, queue selected file payload until dashboard is ready.
- Make `Help > About Octane` global:
  - App shell owns the About modal state, or
  - Electron menu dispatches a renderer event handled at the top level.
- Add smoke tests/manual QA steps:
  - Start app fresh.
  - Use File > Open log before any upload.
  - Use Help > About Octane on landing/login/main screens.

### Acceptance Criteria

- `File > Open log...` opens a file picker and loads a log from every valid app state.
- `Help > About Octane` opens the About modal from every app state.
- No silent no-op menu items remain.

## 7. Channels View Should Hide KPI Cards

### Problem

The top KPI cards such as Max RPM / Max Boost are useful in Signal Matrix but should not appear in the new Channels view.

### Plan

- Update dashboard layout conditions:
  - Show KPI cards in Signal Matrix.
  - Show KPI cards in Analysis only if desired.
  - Hide KPI cards in Channels view.
  - Hide KPI cards in Compare unless specifically useful.

### Acceptance Criteria

- Channels view begins with preset tabs/content, not KPI cards.

## Suggested Implementation Phases

### Phase 1: Readability And No-Op Fixes

- Hide Analysis Y-axis values where ghost/pane readouts provide values.
- Remove GitHub GUI link/wording.
- Fix native `Open log...` and `About Octane` menu actions.

### Phase 2: Login Guide And Account Status

- Redesign login screen.
- Add guide/capabilities/shortcuts.
- Show saved account and quick logout.

### Phase 3: Channels View And Presets

- Add `channels` view mode and rail item.
- Build preset model and matcher.
- Render preset tabs and plots.
- Hide KPI cards in Channels view.

### Phase 4: Installer/Updater

- Redesign update modal.
- Add certificate/signature status.
- Document and script internal certificate install process.
- Configure production signing flow.

## Open Questions Before Implementation

- Should Channels view presets be read-only at first, or editable/savable immediately?
- Should Channels view use single stacked plots like Signal Matrix, or grouped pane layouts like Analysis Groups?
- Should the login guide be visible only before login, or also accessible later from Help?
- What certificate type will be used: self-signed internal root, internal CA-issued code signing cert, or commercial code signing cert?
- Should the app keep using GitHub releases behind the scenes while hiding GitHub from the GUI, or should updates move to a private/internal provider?
