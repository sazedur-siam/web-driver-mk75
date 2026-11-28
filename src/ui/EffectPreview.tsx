import { useEffect, useMemo, useRef, useState } from 'react';
import {
  keyIndexForEvent,
  PRESS_LIFE,
  previewFrame,
  randomPress,
  REACTIVE_MODES,
  type PreviewPress,
} from '../protocol/effectPreview';
import { hex, type ModeSettings, type RGB } from '../protocol/lighting';
import { Keyboard } from './Keyboard';
import { loadPerKey, perKeyMap } from './perKeyStore';

const FPS = 30;
const AUTO_EVERY = 0.55; // seconds between simulated presses
const IDLE_BEFORE_AUTO = 3; // seconds after a real press before simulating again
const NO_SELECTION = new Set<number>();

const prefersReducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Animated, approximate on-screen preview of a built-in effect. Draws only; never talks to the keyboard. */
export function EffectPreview({ modeIndex, settings, color }: { modeIndex: number; settings: ModeSettings; color: RGB }) {
  const [playing, setPlaying] = useState(() => !prefersReducedMotion());
  const [t, setT] = useState(1.2);
  const clock = useRef({ t: 1.2, last: 0, nextAuto: 0, lastReal: -Infinity });
  const presses = useRef<PreviewPress[]>([]);
  const perKey = useMemo(() => (modeIndex === 18 ? perKeyMap(loadPerKey()) : undefined), [modeIndex]);
  const reactive = REACTIVE_MODES.has(modeIndex);

  const press = (index: number, real: boolean) => {
    const c = clock.current;
    presses.current = [...presses.current.filter((p) => c.t - p.t < PRESS_LIFE), { index, t: c.t, hue: Math.random() * 360 }];
    if (real) c.lastReal = c.t;
    if (!playing) setT(c.t + 0.001);
  };

  // Animation clock (requestAnimationFrame pauses by itself in hidden tabs).
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const c = clock.current;
    c.last = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (c.last && now - c.last < 1000 / FPS - 2) return;
      c.t += c.last ? Math.min(0.1, (now - c.last) / 1000) : 0;
      c.last = now;
      if (reactive && c.t - c.lastReal > IDLE_BEFORE_AUTO && c.t >= c.nextAuto) {
        presses.current = [...presses.current.filter((p) => c.t - p.t < PRESS_LIFE), randomPress(c.t)];
        c.nextAuto = c.t + AUTO_EVERY;
      }
      setT(c.t);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, reactive]);

  // Typing on any keyboard drives the reactive effects (ignored while typing into a field).
  useEffect(() => {
    if (!reactive) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || (e.target as Element)?.closest?.('input, textarea, select, [contenteditable]')) return;
      const index = keyIndexForEvent(e.code, e.keyCode);
      if (index !== undefined) press(index, true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const frame = previewFrame({ modeIndex, settings, color, t, presses: presses.current, perKey });

  return (
    <div className="effect-preview">
      <div className="effect-preview-kb">
        <Keyboard
          selected={NO_SELECTION}
          onSelect={(s) => s.forEach((i) => press(i, true))}
          fill={(k) => {
            const c = frame.get(k.index);
            return c ? hex(c) : undefined;
          }}
        />
      </div>
      <div className="effect-preview-bar">
        <span className="hint">
          {modeIndex === 18
            ? 'Shows the colours saved in the Per-key RGB editor.'
            : reactive
              ? 'Preview: type or click a key to try it.'
              : 'Preview: an approximation of the effect on the keyboard.'}
        </span>
        <button className="small" onClick={() => setPlaying(!playing)} aria-pressed={!playing}>
          {playing ? 'Pause' : 'Play'}
        </button>
      </div>
    </div>
  );
}
