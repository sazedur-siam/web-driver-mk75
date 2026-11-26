import { useEffect, useId, useState } from 'react';
import { SIDE_LIGHT_COLORS, SIDE_LIGHT_MODES, type SideLightState } from '../protocol/sideLight';
import type { DeviceApi } from './useDevice';

export function SideLight({ api }: { api: DeviceApi }) {
  const { dev, run } = api;
  const colorGroup = useId();
  const [saved, setSaved] = useState<SideLightState | null>(null);
  const [draft, setDraft] = useState<SideLightState | null>(null);

  useEffect(() => {
    let active = true;
    setSaved(null);
    setDraft(null);
    if (dev?.sideLight) void run('Reading side lights', async () => {
      const state = await dev.sideLight!.read();
      if (active) { setSaved(state); setDraft(state); }
    });
    return () => { active = false; };
  }, [dev, run]);

  if (!dev?.sideLight) return null;
  const dirty = !!saved && !!draft && (saved.mode !== draft.mode ||
    ((draft.mode === 3 || draft.mode === 4) && saved.color !== draft.color) ||
    (draft.mode !== 0 && saved.brightness !== draft.brightness) ||
    (draft.mode !== 0 && draft.mode !== 3 && saved.speed !== draft.speed));
  const refresh = () => run('Reading side lights', async () => {
    const state = await dev.sideLight!.read();
    setSaved(state); setDraft(state);
  });
  const save = () => run('Saving side lights', async () => {
    if (!saved || !draft) return;
    const changes: Partial<SideLightState> = {};
    if (saved.mode !== draft.mode) changes.mode = draft.mode;
    if (saved.color !== draft.color && (draft.mode === 3 || draft.mode === 4)) changes.color = draft.color;
    if (saved.brightness !== draft.brightness && draft.mode !== 0) changes.brightness = draft.brightness;
    if (saved.speed !== draft.speed && draft.mode !== 0 && draft.mode !== 3) changes.speed = draft.speed;
    const state = await dev.sideLight!.write(changes);
    setSaved(state); setDraft(state);
    if ((Object.keys(changes) as (keyof SideLightState)[]).some((key) => state[key] !== changes[key]))
      throw new Error('The keyboard did not retain the selected side-light settings');
    api.push({ dir: 'info', text: 'Side lights saved' });
  });

  return <section className="card">
    <header className="card-h"><h2>Side lights <small>(experimental)</small></h2></header>
    <p className="hint">Tested on one wired IC2481 keyboard. Changes made with keyboard shortcuts may not immediately appear in readback.</p>
    {draft && <>
      <div className="field">
        <label className="field-l" htmlFor="side-mode">Mode</label>
        <select id="side-mode" value={draft.mode} onChange={(e) => setDraft({ ...draft, mode: Number(e.target.value) })}>
          {SIDE_LIGHT_MODES.map((name, i) => <option key={i} value={i}>{name}</option>)}
        </select>
      </div>
      <fieldset className="side-field" disabled={draft.mode !== 3 && draft.mode !== 4}>
        <legend className="field-l">Colour (solid and breathe)</legend>
        <div className="swatches">
          {SIDE_LIGHT_COLORS.map((name, i) => (
            <label key={name} className={`swatch side-swatch${draft.color === i ? ' on' : ''}`} title={name}>
              <input type="radio" name={colorGroup} value={i} checked={draft.color === i} onChange={() => setDraft({ ...draft, color: i })} aria-label={name} />
              <span style={{ background: ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff', '#ffffff'][i] }} />
            </label>
          ))}
        </div>
      </fieldset>
      <SideLevel label="Brightness" value={draft.brightness} disabled={draft.mode === 0} onChange={(brightness) => setDraft({ ...draft, brightness })} />
      <SideLevel label="Speed" value={draft.speed} disabled={draft.mode === 0 || draft.mode === 3} onChange={(speed) => setDraft({ ...draft, speed })} />
    </>}
    <div className="actions">
      <button className="primary" disabled={!dirty || !!api.busy} onClick={save}>Save side lights</button>
      <button disabled={!!api.busy} onClick={refresh}>Re-read side lights</button>
    </div>
  </section>;
}

function SideLevel({ label, value, disabled, onChange }: { label: string; value: number; disabled: boolean; onChange: (value: number) => void }) {
  const group = useId();
  return <fieldset className="side-field" disabled={disabled}>
    <legend className="field-l">{label} <b>{value}</b></legend>
    <div className="levels side-levels">
      {[0, 1, 2, 3, 4].map((n) => <label key={n}>
        <input type="radio" name={group} value={n} checked={value === n} onChange={() => onChange(n)} />
        <span>{n}</span>
      </label>)}
    </div>
  </fieldset>;
}
