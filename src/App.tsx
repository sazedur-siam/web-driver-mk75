import { useEffect, useState } from 'react';
import { WebHidTransport } from './protocol/transport';
import { BackupTab } from './ui/BackupTab';
import { KeymapTab } from './ui/KeymapTab';
import { LightingTab } from './ui/LightingTab';
import { PerKeyTab } from './ui/PerKeyTab';
import { useDevice } from './ui/useDevice';

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
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
            <rect x="2" y="6" width="20" height="12" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <path d="M6 10h1M9 10h1M12 10h1M15 10h1M18 10h1M7 14h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <div>
            <h1>Lingbao MK75 Driver</h1>
            <p className="muted small">Unofficial web-based configuration tool for the MK75 keyboard</p>
          </div>
        </div>
        <div className="conn">
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
        Not affiliated with AULA. Protocol reverse-engineered from the vendor's Windows driver v2.0. Use at your own risk.
      </footer>
    </div>
  );
}
