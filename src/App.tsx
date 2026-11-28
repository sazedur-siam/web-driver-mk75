import { Suspense, useEffect, useRef, useState } from 'react';
import { WebHidTransport } from './protocol/transport';
import {
  BackupTab,
  ContributeDialog,
  DeviceTab,
  GuideView,
  KeymapTab,
  LightingTab,
  LiveTab,
  MacrosTab,
  PartBoundary,
  PartLoading,
  PerKeyTab,
  prefetchParts,
  ProfilesTab,
  ReportDialog,
  SideLightsTab,
  TesterTab,
} from './ui/lazyParts';
import { Keyboard } from './ui/Keyboard';
import { usePwa } from './ui/pwa';
import { loadPresetFromHash } from './ui/presetStore';
import { SharedPresetBanner } from './ui/SharedPresetBanner';
import { readSession, useDevice } from './ui/useDevice';
import { useBattery } from './ui/battery';
import { BatteryIcon } from './ui/BatteryIcon';
import { GameModeToggle } from './ui/GameModeToggle';
import { SideNav, TABS, type Tab } from './ui/SideNav';

/** One theme per official MK75 colourway (product page): case / keycap colours for the swatch. */
const THEMES = [
  { id: 'green-orange', name: 'Dark green-orange', swatch: 'conic-gradient(#a9c4ba 0 50%, #cf8a4a 0 75%, #121513 0)' },
  { id: 'milk-tea', name: 'Iced milk tea', swatch: 'conic-gradient(#fbf6ee 0 50%, #c8a07a 0 75%, #e6d5bf 0)' },
  { id: 'arthur', name: 'Arthur', swatch: 'conic-gradient(#1d1f25 0 50%, #5b8cff 0 75%, #b36bff 0)' },
  { id: 'summer', name: 'Summer Wilderness', swatch: 'conic-gradient(#f6f9fa 0 50%, #b8d4de 0 75%, #7fb0c0 0)' },
] as const;
type Theme = (typeof THEMES)[number]['id'];
const THEME_KEY = 'mk75.theme';

function readTheme(): Theme {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === 'light') return 'milk-tea'; // earlier "Cream" theme
    return THEMES.some((t) => t.id === v) ? (v as Theme) : 'green-orange';
  } catch {
    return 'green-orange';
  }
}

function ThemeSwitch() {
  const [theme, setTheme] = useState<Theme>(readTheme);
  // First visit = nothing saved yet; read before the effect below saves the default.
  const [ask, setAsk] = useState(() => {
    try {
      return localStorage.getItem(THEME_KEY) === null;
    } catch {
      return false;
    }
  });
  useEffect(() => {
    if (!ask) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setAsk(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ask]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* storage unavailable */
    }
  }, [theme]);
  return (
    <>
      <div className="theme-switch" role="radiogroup" aria-label="MK75 colourway">
        {THEMES.map((t) => (
          <button key={t.id} role="radio" aria-checked={theme === t.id} className={theme === t.id ? 'on' : ''} onClick={() => setTheme(t.id)} title={t.name}>
            <span className="theme-dot" style={{ background: t.swatch }} aria-hidden />
            <span className="theme-name">{t.name}</span>
          </button>
        ))}
      </div>
      {ask && (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setAsk(false)}>
          <div className="modal card theme-pick" role="dialog" aria-modal="true" aria-labelledby="theme-pick-title">
            <header className="card-h">
              <h2 id="theme-pick-title">Which MK75 colourway do you have?</h2>
            </header>
            <p className="muted">The site will match your keyboard. You can change it any time from the top bar.</p>
            <div className="theme-pick-grid">
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  className={theme === t.id ? 'on' : ''}
                  onClick={() => {
                    setTheme(t.id);
                    setAsk(false);
                  }}
                  autoFocus={theme === t.id}
                >
                  <span className="theme-dot" style={{ background: t.swatch }} aria-hidden />
                  {t.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const TAB_KEY = 'mk75.tab';
const GUIDE_KEY = 'mk75.guideOpen';

/** Tiny storage helpers: storage can throw (private windows, blocked site data), so fall back silently. */
function load(store: () => Storage, key: string): string | null {
  try {
    return store().getItem(key);
  } catch {
    return null;
  }
}
function save(store: () => Storage, key: string, value: string | null) {
  try {
    if (value === null) store().removeItem(key);
    else store().setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}
const local = () => localStorage;
const session = () => sessionStorage;

function readTab(): Tab {
  const v = load(local, TAB_KEY);
  return TABS.includes(v as Tab) ? (v as Tab) : 'Lighting';
}

/** Reopen the device after a page refresh only once, even under StrictMode's double effects. */
let resumeTried = false;

export default function App() {
  const api = useDevice();
  const battery = useBattery(api.dev);
  const [tab, setTab] = useState<Tab>(readTab);
  const [testerOnly, setTesterOnly] = useState(false);
  const [guideOpen, setGuideOpen] = useState(() => load(session, GUIDE_KEY) === '1');
  useEffect(() => save(local, TAB_KEY, tab), [tab]);
  useEffect(() => save(session, GUIDE_KEY, guideOpen ? '1' : null), [guideOpen]);
  const [reportOpen, setReportOpen] = useState(false);
  const [contributeOpen, setContributeOpen] = useState(false);
  useEffect(() => {
    const open = () => setReportOpen(true);
    window.addEventListener('mk75:report', open);
    return () => window.removeEventListener('mk75:report', open);
  }, []);
  const pwa = usePwa();
  useEffect(() => {
    void loadPresetFromHash();
    const onHash = () => void loadPresetFromHash();
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const [canReconnect, setCanReconnect] = useState(false);
  useEffect(() => {
    if (api.dev) return;
    api.grantedDevices().then((d) => setCanReconnect(d.length > 0)).catch(() => setCanReconnect(false));
  }, [api.dev, api.grantedDevices]);
  // Once a keyboard is connected, load the other tabs in idle time so switching is instant.
  useEffect(() => {
    if (api.dev) prefetchParts();
  }, [api.dev]);
  const supported = WebHidTransport.isSupported();
  const apiRef = useRef(api);
  apiRef.current = api;

  // A refresh drops the WebHID handles; if this tab was connected, reopen the same device without a prompt.
  useEffect(() => {
    if (resumeTried) return;
    resumeTried = true;
    const kind = readSession();
    const api = apiRef.current;
    if (kind === 'hid' && supported) void api.grantedDevices().then((d) => (d.length ? api.reconnect() : undefined));
    else if (kind === 'demo-wired' && import.meta.env.DEV) void api.connectDemo('wired');
    else if (kind === 'demo-wireless' && import.meta.env.DEV) void api.connectDemo('wireless');
  }, [supported]);

  useEffect(() => {
    if (!supported) return;
    const onDisconnect = () => {
      const api = apiRef.current;
      if (api.dev && !api.isDemo) void api.disconnect(true);
    };
    // Plugging an already-allowed MK75 back in reconnects; its interfaces arrive one by one, so wait for all.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onConnect = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const api = apiRef.current;
        if (!api.dev && !api.busy) void api.grantedDevices().then((d) => (d.length ? api.reconnect() : undefined));
      }, 800);
    };
    navigator.hid.addEventListener('disconnect', onDisconnect);
    navigator.hid.addEventListener('connect', onConnect);
    return () => {
      clearTimeout(timer);
      navigator.hid.removeEventListener('disconnect', onDisconnect);
      navigator.hid.removeEventListener('connect', onConnect);
    };
  }, [supported]);

  const guide = (
    <PartBoundary resetKey="guide">
      <Suspense fallback={<PartLoading label="the guide" />}>
        <GuideView onClose={() => setGuideOpen(false)} />
      </Suspense>
    </PartBoundary>
  );

  return (
    <div className={api.dev ? 'app wide' : 'app'}>
      <header className="top">
        <div className="brand">
          <div className="brand-logo" aria-hidden>
            MK
          </div>
          <div>
            <h1>
              Lingbao <span className="brand-mk">MK75</span> Driver
            </h1>
            <p className="muted small">Unofficial web-based configuration tool for the MK75 keyboard</p>
          </div>
        </div>
        <div className="conn">
          <ThemeSwitch />
          <button className={guideOpen ? 'primary' : ''} onClick={() => setGuideOpen(!guideOpen)} aria-pressed={guideOpen}>
            Guide
          </button>
          {pwa.canInstall && (
            <button onClick={pwa.install} title="Install as an app (opens in its own window, works offline)">
              Install app
            </button>
          )}
          {api.dev ? (
            <>
              <span className={`pill ${api.isDemo ? 'demo' : 'ok'}`}>
                {api.dev.transport.name} · {api.dev.kind === 'wired' ? 'USB' : '2.4G / BT'}
              </span>
              {battery && (
                <span className="pill" title="Keyboard battery">
                  <BatteryIcon battery={battery} size={1.25} />
                </span>
              )}
              <GameModeToggle api={api} />
              <button onClick={() => void api.disconnect()} disabled={!!api.busy} title={api.busy ? 'Wait for the current write to finish' : undefined}>
                Disconnect
              </button>
            </>
          ) : (
            <>
              {canReconnect && (
                <button className="primary" onClick={api.reconnect} disabled={!!api.busy}>
                  Reconnect MK75
                </button>
              )}
              <button className={canReconnect ? '' : 'primary'} onClick={api.connect} disabled={!supported || !!api.busy}>
                Connect keyboard
              </button>
              {import.meta.env.DEV && (
                <button onClick={() => api.connectDemo('wired')} disabled={!!api.busy}>
                  Try simulator
                </button>
              )}
            </>
          )}
        </div>
      </header>

      {pwa.updateReady && (
        <div className="banner busy">
          A new version is available.{' '}
          <button className="primary" onClick={pwa.applyUpdate} style={{ marginLeft: 8 }}>
            Reload
          </button>
        </div>
      )}
      {api.busy && <div className="banner busy">{api.busy}…</div>}
      <SharedPresetBanner api={api} />
      {api.error && (
        <div className="banner err" role="alert">
          {api.error}
          <button className="x" onClick={() => api.setError(null)} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      {guideOpen && !api.dev ? (
        guide
      ) : !api.dev && testerOnly ? (
        <main className="stack">
          <button onClick={() => setTesterOnly(false)} style={{ alignSelf: 'flex-start' }}>
            ← Back
          </button>
          <PartBoundary resetKey="tester">
            <Suspense fallback={<PartLoading label="the key tester" />}>
              <TesterTab />
            </Suspense>
          </PartBoundary>
        </main>
      ) : !api.dev ? (
        <main className="welcome">
          <div className="hero-kb">
            <Keyboard selected={new Set()} onSelect={() => {}} />
          </div>
          <section className="card">
            <h2>Connect your MK75</h2>
            <ol>
              <li>
                Pick a connection with the switch next to the knob: <b>middle</b> = USB cable, <b>2.4G</b> = receiver (pair with{' '}
                <kbd>Fn</kbd>+<kbd>`</kbd> held 3 s), <b>BT</b> = Bluetooth "MK75-5.0" (pair with <kbd>Fn</kbd>+<kbd>1</kbd>/<kbd>2</kbd>/<kbd>3</kbd>).
              </li>
              <li>Put it in Windows mode with <kbd>Fn</kbd>+<kbd>W</kbd>, as the official driver requires.</li>
              <li>
                Click <b>Connect keyboard</b> and pick the MK75 (or its receiver) in the browser dialog. If several entries appear, pick any one.
              </li>
              <li>Download a backup from the <b>Backup &amp; log</b> tab before changing anything.</li>
            </ol>
            <p className="muted small">
              Everything works over the cable and the 2.4 GHz receiver. Bluetooth support is experimental.
            </p>
            {import.meta.env.DEV && (
              <div className="row">
                <span className="muted small">No keyboard handy?</span>
                <button onClick={() => api.connectDemo('wired')} disabled={!!api.busy}>
                  Simulator (USB)
                </button>
                <button onClick={() => api.connectDemo('wireless')} disabled={!!api.busy}>
                  Simulator (2.4 GHz)
                </button>
              </div>
            )}
            <div className="row">
              <span className="muted small">Just swapped switches?</span>
              <button onClick={() => setTesterOnly(true)}>Open key tester</button>
            </div>
            <div className="row">
              <span className="muted small">New here?</span>
              <button onClick={() => setGuideOpen(true)}>How to use (manual)</button>
            </div>
            {!supported && (
              <p className="banner err">
                This browser doesn't support WebHID. Use Chrome, Edge or Opera on desktop, over HTTPS or on localhost.
              </p>
            )}
            <p className="muted small">
              Linux: you may need a udev rule granting access to <span className="mono">hidraw</span> for vendor 258a. See the README.
            </p>
          </section>
        </main>
      ) : (
        <div className="shell">
          {/* Stays beside the Guide too (nothing highlighted); picking a section closes the Guide. */}
          <SideNav
            active={guideOpen ? null : tab}
            onSelect={(t) => {
              setTab(t);
              setGuideOpen(false);
              // The sidebar stays on screen while scrolling, so a new section starts at its top.
              if (window.scrollY > 0) window.scrollTo({ top: 0 });
            }}
          />
          {guideOpen ? (
            guide
          ) : (
            <main className="shell-main">
              <PartBoundary resetKey={tab}>
                <Suspense fallback={<PartLoading label={tab} />}>
                  {tab === 'Profiles' && <ProfilesTab api={api} />}
                  {tab === 'Lighting' && <LightingTab api={api} />}
                  {tab === 'Per-key RGB' && <PerKeyTab api={api} />}
                  {tab === 'Side lights' && <SideLightsTab api={api} />}
                  {tab === 'Live effects' && <LiveTab api={api} />}
                  {tab === 'Key mapping' && <KeymapTab api={api} />}
                  {tab === 'Macros' && <MacrosTab api={api} />}
                  {tab === 'Key tester' && <TesterTab api={api} />}
                  {tab === 'Device' && <DeviceTab api={api} battery={battery} />}
                  {tab === 'Backup & log' && <BackupTab api={api} />}
                </Suspense>
              </PartBoundary>
            </main>
          )}
        </div>
      )}
      {(reportOpen || contributeOpen) && (
        <PartBoundary resetKey={reportOpen ? 'report' : 'contribute'}>
          <Suspense fallback={null}>
            {reportOpen && <ReportDialog api={api} onClose={() => setReportOpen(false)} />}
            {contributeOpen && <ContributeDialog api={api} onClose={() => setContributeOpen(false)} />}
          </Suspense>
        </PartBoundary>
      )}
      <footer className="muted small">
        <p>
          <button className="report-btn" onClick={() => setReportOpen(true)}>
            Report an Issue
          </button>{' '}
          <button className="report-btn" onClick={() => setContributeOpen(true)}>
            Contribute device data
          </button>
        </p>
        <p className="made-in">
          <a className="author" href="https://github.com/sazedur-siam" target="_blank" rel="noopener noreferrer" title="sazedur-siam on GitHub">
            {/* GitHub mark (Octicons mark-github). */}
            <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden>
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
            </svg>
            Sazedur Rahman
          </a>
          {/* Flag of Bangladesh (10:6, red disc offset towards the hoist). Drawn as SVG because Windows shows flag emoji as letters. */}
          <svg className="bd-flag" viewBox="0 0 10 6" width="20" height="12" role="img" aria-label="Flag of Bangladesh">
            <rect width="10" height="6" fill="#006a4e" />
            <circle cx="4.5" cy="3" r="2" fill="#f42a41" />
          </svg>
        </p>
        <p>Not affiliated with Lingbao. Protocol reverse-engineered from the official LINGBAO Keyboard Driver v2.0 for Windows. Use at your own risk.</p>
      </footer>
    </div>
  );
}
