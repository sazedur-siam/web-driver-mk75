import { useCallback, useEffect, useState } from 'react';
import type { SideLights } from '../protocol/device';
import type { DeviceApi } from './useDevice';

/**
 * Side light bars (features/20-side-lights.md). Mode and colour live in the layout B config block (0x12 / 0x13);
 * brightness and speed are keyboard-only. Each click writes at once, like the keyboard shortcuts do.
 */
/** Order of byte 0x12, matching the Fn + Right Shift cycle (flow → neon → steady → breathe → off). */
export const SIDE_MODE_NAMES = ['Off', 'Flow', 'Neon', 'Steady', 'Breathe'];
const SIDE_COLOUR_COUNT = 7;
/** Modes where the colour shows (the keyboard's Fn + / only works in these too). */
const COLOUR_MODES = [3, 4];

export function SideLightsTab({ api }: { api: DeviceApi }) {
  const { dev } = api;
  const [cur, setCur] = useState<SideLights | null>(null);

  const read = useCallback(() => {
    if (!dev?.readSideLights) return;
    void api.run('Reading side lights', async () => setCur(await dev.readSideLights!()));
  }, [api, dev]);

  // Read once per connection; Refresh reads again.
  useEffect(read, [dev]);

  if (!dev) return null;

  if (!dev.readSideLights || !dev.writeSideLights) {
    return (
      <div className="panel-grid">
        <section className="card">
          <header className="card-h">
            <h2>Side lights</h2>
          </header>
          <p className="muted">This keyboard's firmware doesn't let the app change the side lights. Use the shortcuts on the keyboard:</p>
          <Shortcuts />
        </section>
      </div>
    );
  }

  const write = (s: Partial<SideLights>) =>
    api.run('Saving side lights', async () => {
      await dev.writeSideLights!(s);
      const back = await dev.readSideLights!();
      setCur(back);
      api.push({ dir: 'info', text: `Side lights: ${SIDE_MODE_NAMES[back.mode] ?? `mode ${back.mode}`}, colour ${back.colour + 1}` });
    });

  const busy = !!api.busy;
  const colourShows = !!cur && COLOUR_MODES.includes(cur.mode);

  return (
    <div className="panel-grid">
      <section className="card">
        <header className="card-h">
          <h2>
            Side lights <span className="pill small-pill">experimental</span>
          </h2>
          <button disabled={busy} onClick={read} title="Read again, for example after using the keyboard shortcuts">
            Refresh
          </button>
        </header>
        <p className="muted small">The light bars on both sides of the keyboard. Each click is sent to the keyboard right away.</p>

        <div className="field">
          <span className="field-l">
            Mode <b>{cur ? (SIDE_MODE_NAMES[cur.mode] ?? `code ${cur.mode}`) : '…'}</b>
          </span>
          <div className="levels" role="radiogroup" aria-label="Side-light mode">
            {SIDE_MODE_NAMES.map((name, i) => (
              <button key={name} role="radio" aria-checked={cur?.mode === i} className={cur?.mode === i ? 'on' : ''} disabled={busy || !cur} onClick={() => write({ mode: i })}>
                {name}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span className="field-l">
            Colour <b>{cur ? cur.colour + 1 : '…'}</b>
          </span>
          <div className="levels seven" role="radiogroup" aria-label="Side-light colour">
            {Array.from({ length: SIDE_COLOUR_COUNT }, (_, i) => (
              <button key={i} role="radio" aria-checked={cur?.colour === i} className={cur?.colour === i ? 'on' : ''} disabled={busy || !cur} onClick={() => write({ colour: i })}>
                {i + 1}
              </button>
            ))}
          </div>
          {cur && !colourShows && <p className="hint">The colour shows in Steady and Breathe. Other modes use their own colours.</p>}
          <p className="hint">The keyboard has 7 fixed side-light colours, the same ones Fn + / steps through.</p>
        </div>
      </section>

      <section className="card">
        <header className="card-h">
          <h2>Brightness and speed</h2>
        </header>
        <p className="muted small">
          The keyboard doesn't share side-light brightness and speed with the computer, so only its shortcuts change them:
        </p>
        <Shortcuts only={['Fn + Right Alt', 'Fn + Right Ctrl']} />
      </section>
    </div>
  );
}

const SHORTCUTS: [string, string][] = [
  ['Fn + Right Shift', 'Mode: flow → neon → steady → breathe → off'],
  ['Fn + /', 'Colour (steady and breathe)'],
  ['Fn + Right Alt', 'Brightness'],
  ['Fn + Right Ctrl', 'Speed'],
];

function Shortcuts({ only }: { only?: string[] }) {
  return (
    <table className="probe-table small">
      <tbody>
        {SHORTCUTS.filter(([k]) => !only || only.includes(k)).map(([k, v]) => (
          <tr key={k}>
            <td className="mono">{k}</td>
            <td>{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
