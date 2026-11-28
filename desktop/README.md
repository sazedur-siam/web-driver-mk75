# MK75 Driver desktop app

The website in a small tray app (Electron), so live effects and music sync keep running with no browser open.
Same code as the website: `main.cjs` only serves `../dist` and adds what a browser tab can't do.

```bash
cd desktop
npm install
npm start          # builds the website, then opens the app
npm run smoke      # builds, loads the page hidden, prints a self-check and quits (exit 0 = OK)
npm run dist       # installer in release/ (Windows NSIS / macOS dmg, unsigned)
```

## What it adds over the website
- **Tray icon:** Open, **Start at login** (starts hidden), Quit. Closing the window hides it to the tray, so
  live effects keep running.
- **No background slow-down:** the window isn't throttled while hidden.
- **No device chooser:** MK75 access is granted automatically, and the app reconnects when the keyboard is
  plugged back in.
- **Music sync without the share dialog:** system audio is captured directly on Windows.

## Limits
- macOS: no system-audio capture yet (needs ScreenCaptureKit audio or a virtual audio device).
- A live effect doesn't restart by itself after login or after the keyboard is unplugged: open the window and
  start it again.
- With both the cable and the receiver plugged in, the first one found is used.
- Unsigned: Windows SmartScreen and macOS Gatekeeper warn on first launch.

Running from a VS Code extension host? It sets `ELECTRON_RUN_AS_NODE=1`, which turns Electron into plain Node;
unset it first.
