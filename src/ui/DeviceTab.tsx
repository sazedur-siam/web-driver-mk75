import { useEffect, useState } from 'react';
import type { KeyboardSettings } from '../protocol/device';
import type { Battery } from './battery';
import { BatteryIcon } from './BatteryIcon';
import type { DeviceApi } from './useDevice';

/** Sleep timer: profile[0x11] = 0xFF (off) or seconds/30 (vendor default SleepUI/SleepHW tables). */
const SLEEP_OPTIONS: { label: string; code: number }[] = [
  { label: 'Never', code: 0xff },
  { label: '30 seconds', code: 1 },
  { label: '1 minute', code: 2 },
  { label: '1.5 minutes', code: 3 },
  { label: '2 minutes', code: 4 },
  { label: '3 minutes', code: 6 },
  { label: '4 minutes', code: 8 },
  { label: '5 minutes', code: 10 },
  { label: '10 minutes', code: 20 },
  { label: '15 minutes', code: 30 },
  { label: '20 minutes', code: 40 },
];
const P_SLEEP = 0x11;

/**
 * On-keyboard shortcuts. Confirmed = official MK75 product sheet and/or KB.ini [FN1] codes;
 * "likely" = inferred from the firmware function codes, not documented by Lingbao.
 */
const SHORTCUTS: [string, string, boolean?][] = [
  ['Switch (top right)', '2.4G · wired (middle) · Bluetooth'],
  ['Fn + ` (hold 3 s)', 'Pair the 2.4 GHz receiver'],
  ['Fn + 1 / 2 / 3 (hold 3 s)', 'Pair Bluetooth channel 1 / 2 / 3 ("MK75-5.0" / "MK75-3.0")'],
  ['Fn + Q / W / E', 'Android / Windows / macOS mode'],
  ['Fn + B', 'Show battery level'],
  ['Fn + F1 … F4', 'Home page · Mail · Switch window · File Explorer'],
  ['Fn + F5 / F6', 'Backlight brightness − / +'],
  ['Fn + ↓ / ↑', 'Backlight brightness − / +'],
  ['Fn + F7 / F8 / F9', 'Previous · Play/Pause · Next'],
  ['Fn + F10 / F11 / F12', 'Mute · Volume − · Volume +'],
  ['Fn + RShift', 'Side lights: flow / neon / steady / breathe / off'],
  ['Fn + RCtrl', 'Side-light speed'],
  ['Fn + RAlt', 'Side-light brightness'],
  ['Fn + /', 'Side-light colour (breathe & steady modes)'],
  ['Fn + U / I / O', 'Print Screen · Scroll Lock · Pause'],
  ['Fn + Delete / End', 'Insert · Home'],
  ['Knob (hold 3 s)', 'Switch multimedia ↔ lighting knob mode'],
  ['Fn + ← / →', 'Effect speed − / +', true],
  ['Fn + \\', 'Next lighting effect', true],
  ['Fn + Tab', 'Change effect colour', true],
  ['Fn + LWin', 'Lock the Windows key (Win LED)', true],
  ['Fn + Esc (hold)', 'Factory reset', true],
];

export function DeviceTab({ api, battery }: { api: DeviceApi; battery: Battery | null }) {
  const { snap, dev, modelId } = api;
  const current = snap?.profile[P_SLEEP] ?? 0xff;
  const [sleep, setSleep] = useState(current);
  useEffect(() => setSleep(current), [current]);
  const [notify, setNotify] = useState(() => ('Notification' in window ? Notification.permission : 'denied'));
  const [settings, setSettings] = useState<KeyboardSettings | null>(null);
  const [debounce, setDebounce] = useState(0);
  useEffect(() => {
    setSettings(null);
    if (!dev?.readSettings) return;
    void api.run('Reading keyboard settings', async () => {
      const s = await dev.readSettings!();
      setSettings(s);
      setDebounce(s.debounce);
    });
  }, [dev]);
  if (!snap || !dev) return null;

  const saveDebounce = () =>
    api.run('Saving debounce', async () => {
      await dev.writeSettings!({ debounce });
      const s = await dev.readSettings!();
      setSettings(s);
      api.push({ dir: 'info', text: `Debounce set to level ${s.debounce + 1}` });
    });

  const known = SLEEP_OPTIONS.some((o) => o.code === current);
  const saveSleep = () =>
    api.run('Saving sleep timer', async () => {
      const p = new Uint8Array(snap.profile);
      p[P_SLEEP] = sleep;
      await dev.writeProfile(p);
      api.setSnap({ ...snap, profile: await dev.readProfile() });
      api.push({ dir: 'info', text: `Sleep timer set: ${SLEEP_OPTIONS.find((o) => o.code === sleep)?.label}` });
    });

  const idHex = modelId ? [...modelId].map((b) => b.toString(16).padStart(2, '0')).join(' ') : null;
  const isMk75 = idHex === '03 00 00 00 00 c6';

  return (
    <div className="panel-grid">
      <div className="stack">
        <section className="card">
          <h2>Device</h2>
          <dl className="shortcuts">
            <div>
              <dt>Connection</dt>
              <dd>
                {dev.transport.name} · {dev.kind === 'wired' ? 'USB cable' : '2.4 GHz receiver / Bluetooth'}
              </dd>
            </div>
            {dev.kind === 'wired' && (
              <div>
                <dt>Model check</dt>
                <dd>{idHex ? `${idHex}${isMk75 ? ' (MK75 ✓)' : ' (unexpected)'}` : 'no answer'}</dd>
              </div>
            )}
            {battery && (
              <div>
                <dt>Battery</dt>
                <dd>
                  <BatteryIcon battery={battery} size={1.6} />
                  {battery.charging ? ' charging' : ''}
                  {notify === 'default' && (
                    <button className="small" style={{ marginLeft: 8 }} onClick={() => void Notification.requestPermission().then(setNotify)}>
                      Notify me when low
                    </button>
                  )}
                </dd>
              </div>
            )}
            <div>
              <dt>Polling</dt>
              <dd>1000 Hz wired / 2.4 GHz · 125 Hz Bluetooth</dd>
            </div>
          </dl>
          {idHex && !isMk75 && (
            <p className="hint warn">This keyboard didn't report the MK75 model id. Settings may not apply as expected.</p>
          )}
          <p className="hint">
            The firmware version is only in the USB descriptor, which browsers don't expose.
            {dev.kind === 'wireless' && !dev.caps.battery && ' This receiver type doesn\'t report battery level; press Fn+B on the keyboard.'}
          </p>
        </section>

        <section className="card">
          <h2>Sleep timer</h2>
          <p className="muted small">In wireless mode, the keyboard sleeps after this much idle time.</p>
          <div className="row">
            <select value={sleep} onChange={(e) => setSleep(Number(e.target.value))} aria-label="Sleep after">
              {!known && <option value={current}>Current (code {current})</option>}
              {SLEEP_OPTIONS.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.label}
                </option>
              ))}
            </select>
            <button className="primary" disabled={sleep === current || !!api.busy} onClick={saveSleep}>
              Save
            </button>
          </div>
        </section>

        {settings && (
          <section className="card">
            <h2>
              Debounce <span className="likely">experimental</span>
            </h2>
            <p className="muted small">
              Raise it if a key sometimes types twice (check with the Key tester). Higher levels filter more chatter but
              react slightly later.
            </p>
            <div className="row">
              <select value={debounce} onChange={(e) => setDebounce(Number(e.target.value))} aria-label="Debounce level">
                {[0, 1, 2, 3, 4].map((v) => (
                  <option key={v} value={v}>
                    Level {v + 1}
                    {v === 2 ? ' (factory)' : ''}
                  </option>
                ))}
              </select>
              <button className="primary" disabled={debounce === settings.debounce || !!api.busy} onClick={saveDebounce}>
                Save
              </button>
            </div>
          </section>
        )}
      </div>

      <section className="card">
        <h2>Keyboard shortcuts</h2>
        <p className="muted small">Built into the MK75 firmware; these work without the driver.</p>
        <dl className="shortcuts">
          {SHORTCUTS.map(([k, v, likely]) => (
            <div key={k}>
              <dt>
                <kbd>{k}</kbd>
              </dt>
              <dd>
                {v}
                {likely && <span className="likely"> likely</span>}
              </dd>
            </div>
          ))}
        </dl>
        <p className="hint">Fn-layer functions belong to the firmware; the official driver doesn't remap them either.</p>
      </section>
    </div>
  );
}
