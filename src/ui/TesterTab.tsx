import { useEffect, useReducer, useRef, useState } from 'react';
import { keyIndexForCode } from '../device/codeMap';
import { MK75_KEYS } from '../device/mk75Layout';
import { ChatterDetector } from '../protocol/chatter';
import { Keyboard } from './Keyboard';
import { TypingHeatmap } from './TypingHeatmap';
import type { DeviceApi } from './useDevice';

const TESTABLE = MK75_KEYS.filter((k) => k.label !== 'FN');
const label = (idx: number) => MK75_KEYS.find((k) => k.index === idx)?.label ?? `#${idx}`;

/** Key tester & chatter check. Works without a keyboard connection (uses normal key events). */
export function TesterTab({ api }: { api?: DeviceApi }) {
  const det = useRef(new ChatterDetector(30));
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const [active, setActive] = useState(true);
  const [threshold, setThreshold] = useState(30);
  const [last, setLast] = useState<string>('');
  det.current.thresholdMs = threshold;

  useEffect(() => {
    if (!active) return;
    const inTyping = (e: KeyboardEvent) => !!(e.target as HTMLElement | null)?.closest?.('.typing-area');
    const down = (e: KeyboardEvent) => {
      if (inTyping(e)) return;
      const idx = keyIndexForCode(e.code);
      if (idx === undefined) return;
      e.preventDefault();
      const gap = det.current.keyDown(idx, e.timeStamp);
      setLast(gap !== null ? `${label(idx)} chattered (${gap} ms)` : `${label(idx)} pressed`);
      redraw();
    };
    const up = (e: KeyboardEvent) => {
      if (inTyping(e)) return;
      const idx = keyIndexForCode(e.code);
      if (idx === undefined) return;
      e.preventDefault();
      det.current.keyUp(idx, e.timeStamp);
      redraw();
    };
    const blur = () => {
      det.current.down.clear();
      redraw();
    };
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down, true);
      window.removeEventListener('keyup', up, true);
      window.removeEventListener('blur', blur);
    };
  }, [active]);

  const d = det.current;
  const tested = TESTABLE.filter((k) => (d.keys.get(k.index)?.presses ?? 0) > 0).length;
  const chatter = d.chattering;
  const fill = (idx: number) => {
    if (d.down.has(idx)) return 'var(--key-held, var(--accent))';
    const s = d.keys.get(idx);
    if (!s) return undefined;
    if (s.chatter.length) return '#e5484d';
    return 'var(--key-tested, color-mix(in srgb, var(--ok) 55%, var(--cap-alpha)))';
  };

  return (
    <div className="stack">
      <section className="card">
        <header className="card-h">
          <h2>Key tester</h2>
          <span className="muted">
            {tested}/{TESTABLE.length} keys tested{tested === TESTABLE.length ? ' ✓' : ''}
          </span>
        </header>
        <Keyboard
          selected={new Set()}
          onSelect={() => {}}
          fill={(k) => fill(k.index)}
          sublabel={(k) => {
            const s = d.keys.get(k.index);
            return s ? `${s.presses}×` : undefined;
          }}
        />
        <div className="row">
          <button className={active ? 'primary' : ''} onClick={() => setActive(!active)}>
            {active ? '■ Pause capture' : '▶ Resume capture'}
          </button>
          <button onClick={() => { d.reset(); setLast(''); redraw(); }}>Reset</button>
          <label className="field" style={{ minWidth: 220 }}>
            <span className="field-l">
              Chatter threshold <b>{threshold} ms</b>
            </span>
            <input type="range" min={5} max={80} step={1} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} />
          </label>
          <span className="muted small" aria-live="polite">{last}</span>
        </div>
        <p className="hint">
          Press every key. Green = works, red = chatter (a second press registered within the threshold after release).
          Fn, media and some OS keys (Win, Print Screen) can't be seen by the browser. Pause capture to type elsewhere.
        </p>
      </section>
      <TypingHeatmap api={api} />
      <section className="card">
        <h2>Chatter report</h2>
        {chatter.length === 0 ? (
          <p className="muted">No chatter detected{tested ? ` across ${tested} keys` : ''}.</p>
        ) : (
          <dl className="shortcuts">
            {chatter.map(({ key, gaps }) => (
              <div key={key}>
                <dt>
                  <kbd>{label(key)}</kbd>
                </dt>
                <dd>
                  {gaps.length}× · {gaps.slice(-6).join(' ms, ')} ms. Re-seat or replace this switch.
                </dd>
              </div>
            ))}
          </dl>
        )}
      </section>
    </div>
  );
}
