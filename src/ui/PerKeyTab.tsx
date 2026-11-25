import { useState } from 'react';
import { MK75_KEYS } from '../device/mk75Layout';
import { buildLedMatrix, CUSTOM_MODE_INDEX, fromHex, hex, parseProfile, patchProfile, type RGB } from '../protocol/lighting';
import { Keyboard } from './Keyboard';
import { loadPerKey, savePerKey } from './perKeyStore';
import type { DeviceApi } from './useDevice';

const load = loadPerKey;
const save = savePerKey;

const PRESETS = ['#ff0000', '#ff8000', '#ffff00', '#00ff00', '#00ffff', '#0000ff', '#ff00ff', '#ffffff', '#000000'];

export function PerKeyTab({ api }: { api: DeviceApi }) {
  const { snap, dev } = api;
  const [colors, setColors] = useState<Record<number, RGB>>(load);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [brush, setBrush] = useState('#00aaff');

  if (!snap || !dev) return null;

  const update = (next: Record<number, RGB>) => {
    setColors(next);
    save(next);
  };
  const paint = (c: string, targets: Iterable<number> = sel) => {
    const next = { ...colors };
    for (const i of targets) next[i] = fromHex(c);
    update(next);
  };

  const apply = () =>
    api.run('Saving per-key colours', async () => {
      const map = new Map<number, RGB>(Object.entries(colors).map(([k, v]) => [Number(k), v]));
      await dev.writeLedMatrix(buildLedMatrix(map));
      const st = parseProfile(snap.profile);
      st.activeIndex = CUSTOM_MODE_INDEX;
      await dev.writeProfile(patchProfile(snap.profile, st));
      api.setSnap({ ...snap, profile: await dev.readProfile() });
      api.push({ dir: 'info', text: `Per-key colours saved (${map.size} keys) and Self-define activated` });
    });

  return (
    <div className="stack">
      <section className="card">
        <header className="card-h">
          <h2>Per-key colours</h2>
          <span className="muted">{sel.size ? `${sel.size} selected` : 'Click or drag to select keys. Shift-click adds to the selection.'}</span>
        </header>
        <Keyboard
          multi
          selected={sel}
          onSelect={setSel}
          fill={(k) => (colors[k.index] ? hex(colors[k.index]) : undefined)}
        />
        <div className="toolbar">
          <input type="color" value={brush} onChange={(e) => setBrush(e.target.value)} aria-label="Brush colour" />
          {PRESETS.map((p) => (
            <button key={p} className="dot" style={{ background: p }} onClick={() => setBrush(p)} aria-label={`Use ${p}`} />
          ))}
          <span className="sep" />
          <button disabled={!sel.size} onClick={() => paint(brush)}>
            Paint selected
          </button>
          <button onClick={() => setSel(new Set(MK75_KEYS.map((k) => k.index)))}>Select all</button>
          <button onClick={() => paint(brush, MK75_KEYS.map((k) => k.index))}>Fill all</button>
          <button onClick={() => update({})}>Clear</button>
        </div>
        <div className="actions">
          <button className="primary" disabled={!!api.busy} onClick={apply}>
            Save to keyboard &amp; activate Self-define
          </button>
        </div>
        <p className="hint">
          The vendor driver never reads this table back from the keyboard, so this editor keeps your last layout in this browser.
        </p>
      </section>
    </div>
  );
}
