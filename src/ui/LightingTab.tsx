import { useEffect, useMemo, useState } from 'react';
import {
  CUSTOM_MODE_INDEX,
  fromHex,
  hex,
  LED_MODES,
  LEVELS,
  parseProfile,
  parseRgbTable,
  patchProfile,
  patchRgbTable,
  type LightingState,
  type RGB,
} from '../protocol/lighting';
import { EffectPreview } from './EffectPreview';
import type { DeviceApi } from './useDevice';

export function LightingTab({ api }: { api: DeviceApi }) {
  const { snap, dev } = api;
  const initial = useMemo(() => (snap ? parseProfile(snap.profile) : null), [snap]);
  const initialPal = useMemo(() => (snap ? parseRgbTable(snap.rgbTable) : null), [snap]);
  const [state, setState] = useState<LightingState | null>(initial);
  const [pal, setPal] = useState<RGB[][] | null>(initialPal);
  const [showHidden, setShowHidden] = useState(false);

  useEffect(() => setState(initial), [initial]);
  useEffect(() => setPal(initialPal), [initialPal]);

  if (!snap || !dev || !state || !pal) return null;
  const mode = LED_MODES[state.activeIndex];
  const s = state.perMode[mode.index];
  const dirty =
    JSON.stringify(state) !== JSON.stringify(initial) || JSON.stringify(pal) !== JSON.stringify(initialPal);

  const setMode = (i: number) => setState({ ...state, activeIndex: i });
  const setS = (patch: Partial<typeof s>) =>
    setState({ ...state, perMode: state.perMode.map((m, i) => (i === mode.index ? { ...m, ...patch } : m)) });
  const setColor = (k: number, c: RGB) => setPal(pal.map((p, i) => (i === mode.index ? p.map((x, j) => (j === k ? c : x)) : p)));

  const apply = () =>
    api.run('Saving lighting', async () => {
      const custom = state.activeIndex === CUSTOM_MODE_INDEX;
      // Vendor order: RGB table (only when not in Self-define), then profile.
      let rgbTable = snap.rgbTable;
      if (!custom && JSON.stringify(pal) !== JSON.stringify(initialPal)) {
        rgbTable = patchRgbTable(snap.rgbTable, pal);
        await dev.writeRgbTable(rgbTable);
      }
      const profile = patchProfile(snap.profile, state);
      await dev.writeProfile(profile);
      // Read back to confirm what the firmware stored.
      const back = await dev.readProfile();
      api.setSnap({ ...snap, profile: back, rgbTable: custom ? snap.rgbTable : await dev.readRgbTable() });
      api.push({ dir: 'info', text: `Lighting saved: ${LED_MODES[state.activeIndex].name}` });
    });

  return (
    <div className="panel-grid">
      <section className="card">
        <header className="card-h">
          <h2>Effect</h2>
          <label className="chk">
            <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} /> show effects hidden by vendor
          </label>
        </header>
        <div className="modes">
          {LED_MODES.filter((m) => showHidden || !m.hidden || m.index === state.activeIndex).map((m) => (
            <button
              key={m.index}
              className={`mode${m.index === state.activeIndex ? ' on' : ''}${m.hidden ? ' hidden-mode' : ''}`}
              onClick={() => setMode(m.index)}
              aria-pressed={m.index === state.activeIndex}
              title={`hardware effect ${m.hw}`}
            >
              {m.name}
            </button>
          ))}
        </div>
        {state.activeIndex === CUSTOM_MODE_INDEX && (
          <p className="hint">Self-define shows the per-key colours set on the <b>Per-key RGB</b> tab.</p>
        )}
      </section>

      <section className="card">
        <header className="card-h">
          <h2>{mode.name}</h2>
        </header>
        <EffectPreview
          modeIndex={mode.index}
          settings={s}
          color={pal[mode.index]?.[dev.caps.paletteIndex ? s.colorIndex : 0] ?? [255, 255, 255]}
        />
        {!mode.brightness && !mode.speed && !mode.color && <p className="muted">This effect has no adjustable settings.</p>}
        {mode.brightness && (
          <Level label="Brightness" value={s.brightness} onChange={(v) => setS({ brightness: v })} />
        )}
        {mode.speed && <Level label="Speed" value={s.speed} onChange={(v) => setS({ speed: v })} />}
        {(mode.color || mode.random) && (
          <div className="field">
            <span className="field-l">Colour</span>
            <div className="swatches">
              {mode.color &&
                pal[mode.index].slice(0, dev.caps.paletteIndex ? undefined : 1).map((c, k) => (
                  <label key={k} className={`swatch${!s.colorful && s.colorIndex === k ? ' on' : ''}`} title="Click to select, double-click to edit">
                    <input
                      type="radio"
                      name="pal"
                      checked={!s.colorful && s.colorIndex === k}
                      onChange={() => setS({ colorful: false, colorIndex: k })}
                    />
                    <span style={{ background: hex(c) }} />
                    <input
                      type="color"
                      className="swatch-edit"
                      value={hex(c)}
                      onChange={(e) => {
                        setColor(k, fromHex(e.target.value));
                        setS({ colorful: false, colorIndex: k });
                      }}
                      aria-label={`Edit colour ${k + 1}`}
                    />
                  </label>
                ))}
              {mode.random && (
                <button className={`swatch rainbow${s.colorful ? ' on' : ''}`} onClick={() => setS({ colorful: true })} aria-pressed={s.colorful}>
                  Colourful
                </button>
              )}
            </div>
            {mode.color && dev.caps.paletteIndex && <p className="hint">Pick a swatch; use the small picker under it to change that palette colour.</p>}
            {mode.color && !dev.caps.paletteIndex && (
              <p className="hint">Over 2.4 GHz / Bluetooth the keyboard uses the first palette colour; use its picker to choose any colour.</p>
            )}
          </div>
        )}
        <div className="actions">
          <button className="primary" disabled={!dirty || !!api.busy} onClick={apply}>
            Save to keyboard
          </button>
          <button disabled={!dirty} onClick={() => { setState(initial); setPal(initialPal); }}>
            Revert
          </button>
        </div>
      </section>
    </div>
  );
}

function Level({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="field">
      <span className="field-l">
        {label} <b>{value}</b>
      </span>
      <div className="levels" role="radiogroup" aria-label={label}>
        {Array.from({ length: LEVELS }, (_, i) => (
          <button key={i} role="radio" aria-checked={value === i} className={value === i ? 'on' : ''} onClick={() => onChange(i)}>
            {i}
          </button>
        ))}
      </div>
    </div>
  );
}
