/**
 * Parts of the app loaded on demand: every tab, the Guide (marked + README + MANUAL) and the dialogs.
 * The first download carries only the shell (React, header, keyboard drawing, protocol); the service worker
 * precaches every chunk, so tabs still open offline (public/sw.js).
 */
import { Component, lazy, useEffect, useState, type ComponentType, type ReactNode } from 'react';

type Loader = () => Promise<unknown>;
const loaders: Loader[] = [];

/** React.lazy for a named export (props stay typed), remembered so prefetchParts() can warm it. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the constraint only says "some component"
function part<M extends Record<K, ComponentType<any>>, K extends keyof M>(load: () => Promise<M>, name: K, prefetch = true) {
  const get = () =>
    load().then((m) => {
      // When installChunkReload() handles a failed load, Vite resolves the import to undefined while the page reloads.
      if (!m) throw new Error(`Failed to fetch dynamically imported module (${String(name)})`);
      return { default: m[name] };
    });
  if (prefetch) loaders.push(get);
  return lazy(get);
}

export const ProfilesTab = part(() => import('./ProfilesTab'), 'ProfilesTab');
export const LightingTab = part(() => import('./LightingTab'), 'LightingTab');
export const PerKeyTab = part(() => import('./PerKeyTab'), 'PerKeyTab');
export const SideLightsTab = part(() => import('./SideLightsTab'), 'SideLightsTab');
export const LiveTab = part(() => import('./LiveTab'), 'LiveTab');
export const KeymapTab = part(() => import('./KeymapTab'), 'KeymapTab');
export const MacrosTab = part(() => import('./MacrosTab'), 'MacrosTab');
export const TesterTab = part(() => import('./TesterTab'), 'TesterTab');
export const DeviceTab = part(() => import('./DeviceTab'), 'DeviceTab');
export const BackupTab = part(() => import('./BackupTab'), 'BackupTab');
export const ReportDialog = part(() => import('./ReportDialog'), 'ReportDialog');
export const ContributeDialog = part(() => import('./ContributeDialog'), 'ContributeDialog');
/** The Guide is the largest part (marked + both documents) and rarely opened: never prefetched. */
export const GuideView = part(() => import('./GuideView'), 'GuideView', false);

/** Load the other tabs and dialogs while the browser is idle, so switching tabs doesn't wait. Failures are ignored. */
export function prefetchParts() {
  const run = () => loaders.forEach((l) => void l().catch(() => undefined));
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
  if (w.requestIdleCallback) w.requestIdleCallback(run, { timeout: 5000 });
  else setTimeout(run, 2000);
}

/** Placeholder while a part loads. Shows text only after 150 ms, so fast loads don't flash. */
export function PartLoading({ label }: { label: string }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShow(true), 150);
    return () => clearTimeout(t);
  }, []);
  return (
    <section className="card part-loading" aria-busy="true">
      {show && <p className="muted">Loading {label}…</p>}
    </section>
  );
}

const RELOAD_KEY = 'mk75.chunkReload';

/**
 * A chunk failed to load (usually a tab left open across a deploy: the old build's files are gone).
 * Reload once per session to pick up the new build; returns false if that was already tried.
 */
export function reloadOnceForNewBuild(storage: Pick<Storage, 'getItem' | 'setItem'> | null = safeSession(), reload = () => location.reload()): boolean {
  if (!storage) return false; // without storage we can't tell a loop from a first try: don't reload
  try {
    if (storage.getItem(RELOAD_KEY)) return false;
    storage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    return false; // without storage we can't tell a loop from a first try: don't reload
  }
  reload();
  return true;
}

function safeSession(): Storage | null {
  try {
    return sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Vite fires `vite:preloadError` when a lazily imported chunk (or its CSS) fails to load. Once the page has run
 * for 10 s it loaded fine, so the once-per-session guard is cleared for a later deploy (a reload loop is faster).
 */
export function installChunkReload() {
  window.addEventListener('vite:preloadError', (e) => {
    if (reloadOnceForNewBuild()) e.preventDefault();
  });
  setTimeout(() => {
    try {
      sessionStorage.removeItem(RELOAD_KEY);
    } catch {
      /* storage unavailable */
    }
  }, 10_000);
}

/** Catches a part that failed to load and offers a reload instead of a blank page. */
export class PartBoundary extends Component<{ children: ReactNode; resetKey?: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // Only module-loading failures reload on their own; anything else is a real bug and stays visible.
    if (/dynamically imported module|Importing a module script failed|error loading dynamically imported/i.test(msg)) reloadOnceForNewBuild();
  }
  componentDidUpdate(prev: { resetKey?: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.failed) this.setState({ failed: false });
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <section className="card" role="alert">
        <h2>This part of the app couldn't load</h2>
        <p className="muted">Check your connection, then reload the page. Your keyboard settings aren't affected.</p>
        <button className="primary" onClick={() => location.reload()}>
          Reload
        </button>
      </section>
    );
  }
}
