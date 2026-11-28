# 02: Load tabs on demand (and precache them for offline)

| Group | Priority | Effort | Needs hardware? |
|---|---|---|---|
| Performance / app shell | High | M | No |

Branch: `perf/lazy-tabs`

## Goal

Ship a smaller first download by loading each tab, the Guide and the dialogs only when they're opened, **without
breaking offline use or the update notice**.

## Why

`npm run build` produces one 406 KB JavaScript file (135 KB gzip). A build with one chunk per module (measured
2026-11-28) shows where it goes:

| Part | Size (minified) | Needed on first load? |
|---|---|---|
| React + ReactDOM + scheduler | 138 KB | Yes |
| Guide: `marked` 35 KB, `README.md` 13.5 KB, `MANUAL.md` 11.3 KB, GuideView/guide.ts | 63 KB | No, only when the Guide opens |
| Tabs and their helpers (Live, Key mapping, Macros, Profiles, Device, Side lights + probe, Per-key + Image to keys, Effect designer, dialogs…) | ~114 KB | Only the open tab |
| Simulators (`mock.ts`, `mockWireless.ts`) | 6 KB | No (hidden in production) |
| App shell, protocol, keyboard drawing, stores | ~90 KB | Yes |

Expected first load after this change: **about 240 KB instead of 412 KB (about 40% less)**, more on the start
screen before connecting. Measure it before and after; don't promise a number in docs.

## What exists today

- [src/App.tsx](../src/App.tsx) imports all ten tabs, `GuideView`, `ReportDialog` and `ContributeDialog` statically and
  renders `{tab === 'X' && <XTab api={api} />}`. The open tab is remembered in `localStorage` (`mk75.tab`), so the
  first tab rendered can be any of them.
- [src/ui/GuideView.tsx](../src/ui/GuideView.tsx) imports `MANUAL.md?raw` and `README.md?raw`; `guide.ts` imports `marked`.
- `layouts.ts` and `KeymapTab.tsx` import `vkToHid` from `mock.ts`, and `useDevice.ts` imports `MockMk75` and
  `MockWirelessIO` statically. Together they keep both simulators in the production bundle.
- [public/sw.js](../public/sw.js) (`CACHE = 'mk75-v2'`): pages network-first; `assets/` **cache-first, but only after
  the first fetch**. Nothing under `assets/` is precached.
- [src/ui/pwa.ts](../src/ui/pwa.ts) shows "update ready" only when a **new service worker** is installed.

### Two problems this plan must solve (found while planning)

1. **Offline would break.** With lazy chunks, a tab never opened while online isn't in the cache, so it fails to load
   offline. The service worker has to precache every build asset.
2. **The update notice almost never fires today.** `sw.js` is a static file that only changes when someone bumps
   `CACHE`, so the browser sees no new service worker after a normal deploy. (Users still get new code on reload,
   because pages are network-first.) Injecting the build's asset list into `sw.js` changes it on every deploy, which
   fixes this as a side effect. Mention it in the PR, because the README already claims the notice works.

A third, smaller one: after a deploy, a tab left open still runs the old build. If it lazily imports a chunk that
the new deploy no longer serves, the import fails. Vercel serves only the current deployment's assets on the
production domain.

## Design

### 1. Lazy components

In `App.tsx`:

```tsx
const LiveTab = lazy(() => import('./ui/LiveTab').then((m) => ({ default: m.LiveTab })));
// …same for every tab, GuideView, ReportDialog, ContributeDialog
```

- All ten tabs lazy, including Lighting: the remembered tab can be any of them, so there's no special first tab.
- `Keyboard`, `BatteryIcon`, `SharedPresetBanner`, `useDevice`, `pwa` and the protocol stay in the main chunk.
- Wrap `<main>` content in `<Suspense fallback={<TabLoading />}>`. `TabLoading` is a card with the tab's name and
  a fixed min-height, so the page doesn't jump. No spinner flash on fast loads: show the text only after 150 ms.
- `ImageToKeys` (inside Per-key) and `SideLightProbePanel` (inside ContributeDialog) come along with their parents'
  chunks automatically. Split them further only if the numbers justify it.

### 2. Prefetch after connect

After the device connects and the first tab has rendered, prefetch the other tab chunks during idle time
(`requestIdleCallback`, falling back to `setTimeout(…, 2000)`), so switching tabs is instant. Don't prefetch the
Guide; it's the largest piece and rarely used.

### 3. Simulators out of production

- Move the VK → HID table (`vkToHid` and its data) from `mock.ts` to a new `src/protocol/vk.ts`. Point `layouts.ts`
  and `KeymapTab.tsx` at it, and re-export it from `mock.ts` so the tests don't change.
- In `useDevice.ts` `connectDemo`, load the simulators with `await import('../protocol/mock')` /
  `import('../protocol/wireless/mockWireless')` inside an `import.meta.env.DEV` branch, so production builds drop them.

### 4. Precache every asset, versioned per build

Add a small Vite plugin in `vite.config.ts` (about 20 lines, no new dependency):

- In `generateBundle`, collect the file names of all emitted JS and CSS chunks (`assets/*`).
- In `writeBundle`, rewrite `dist/sw.js`, replacing two placeholders in `public/sw.js`:
  - `self.__BUILD__` → a short hash of the asset list (changes on every deploy that changes code)
  - `self.__ASSETS__` → the JSON list of asset paths
- Keep the placeholders valid JavaScript (`const BUILD = 'dev'; const ASSETS = [];`), so `npm run dev` and the
  unprocessed file still parse.

In `sw.js`:

- `CACHE = 'mk75-' + BUILD` (replaces the hand-bumped `mk75-v2`; update CLAUDE.md §8 and the `public/` line in §6).
- `install`: `cache.addAll([...SHELL, ...ASSETS])`. If one asset fails, installation fails and the old worker keeps
  serving, which is the safe outcome.
- `activate`: delete every cache that isn't the current `CACHE` (already done). This runs only after the user
  accepts the update notice or closes every tab, and every open tab reloads on `controllerchange`, so no page is
  left needing deleted chunks.
- Fetch handling stays as it is: assets are cache-first, now with everything already cached.
- Manual screenshots (`manual/*.webp`) stay runtime-cached. They're larger and only the Guide uses them.

### 5. Recover from a failed chunk load

- Listen for Vite's `vite:preloadError` event on `window` (Vite ≥ 4.4) and for `import()` rejections inside an error
  boundary around `<Suspense>`.
- On failure: reload once, guarded by a `sessionStorage` flag (`mk75.chunkReload`), so a real network outage doesn't
  cause a reload loop.
- If it already reloaded once: show a card saying "This part of the app couldn't load. Check your connection and
  reload", with a **Reload** button. Never show a blank page.
- A live stream or unsaved edits don't survive the reload. This only happens on a stale tab after a deploy, and the
  update notice normally gets there first.

### 6. Desktop app

`desktop/main.cjs` serves `../dist` on `app://mk75` with `protocol.handle('app', …)`, mapping any path to a file in
`dist/`, so lazy chunks load with no change. The scheme is registered with `serviceWorkers: true`, so the service
worker may run there too. The per-build cache name keeps it from serving an old build after the desktop app's
`dist/` is updated. Run `npm run smoke` in `desktop/` and open each tab in the desktop window.

## Steps

1. Record the baseline: `npm run build` sizes and Chrome DevTools "transferred" on first load (cold cache), on the
   start screen and on a connected Lighting tab.
2. `vk.ts` split and dev-only simulator imports.
3. Lazy tabs, Guide and dialogs, plus `TabLoading` and the idle prefetch.
4. Vite plugin + `sw.js` precache and per-build cache name.
5. Chunk-error handling.
6. Re-measure; put before/after numbers in the PR description.
7. Docs: CLAUDE.md §6 (`public/` line), §8 (cache-bump rule: "the cache name now changes on every build;
   edit the SW only when the strategy changes"), §9 if anything new is learned.

## Tests

**Unit (vitest):**
- The plugin's pure helper (asset list in → placeholder replacement out): replaces both placeholders, escapes paths,
  is stable for the same input and changes when an asset name changes.
- `guide.test.ts` and the other existing tests pass unchanged (the `vk.ts` re-export keeps imports working).

**Browser (`npm run build && npm run preview`, Chrome):**
- First load: the network panel shows the main chunk plus only the current tab's chunk.
- Every tab opens, and so do the Guide, Report an Issue and Contribute device data.
- Offline: load once online, wait for the service worker to activate, then switch DevTools to **Offline** and reload.
  Every tab and the Guide still open (screenshots may be missing; that's expected).
- Update: build again with a code change, serve it, and the open tab shows the update notice; accepting reloads
  into the new build.
- Stale chunk: with an old build open, delete a chunk from `dist/assets/` and open a tab that needs it → one
  automatic reload, then the fallback card if it still fails.
- Dev: `npm run dev` simulators still work; `window.__mk75.dev` is still set.
- Production: no `mock`/`mockWireless` code in `dist/assets` (`grep -l MockMk75 dist/assets/*.js` finds nothing).

**Desktop:** `npm run smoke` in `desktop/` passes.

## Risks

| Risk | Mitigation |
|---|---|
| Offline breaks for unvisited tabs | Precache every asset at install, plus the offline browser check above. |
| Reload loop after a deploy | One reload per session, then a manual fallback card. |
| A placeholder isn't replaced (plugin skipped) | The placeholders are valid defaults; add a build-time assertion in the plugin that `dist/sw.js` no longer contains them. |
| Loading flicker on each tab switch | Idle prefetch after connect; delayed fallback text. |
| Install fails on a flaky network because one of ~30 files fails | That keeps the old worker, which still works. The next visit retries. |

## Done when

- Initial JS on a cold load is measured and noticeably smaller (target: at least 35% less than 406 KB).
- All tabs, the Guide and the dialogs work online and offline after one online visit.
- A deploy triggers the update notice in an open tab.
- Tests, build and the desktop smoke check pass.
- This file and its row in `features/README.md` are deleted when it ships.
