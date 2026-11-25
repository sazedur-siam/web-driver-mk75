import { useEffect, useState } from 'react';
import { WebHidTransport } from './protocol/transport';
import { BackupTab } from './ui/BackupTab';
import { DeviceTab } from './ui/DeviceTab';
import { LiveTab } from './ui/LiveTab';
import { MacrosTab } from './ui/MacrosTab';
import { KeymapTab } from './ui/KeymapTab';
import { LightingTab } from './ui/LightingTab';
import { PerKeyTab } from './ui/PerKeyTab';
import { ProfilesTab } from './ui/ProfilesTab';
import { TesterTab } from './ui/TesterTab';
import { Keyboard } from './ui/Keyboard';
import { useDevice } from './ui/useDevice';

/** One theme per official MK75 colourway (product page): case / keycap colours for the swatch. */
const THEMES = [
  { id: 'green-orange', name: 'Dark green-orange', swatch: 'conic-gradient(#93d6c6 0 50%, #f39a2b 0 75%, #0a0e0c 0)' },
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
    <div className="theme-switch" role="radiogroup" aria-label="MK75 colourway">
      {THEMES.map((t) => (
        <button key={t.id} role="radio" aria-checked={theme === t.id} className={theme === t.id ? 'on' : ''} onClick={() => setTheme(t.id)} title={t.name}>
          <span className="theme-dot" style={{ background: t.swatch }} aria-hidden />
          <span className="theme-name">{t.name}</span>
        </button>
      ))}
    </div>
  );
}

const TABS = ['Profiles', 'Lighting', 'Per-key RGB', 'Live effects', 'Key mapping', 'Macros', 'Key tester', 'Device', 'Backup & log'] as const;
type Tab = (typeof TABS)[number];

export default function App() {
  const api = useDevice();
  const [tab, setTab] = useState<Tab>('Lighting');
  const [testerOnly, setTesterOnly] = useState(false);
  const supported = WebHidTransport.isSupported();

  useEffect(() => {
    if (!supported) return;
    const onDisconnect = () => {
      if (api.dev && !api.isDemo) void api.disconnect();
    };
    navigator.hid.addEventListener('disconnect', onDisconnect);
    return () => navigator.hid.removeEventListener('disconnect', onDisconnect);
  }, [api, supported]);

  return (
    <div className="app">
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
          {api.dev ? (
            <>
              <span className={`pill ${api.isDemo ? 'demo' : 'ok'}`}>
                {api.dev.transport.name} · {api.dev.kind === 'wired' ? 'USB' : '2.4G / BT'}
              </span>
              <button onClick={api.disconnect}>Disconnect</button>
            </>
          ) : (
            <>
              <button className="primary" onClick={api.connect} disabled={!supported || !!api.busy}>
                Connect keyboard
              </button>
              <button onClick={() => api.connectDemo('wired')} disabled={!!api.busy}>
                Try simulator
              </button>
            </>
          )}
        </div>
      </header>

      {api.busy && <div className="banner busy">{api.busy}…</div>}
      {api.error && (
        <div className="banner err" role="alert">
          {api.error}
          <button className="x" onClick={() => api.setError(null)} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      {!api.dev && testerOnly ? (
        <main className="stack">
          <button onClick={() => setTesterOnly(false)} style={{ alignSelf: 'flex-start' }}>
            ← Back
          </button>
          <TesterTab />
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
              Everything works over the cable. Over 2.4 GHz / Bluetooth: lighting, per-key colours, live effects and key mapping work;
              macros need the cable for now.
            </p>
            <div className="row">
              <span className="muted small">No keyboard handy?</span>
              <button onClick={() => api.connectDemo('wired')} disabled={!!api.busy}>
                Simulator (USB)
              </button>
              <button onClick={() => api.connectDemo('wireless')} disabled={!!api.busy}>
                Simulator (2.4 GHz)
              </button>
            </div>
            <div className="row">
              <span className="muted small">Just swapped switches?</span>
              <button onClick={() => setTesterOnly(true)}>Open key tester</button>
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
        <>
          <nav className="tabs" role="tablist">
            {TABS.map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
                {t}
              </button>
            ))}
          </nav>
          <main>
            {tab === 'Profiles' && <ProfilesTab api={api} />}
            {tab === 'Lighting' && <LightingTab api={api} />}
            {tab === 'Per-key RGB' && <PerKeyTab api={api} />}
            {tab === 'Live effects' && <LiveTab api={api} />}
            {tab === 'Key mapping' && <KeymapTab api={api} />}
            {tab === 'Macros' && <MacrosTab api={api} />}
            {tab === 'Key tester' && <TesterTab />}
            {tab === 'Device' && <DeviceTab api={api} />}
            {tab === 'Backup & log' && <BackupTab api={api} />}
          </main>
        </>
      )}
      <footer className="muted small">
        Not affiliated with Lingbao. Protocol reverse-engineered from the official LINGBAO Keyboard Driver v2.0 for Windows. Use at your own risk.
      </footer>
    </div>
  );
}
