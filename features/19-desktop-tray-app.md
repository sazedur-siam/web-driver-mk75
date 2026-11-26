# 19 · Desktop tray app (always-on live effects & music)

**Priority:** P2 · **Effort:** M · **Depends on:** shared codebase · **Status:** first version built (`desktop/`)

## Built (first version)
- `desktop/main.cjs` (Electron 45): `dist/` on `app://mk75`, tray (Open / Start at login / Quit), close-to-tray,
  single instance, `backgroundThrottling: false`, HID permission + automatic device pick, `getDisplayMedia` answered
  with the main screen + Windows audio loopback. `npm run smoke` and a packaged `--dir` build pass on macOS.
- Web app: reconnects when an allowed MK75 is plugged in (browser too).

## Still to do
1. Resume the last live effect after login and after unplug/replug (persist the Live tab settings, auto-start in
   the desktop app).
2. Tray menu controls: effect on/off, pick mode.
3. macOS system audio (ScreenCaptureKit loopback or a virtual device).
4. Signed installers and a GitHub release; a download link in README/MANUAL.
5. Hardware run of "Done when" below on Windows.

## What it is
A small Electron app that lives in the system tray, starts with Windows/macOS, and keeps live effects and music
sync running with no browser open, like the official LINGBAO app.

## Why
Live effects are computed on the computer (the keyboard can't run them), so a browser tab must stay open. A tray app
removes that limit and can capture **system audio directly** (no share dialog) for music mode.

## Scope
- In: tray icon + menu (effect on/off, pick mode, open settings window), autostart, the same web UI in a window,
  system-audio loopback for music, reconnect on keyboard plug/unplug/wake.
- Out: replacing the website — both share one codebase.

## Technical plan
- Electron (Chromium, so WebHID works via `session.setDevicePermissionHandler` / `select-hid-device`).
- Load the built web app (`dist/`) in a BrowserWindow; tray actions call into the page via `ipc`.
- System audio: `desktopCapturer` + `getUserMedia({ audio: { mandatory: { chromeMediaSource: 'desktop' } } })`
  (Windows loopback; macOS needs a virtual audio device or ScreenCaptureKit audio on 13+).
- Keep the live loop in a hidden window that isn't throttled (`backgroundThrottling: false`).
- Packaging: electron-builder (Windows NSIS, macOS dmg); code signing later.
- Folder: `desktop/` in the repo with its own package.json; build pulls `../dist`.

## Risks / open questions
- Size (~100 MB). Acceptable for a driver; Tauri would be smaller but its WebView can't be relied on for WebHID.
- Unsigned apps trigger SmartScreen/Gatekeeper warnings until signed.

## Done when
- Installed app starts at login, runs a live effect for an hour with no browser, music mode follows system audio,
  and survives keyboard unplug/replug.
