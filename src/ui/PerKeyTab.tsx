import { useEffect, useRef, useState } from 'react';
import { MK75_KEYS } from '../device/mk75Layout';
import { buildLedMatrix, CUSTOM_MODE_INDEX, fromHex, hex, parseProfile, patchProfile, type RGB } from '../protocol/lighting';
import { COLOURWAY_FILLS, colourwayFill, gradient, REGIONS, type GradientDir } from '../protocol/perKeyTools';
import { ImageToKeys } from './ImageToKeys';
import { Keyboard } from './Keyboard';
import { loadPerKey, savePerKey } from './perKeyStore';
import { shareLink } from './presetStore';
import type { DeviceApi } from './useDevice';

const PRESETS = ['#ff0000', '#ff8000', '#ffff00', '#00ff00', '#00ffff', '#0000ff', '#ff00ff', '#ffffff', '#000000'];
const ALL = MK75_KEYS.map((k) => k.index);
const HISTORY_MAX = 50;

export function PerKeyTab({ api }: { api: DeviceApi }) {
  const { snap, dev } = api;
  const [colors, setColors] = useState<Record<number, RGB>>(loadPerKey);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [brush, setBrush] = useState('#00aaff');
  const [picking, setPicking] = useState(false);
  const [gStops, setGStops] = useState(['#ff0055', '#00c8ff']);
  const [gDir, setGDir] = useState<GradientDir>('horizontal');
  const undo = useRef<Record<number, RGB>[]>([]);
  const redo = useRef<Record<number, RGB>[]>([]);
  const [, bump] = useState(0);

  /** Every edit goes through here so it can be undone. */
  const update = (next: Record<number, RGB>) => {
    undo.current = [...undo.current.slice(-HISTORY_MAX + 1), colors];
    redo.current = [];
    setColors(next);
    savePerKey(next);
  };
  const step = (from: React.MutableRefObject<Record<number, RGB>[]>, to: React.MutableRefObject<Record<number, RGB>[]>) => {
    const prev = from.current.pop();
    if (!prev) return;
    to.current.push(colors);
    setColors(prev);
    savePerKey(prev);
    bump((n) => n + 1);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z' || (e.target as HTMLElement)?.tagName === 'INPUT') return;
      e.preventDefault();
      if (e.shiftKey) step(redo, undo);
      else step(undo, redo);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!snap || !dev) return null;

  const targets = () => (sel.size ? [...sel] : ALL);
  const paint = (c: string, keys: Iterable<number> = sel) => {
    const next = { ...colors };
    for (const i of keys) next[i] = fromHex(c);
    update(next);
  };
  const onSelect = (s: Set<number>) => {
    if (picking) {
      const k = [...s][0];
      if (k !== undefined && colors[k]) setBrush(hex(colors[k]));
      setPicking(false);
      return;
    }
    setSel(s);
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
          <span className="muted">
            {picking ? 'Click a key to pick its colour' : sel.size ? `${sel.size} selected` : 'Click or drag to select keys. Shift-click adds to the selection.'}
          </span>
        </header>
        <Keyboard multi={!picking} selected={sel} onSelect={onSelect} fill={(k) => (colors[k.index] ? hex(colors[k.index]) : undefined)} />
        <div className="toolbar">
          <input type="color" value={brush} onChange={(e) => setBrush(e.target.value)} aria-label="Brush colour" />
          {PRESETS.map((p) => (
            <button key={p} className="dot" style={{ background: p }} onClick={() => setBrush(p)} aria-label={`Use ${p}`} />
          ))}
          <button className={picking ? 'primary' : ''} onClick={() => setPicking(!picking)} title="Pick a colour from a key">
            Eyedropper
          </button>
          <span className="sep" />
          <button disabled={!sel.size} onClick={() => paint(brush)}>
            Paint selected
          </button>
          <button onClick={() => setSel(new Set(ALL))}>Select all</button>
          <button onClick={() => paint(brush, ALL)}>Fill all</button>
          <button onClick={() => update({})}>Clear</button>
          <span className="sep" />
          <button disabled={!undo.current.length} onClick={() => step(undo, redo)} title="Undo (Ctrl+Z)">
            Undo
          </button>
          <button disabled={!redo.current.length} onClick={() => step(redo, undo)} title="Redo (Ctrl+Shift+Z)">
            Redo
          </button>
        </div>

        <div className="tool-grid">
          <div className="tool">
            <span className="field-l">Select region</span>
            <div className="chips">
              {REGIONS.map((r) => (
                <button key={r.id} className="chip" onClick={() => setSel(new Set(r.keys))}>
                  {r.name}
                </button>
              ))}
            </div>
          </div>
          <div className="tool">
            <span className="field-l">Gradient {sel.size ? '(selection)' : '(all keys)'}</span>
            <div className="row">
              {gStops.map((c, i) => (
                <input key={i} type="color" value={c} onChange={(e) => setGStops(gStops.map((x, j) => (j === i ? e.target.value : x)))} aria-label={`Gradient colour ${i + 1}`} />
              ))}
              {gStops.length < 3 ? (
                <button onClick={() => setGStops([...gStops, '#ffd000'])}>+ colour</button>
              ) : (
                <button onClick={() => setGStops(gStops.slice(0, 2))}>− colour</button>
              )}
              <select value={gDir} onChange={(e) => setGDir(e.target.value as GradientDir)} aria-label="Gradient direction">
                <option value="horizontal">Left → right</option>
                <option value="vertical">Top → bottom</option>
                <option value="radial">Radial (from first selected key)</option>
              </select>
              <button onClick={() => update({ ...colors, ...gradient(gStops.map(fromHex), gDir, targets(), gDir === 'radial' ? [...sel][0] : undefined) })}>
                Apply gradient
              </button>
            </div>
          </div>
          <div className="tool">
            <span className="field-l">Match a colourway</span>
            <div className="chips">
              {Object.entries(COLOURWAY_FILLS).map(([id, c]) => (
                <button key={id} className="chip" onClick={() => update(colourwayFill(id))}>
                  <span className="chip-dots" aria-hidden>
                    {[c.alpha, c.mod, c.accent].map((x, i) => (
                      <i key={i} style={{ background: hex(x) }} />
                    ))}
                  </span>
                  {c.name}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="actions">
          <button className="primary" disabled={!!api.busy} onClick={apply}>
            Save to keyboard &amp; activate Self-define
          </button>
          <button
            disabled={!Object.keys(colors).length}
            onClick={async () => {
              const url = await shareLink({ v: 1, name: 'Per-key layout', lighting: { mode: CUSTOM_MODE_INDEX, speed: 0, brightness: 4, colorful: false, colorIndex: 0 }, perKey: colors });
              try {
                await navigator.clipboard.writeText(url);
                api.push({ dir: 'info', text: 'Per-key share link copied' });
              } catch {
                window.prompt('Copy this link', url);
              }
            }}
          >
            Share link
          </button>
        </div>
        <p className="hint">
          The keyboard can't send this table back, so the editor keeps your last layout in this browser. LEDs show saturated colours best.
        </p>
      </section>
      <ImageToKeys api={api} onSaved={update} />
    </div>
  );
}
