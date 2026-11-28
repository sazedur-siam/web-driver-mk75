import { useCallback, useEffect, useRef, useState } from 'react';
import type { SideLights } from '../protocol/device';
import type { DeviceApi } from './useDevice';

/**
 * Side light bars (features/20-side-lights.md): mode, colour, brightness and speed in the layout B config block
 * (0x12..0x15). Every write makes the keyboard restart its lighting (a short blink), so the page writes only real
 * changes, and a slider only once the user stops moving it.
 */
/** Order of byte 0x12, matching the Fn + Right Shift cycle (flow → neon → steady → breathe → off). */
export const SIDE_MODE_NAMES = ['Off', 'Flow', 'Neon', 'Steady', 'Breathe'];
/** Byte 0x13 values 0..6 as a real MK75 shows them in Steady (seen by the owner, 2026-11-28). */
export const SIDE_COLOURS = [
  { name: 'Red', css: '#ff2a2a' },
  { name: 'Green', css: '#2ecc40' },
  { name: 'Blue', css: '#2f6bff' },
  { name: 'Yellow', css: '#ffd400' },
  { name: 'Purple', css: '#a23cff' },
  { name: 'Cyan', css: '#00d5e6' },
  { name: 'White', css: '#ffffff' },
];
const colourName = (c: number) => SIDE_COLOURS[c]?.name ?? `colour ${c + 1}`;
/** Modes where the colour shows (the keyboard's Fn + / only works in these too). */
const COLOUR_MODES = [3, 4];
/** A slider writes this long after the last move, so dragging across levels blinks the lights once. */
const SLIDER_WRITE_MS = 450;
type Level = 'brightness' | 'speed';

export function SideLightsTab({ api }: { api: DeviceApi }) {
  const { dev } = api;
  const [cur, setCur] = useState<SideLights | null>(null);
  /** Slider positions not written yet. */
  const [draft, setDraft] = useState<Partial<Record<Level, number>>>({});
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);

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

  const write = (s: Partial<SideLights>) => {
    // Clicking what's already set would only make the lights blink.
    if (cur && (Object.keys(s) as (keyof SideLights)[]).every((k) => s[k] === cur[k])) return;
    return api.run('Saving side lights', async () => {
      await dev.writeSideLights!(s);
      const back = await dev.readSideLights!();
      setCur(back);
      api.push({
        dir: 'info',
        text: `Side lights: ${SIDE_MODE_NAMES[back.mode] ?? `mode ${back.mode}`}, ${colourName(back.colour)}, brightness ${back.brightness + 1}, speed ${back.speed + 1}`,
      });
    });
  };

  const slide = (k: Level, v: number) => {
    setDraft((d) => ({ ...d, [k]: v }));
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setDraft({});
      void write({ [k]: v });
    }, SLIDER_WRITE_MS);
  };

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
        <p className="muted small">
          The light bars on both sides of the keyboard. Each change is sent right away; the keyboard blinks its lights once while it applies it.
        </p>

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
            Colour for Steady and Breathe <b>{cur ? colourName(cur.colour) : '…'}</b>
          </span>
          <div className="levels seven side-colours" role="radiogroup" aria-label="Side-light colour">
            {SIDE_COLOURS.map((c, i) => (
              <button key={c.name} role="radio" aria-checked={cur?.colour === i} className={cur?.colour === i ? 'on' : ''} disabled={busy || !cur} onClick={() => write({ colour: i })}>
                <span className="side-dot" style={{ background: c.css }} aria-hidden="true" />
                <span className="side-name">{c.name}</span>
              </button>
            ))}
          </div>
          {cur && !colourShows && <p className="hint">The colour shows in Steady and Breathe. Other modes use their own colours.</p>}
          <p className="hint">The keyboard has 7 fixed side-light colours, the same ones Fn + / steps through.</p>
        </div>

        {(['brightness', 'speed'] as const).map((k) => {
          const v = draft[k] ?? cur?.[k];
          return (
            <label className="field" key={k}>
              <span className="field-l">
                {k === 'brightness' ? 'Brightness' : 'Speed'} <b>{v === undefined ? '…' : `${v + 1} of 5`}</b>
              </span>
              <input type="range" min={0} max={4} step={1} value={v ?? 0} disabled={!cur || (busy && draft[k] === undefined)} onChange={(e) => slide(k, Number(e.target.value))} />
            </label>
          );
        })}
        <p className="hint">
          Speed shows in the moving modes. If you change brightness or speed with the keyboard shortcuts, the keyboard only saves it at the next mode or
          colour change, so Refresh may still show the old level until then.
        </p>
      </section>

      <section className="card">
        <header className="card-h">
          <h2>Keyboard shortcuts</h2>
        </header>
        <p className="muted small">The same settings, straight from the keyboard:</p>
        <Shortcuts />
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

function Shortcuts() {
  return (
    <table className="probe-table small">
      <tbody>
        {SHORTCUTS.map(([k, v]) => (
          <tr key={k}>
            <td className="mono">{k}</td>
            <td>{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
