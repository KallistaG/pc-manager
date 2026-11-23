# Changelog

Each release must have a `## [x.y.z]` section. CI uses the section for the tagged version as the
"What's New" text on the Release page; without it, the release is not published.

## [1.2.1] - 2026-11-12

### Changed
- Release to test the in-app updater introduced in 1.2.0; no functional changes. Starting with 1.2.0,
  PC Manager notifies you when an update is available. Click "Update" in Settings to install it.

## [1.2.0] - 2026-11-12

### Added
- **In-app updates.** When a new version is available on GitHub Releases, a banner appears at the top
  of the window and an "Update" card appears in Settings (with release notes). Click "Update" to
  download the installer, **verify its signature** (the private key is only stored in a CI secret),
  approve the UAC prompt, and install. Updates are never installed automatically. Automatic checks
  run at most once a day when the window opens (you can turn them off in Settings); only one request
  is sent to github.com. Updating preserves the "Start with Windows" setting (previously, installing
  over an existing version removed its scheduled task).

### Security
- **Per-user apps (HKCU) are no longer uninstalled with administrator privileges.** When PC Manager
  is running as an administrator, their uninstallers now always run as the signed-in user with
  standard privileges, just like Windows Settings. Any standard-privilege program can modify an
  HKCU uninstall command, so running it as an administrator could enable privilege escalation. If
  an uninstaller requests administrator privileges, PC Manager reports the problem and explains how
  to uninstall it without elevation (Windows will show a UAC prompt); it will never fall back to its
  own administrator token.

### Fixed
- Automatic cleanup no longer replaces the scan results currently open on the Junk Cleaner page
  (previously, clicking Clean afterward would report that the scan result had expired).
- **Manual and automatic Smart Boost now use light Boost** instead of Deep Boost. When RAM is low,
  clearing the entire standby cache does not increase available RAM (Windows already reclaims that
  cache as apps need it); it only causes more disk reads. The real benefit comes from flushing
  modified data to disk. The Smart Boost card description has been corrected. Measurements on a
  real PC (three runs): light Boost increased available RAM by 4–215 MB while clearing only
  57–585 MB of cache; Deep Boost increased it by just 54–93 MB while clearing 3.8–4.4 GB of cache.
- Diagnosis now recommends opening Processes to close memory-heavy apps when RAM is below 10%
  (Boost helps only a little); the description for 10–20% RAM usage now accurately describes Boost.
- The first automatic-cleanup schedule check now runs about two minutes after PC Manager opens
  (previously it waited 30 minutes, so short PC sessions never got cleaned up).

### Changed
- **Long-running tasks now report progress and can resume** after the window is closed to the tray
  and reopened: moving files to the Recycle Bin on the Disks page (with a Stop button), cleaning app
  leftovers, and loading the app list.
- The Junk Cleaner progress bar now tracks files cleaned instead of appearing idle while processing
  a rule that contains tens of thousands of files.
- Large-file and duplicate scans now enforce minimum file sizes in the backend (1 MB / 64 KB) to
  avoid keeping excessively large file lists in memory.
- **The Startup page now lists Microsoft Store apps** that launch at sign-in (Teams, Terminal, Xbox,
  and others; read-only, like Task Manager's Startup tab). Services now display their proper names
  instead of registry value names such as `@dll,-123`; `.lnk` extensions are now removed correctly
  regardless of letter case. Store apps have an "Open Task Manager" button that opens the Startup
  tab to enable or disable them (the Settings → Apps → Startup page crashes on some Windows 11
  versions).
- **The Apps page now lists Microsoft Store apps** (read from the registry and manifests without
  loading WinRT or increasing idle memory use). The "Uninstall in Settings" button opens Windows
  Settings → Apps.
- Junk Cleaner adds browser caches for Brave, Vivaldi, Coc Coc, and Opera / Opera GX. Chrome and Edge
  now include `Service Worker\\CacheStorage`, `ShaderCache`, and `GrShaderCache`; Firefox now includes
  `startupCache`. Website data (IndexedDB and Local Storage) is not touched.
- The description for "Downloaded Windows updates" is more accurate (it includes updates waiting to
  be installed, which Windows will download again) and the rule is no longer selected by default.
- Diagnosis recommends enabling XMP/EXPO only for desktop PCs with DIMM memory, no longer
  incorrectly suggesting it on laptops.
- When you lack privileges to enable or disable a system-wide startup entry, the notice now includes
  a "Run as administrator" button and no longer depends on the Windows display language.
- The Smart Boost threshold slider now saves (and logs) only when its value actually changes.
- The Processes and Startup pages now use the shared page layout. Hand-coded SVG icons replace
  emoji and font-dependent symbols (🔒 🛡 ✓ ↻ ▸▾ ⚠), so they look consistent across PCs.

### Performance
- RAM statistics are queried only while Overview or Memory is open (previously, every two seconds
  on every page); hidden pages no longer redraw the chart. In a dev build, Settings made zero
  `memory_status` calls over 6.5 seconds (previously about three).
- The Processes table now redraws only rows whose data changed (previously, all 300+ rows were
  rebuilt every two seconds).
- The "last used" sampler now writes to SQLite much less often: newly seen executables are recorded
  immediately, and running executables are refreshed at most once every 15 minutes (previously,
  150–300 writes per minute).
- Junk scans now check the blocked-path list once per directory and lowercase filename patterns
  once when loading a rule; the safety recheck before deletion still runs for every file.
- Opening Settings no longer launches `schtasks.exe`; startup status is read through COM.
- The database no longer grows indefinitely: it keeps the newest 5,000 activity-log entries and
  removes "last used" samples for executables not seen for over a year.

### Internal
- Release builds now produce only an `rlib` for the library (no mobile-only `staticlib` or `cdylib`):
  rebuilding the release crate dropped from about 194 to 160 seconds (about 17% faster, measured
  twice with dependencies already built).
- `scripts/admin-test.ps1` now works when elevated with a different administrator account (it passes
  the signed-in user's `CARGO_HOME` / `RUSTUP_HOME`); tests that depend on environment variables now
  use the signed-in user's `%TEMP%` and other user-specific values.
- Consolidated repeated code (`commands::blocking`, `now_ms`, `expand_env`, `run_elevated`); trimmed
  the `rust-skills` guidance for this project (265 → 129 rules); shortened `CLAUDE.md` (API details
  are in `docs/FEATURES.md`, measurement baselines in `docs/PERF.md`); added `AGENTS.md`; moved
  `PROMPTS.md` to `docs/history/`; removed the Japanese and Chinese READMEs.

## [1.1.3] - 2026-11-12

### Fixed
- **Automatic cleanup no longer skips an entire scheduled run** when it becomes due while you are
  scanning or cleaning manually on the Junk Cleaner page. Previously it would wait another 1, 7, or
  30 days; now PC Manager retries after 30 minutes.
- Cleaning `Windows.old` no longer rescans the entire directory tree (which can contain tens of GB)
  just to confirm it was removed; the result appears immediately.
- The error shown when opening an uninstaller fails now correctly describes the action ("opening the
  uninstaller").

### Changed
- Process enumeration is lighter: it no longer copies 0.5–1 MB of data on every refresh (every two
  seconds on the Processes page and every 60 seconds in the background).
- Junk scans are faster for "all files" rules (no temporary per-file data is created).
- "Open file location" on the Processes page now always opens the correct absolute path to
  Windows `explorer.exe`, even when PC Manager is running as an administrator.
- Internal cleanup based on the full-project review of 2026-11-11 (no behavior changes). Next
  improvement plan: `docs/PLAN.md`.

## [1.1.2] - 2026-11-11

### Fixed
- **Diagnosis no longer recommends cleaning the WinSxS store when cleanup cannot free any space.**
  Deep scans previously followed DISM's "recommended" message, which can continue to say Yes even
  when clicking Clean WinSxS frees 0 bytes. PC Manager now remembers analysis and cleanup results
  and evaluates them itself:
  - If cleanup frees nothing, the remaining packages are being retained by Windows; no further
    recommendation is shown until a new Windows update is available (or 30 days have passed).
  - If cleanup has already run since the latest restart, the remaining components can only be
    cleaned after restarting the PC.
  - **If Windows is waiting for a restart to finish an update,** WinSxS cleanup is not recommended
    (DISM can remove almost nothing at this point); only a restart is recommended. A cleanup attempt
    made while a restart is pending is not counted as "futile"; after restarting, cleanup can be
    recommended again if needed.
- Junk Cleaner → System Deep Clean → **Analyze** now gives a clear result ("Cleanup recommended",
  "No cleanup needed", or "Restart first") with an explanation. The message after a cleanup that
  frees 0 bytes now explains the reason.

### Changed
- The Diagnosis page now shows a "Deep scan requires administrator privileges" notice with a
  **Run as administrator** button when PC Manager is running without elevation, just like other
  pages; it reopens directly to Diagnosis.

## [1.1.1] - 2026-11-11

### Changed
- **All pages now use the new shared UI:** Memory, Junk Cleaner, Processes, Startup, Apps, Disks, and
  Settings match Overview, System Info, and Diagnosis — rounded tables with fine borders, sticky
  table headers with solid backgrounds, consistent search and select fields, pill-shaped filter
  buttons, and updated confirmation dialogs. The Junk Cleaner progress bar now matches the other
  pages.
- Automated layout checks passed at four window sizes (from the 860×560 minimum to 1920×1080), on
  every page and in both dark and light themes: no horizontal scrolling, overflow, overlapping
  buttons, or clipped text.

## [1.1.0] - 2026-11-11

### Added
- **New dark theme** (default): dark background with blue highlights, rounded cards, a sidebar with
  icons, and an arc-shaped RAM gauge on Overview. Choose Dark, Light, or Follow Windows in Settings
  → Appearance. No blur or animation is used, so the app stays lightweight.
- **System Info page:** Windows edition, build, install date and uptime; CPU (cores/threads and
  frequency); GPU (VRAM and driver); motherboard and BIOS; RAM (installed/total slots, each module's
  capacity, DDR4/DDR5 type, current and rated speeds, manufacturer and part number); and disks
  (model, capacity, NVMe/SATA/USB, SSD/HDD). Click **Copy system info** to share the configuration.
  No administrator privileges are required, and no serial numbers or machine name are collected.
  "Last power-on" reports the actual latest power-on time (including with Fast Startup enabled),
  not the time since the last restart.
- **Smart Diagnosis** (Diagnosis page or the Overview button): one scan checks RAM, drives, junk,
  Recycle Bin, startup apps, unused apps, Windows status (pending restart, time since restart,
  `Windows.old`), and hardware (XMP/EXPO, hard drives, free RAM slots). Each category has a status
  (Good / Suggestion / Needs attention / Recommended action); each finding explains why with
  supporting numbers and a button that opens the relevant page for review and confirmation. Boost
  runs only after confirmation. Rescan to see **what improved** (before-and-after numbers). Quick
  scan is read-only and takes under one second; Deep scan also analyzes WinSxS (about one minute,
  requires administrator privileges).

### Changed
- Settings cards in the same row now have equal heights.

## [1.0.4] - 2026-11-11

### Added
- **Progress bars for long-running tasks:**
  - WinSxS analysis (previously showed only a spinner).
  - `Windows.old` cleanup — estimated progress based on recovered disk space (Disk Cleanup does not
    report progress).
  - Large-file and duplicate scans — when scanning a whole drive, traversal progress is estimated
    from used space; duplicate scanning now clearly shows "Step 1/3, 2/3, 3/3".
  - Loading the Apps list — "x / y apps" with a percentage.

### Changed
- **Per-user apps can now be uninstalled while elevated with a different administrator account**
  (previously blocked). The uninstaller runs as the signed-in Windows user (as it does from Windows
  Settings), so it uses the correct profile. "Clean leftovers" still opens afterward.
- **Machine-wide apps can now be uninstalled while PC Manager runs without elevation:** uninstallers
  that require administrator privileges are launched through a UAC prompt (as in Windows Settings)
  instead of returning the confusing "requires elevation" error (code 740). Selecting No in UAC
  clearly reports that nothing was uninstalled.
- After WinSxS cleanup, the result is shown and the old analysis is hidden; the "Analyze again"
  button has been removed (click "Analyze" when you want to review the store).
- When DISM reports success but recovers no space, the message now says there is "nothing more to
  clean" instead of "Finished in 1 second — no increase in free space detected."

### Fixed
- Result and error notices on Apps, Junk Cleaner, System Deep Clean, Disks, Processes, and Startup
  can now be dismissed with × instead of remaining indefinitely.
- When an app's uninstaller is missing (often because the app was uninstalled but its list entry
  remains), the message now explains the situation and directs you to "Clean leftovers" instead of
  showing the confusing "Not found: not found …" message.
- Startup tab counts now match the visible entries. Previously, counts included hidden Microsoft
  entries; the "Hide Microsoft entries" checkbox now reports how many entries are hidden. The
  "Refresh" button moved next to search so it no longer wraps when the checkbox changes the row
  width.
- On the Apps page, the sort control moved next to "Refresh" so it no longer wraps when choosing
  the "Unused > …" filter (which reveals an "Include apps with unknown last-used date" option).

## [1.0.3] - 2026-11-11

### Added
- **Switching tabs no longer loses state.** If you start a scan or cleanup on one tab and switch to
  another, you still see the progress, results, and selected items when you return. Each tab
  remembers its own scroll position.
- **Running-task indicators in the sidebar:** a spinner appears beside each page that still has a
  task in progress (scanning or cleaning junk, cleaning WinSxS or `Windows.old`, scanning a drive,
  uninstalling an app, cleaning leftovers, or running Boost).
- **Closing the window to the system tray no longer loses running tasks.** Long-running tasks
  continue in the background; reopening the window restores their progress or shows their result if
  they finished while the window was closed. This applies to junk scans and cleanup, WinSxS
  analysis and cleanup, `Windows.old` cleanup, and large-file and duplicate scans.

### Changed
- **WinSxS is no longer analyzed automatically after cleanup** (previously this took about another
  minute). The old analysis is hidden because it is no longer current; click "Analyze again to see
  the store after cleanup" if you want an updated result. The cleanup result stays visible.
- Hidden tabs (Processes and Startup) no longer refresh in the background, reducing CPU use; they
  refresh immediately when you return.

### Fixed
- The Apps tab no longer shows a running-task indicator when no task is active.
- A confirmation dialog on a hidden tab can no longer be dismissed by pressing Esc on another tab.

## [1.0.2] - 2026-11-11

### Fixed
- **The UI now opens when elevated with a different administrator account** (for example, on a work
  or domain PC where the UAC dialog asks for another account's credentials). The "Microsoft Edge
  can't read and write to its data directory" error is fixed.

### Changed
- When elevated with a different administrator account, that account is used only to obtain
  privileges; all personal data stays with the **signed-in Windows user**:
  - settings, activity history, and app logs;
  - Junk Cleaner data (Temp, browser caches, thumbnails…) and protected folders (the administrator's
    entire profile is protected);
  - Recycle Bin operations (emptying it and moving large/duplicate files and leftovers into it, so
    they can be restored from your own Recycle Bin);
  - Startup entries (Run and Startup folders), installed apps (per-user apps, last-used dates,
    leftover cleanup, and `.reg` backups);
  - Start with Windows: the task runs when you sign in.
- Uninstalling a per-user app is blocked when elevated with another account because the uninstaller
  would target the wrong profile. Reopen PC Manager normally to uninstall it.
- WebView2 diagnostics are written to `%APPDATA%\\com.pcmanager.app\\logs\\webview.log`.
