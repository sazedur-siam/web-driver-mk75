import { useEffect, useState } from 'react';
import { WebHidTransport } from './protocol/transport';
import { BackupTab } from './ui/BackupTab';
import { KeymapTab } from './ui/KeymapTab';
import { LightingTab } from './ui/LightingTab';
import { PerKeyTab } from './ui/PerKeyTab';
import { Keyboard } from './ui/Keyboard';
import { useDevice } from './ui/useDevice';

type Theme = 'dark' | 'light';
const THEME_KEY = 'mk75.theme';

function readTheme(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

/** MK75 colourways: "Dark green-orange" (default) and a cream/pink light variant. */
function ThemeSwitch() {
  const [theme, setTheme] = useState<Theme>(readTheme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* storage unavailable */
    }
  }, [theme]);
  return (
    <div className="theme-switch" role="radiogroup" aria-label="Colour theme">
      <button role="radio" aria-checked={theme === 'dark'} className={theme === 'dark' ? 'on' : ''} onClick={() => setTheme('dark')}>
        Green-orange
      </button>
      <button role="radio" aria-checked={theme === 'light'} className={theme === 'light' ? 'on' : ''} onClick={() => setTheme('light')}>
        Cream
      </button>
    </div>
  );
}

const TABS = ['Lighting', 'Per-key RGB', 'Key mapping', 'Backup & log'] as const;
type Tab = (typeof TABS)[number];

export default function App() {
  const api = useDevice();
  const [tab, setTab] = useState<Tab>('Lighting');
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
              <span className={`pill ${api.isDemo ? 'demo' : 'ok'}`}>{api.isDemo ? 'Simulator' : api.dev.transport.name}</span>
              <button onClick={api.disconnect}>Disconnect</button>
            </>
          ) : (
            <>
              <button className="primary" onClick={api.connect} disabled={!supported || !!api.busy}>
                Connect keyboard
              </button>
              <button onClick={api.connectDemo} disabled={!!api.busy}>
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

      {!api.dev ? (
        <main className="welcome">
          <div className="hero-kb">
            <Keyboard selected={new Set()} onSelect={() => {}} />
          </div>
          <section className="card">
            <h2>Connect your MK75</h2>
            <ol>
              <li>Plug the keyboard in with the USB cable. The 2.4 GHz dongle and Bluetooth aren't supported.</li>
              <li>Switch it to Windows mode with <kbd>Fn</kbd>+<kbd>W</kbd>, as the vendor tool requires.</li>
              <li>
                Click <b>Connect keyboard</b> and pick the keyboard (USB ID <span className="mono">258A:010C</span>) in the browser dialog. If several
                entries appear, pick any one; the app opens the vendor interfaces it needs.
              </li>
              <li>Download a backup from the <b>Backup &amp; log</b> tab before changing anything.</li>
            </ol>
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
            {tab === 'Lighting' && <LightingTab api={api} />}
            {tab === 'Per-key RGB' && <PerKeyTab api={api} />}
            {tab === 'Key mapping' && <KeymapTab api={api} />}
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
