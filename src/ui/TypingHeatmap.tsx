import { useState } from 'react';
import { keyIndexForCode } from '../device/codeMap';
import { MK75_KEYS } from '../device/mk75Layout';
import { heatmapColours, SAMPLE_TEXTS, scoreTyping, wpm } from '../protocol/heatmap';
import { buildLedMatrix, CUSTOM_MODE_INDEX, hex, parseProfile, patchProfile } from '../protocol/lighting';
import { Keyboard } from './Keyboard';
import { perKeyMap, savePerKey } from './perKeyStore';
import type { DeviceApi } from './useDevice';

const KEY = 'mk75.heatmap.v1';
const loadCounts = (): Record<number, number> => {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    return {};
  }
};
const saveCounts = (c: Record<number, number>) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(c));
  } catch {
    /* ignore */
  }
};

/** Typing test + key-usage heatmap. Only typing inside this box is counted; counts stay in this browser. */
export function TypingHeatmap({ api }: { api?: DeviceApi }) {
  const [counts, setCounts] = useState<Record<number, number>>(loadCounts);
  const [sample, setSample] = useState(0);
  const [typed, setTyped] = useState('');
  const [start, setStart] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const target = SAMPLE_TEXTS[sample];
  const { correct, accuracy } = scoreTyping(target, typed);
  const elapsed = start ? now - start : 0;
  const speed = wpm(correct, elapsed);
  const done = typed.length >= target.length;
  const heat = heatmapColours(counts);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const top = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k, n]) => `${MK75_KEYS.find((x) => x.index === Number(k))?.label ?? k} ${n}`);

  const reset = (next = sample) => {
    setSample(next);
    setTyped('');
    setStart(null);
  };

  const apply = () =>
    api?.dev &&
    api.snap &&
    api.run('Saving heatmap to keyboard', async () => {
      const { dev, snap } = api;
      if (!dev || !snap) return;
      savePerKey(heat);
      await dev.writeLedMatrix(buildLedMatrix(perKeyMap(heat)));
      const st = parseProfile(snap.profile);
      st.activeIndex = CUSTOM_MODE_INDEX;
      await dev.writeProfile(patchProfile(snap.profile, st));
      api.setSnap({ ...snap, profile: await dev.readProfile() });
      api.push({ dir: 'info', text: `Heatmap saved as per-key colours (${Object.keys(heat).length} keys)` });
    });

  return (
    <section className="card">
      <header className="card-h">
        <h2>Typing test &amp; heatmap</h2>
        <span className="muted small">
          {speed} WPM · {accuracy}% accuracy · {total} key presses counted
        </span>
      </header>
      <p className={`typing-target mono${done ? ' done' : ''}`} aria-label="Text to type">
        {[...target].map((ch, i) => (
          <span key={i} className={i < typed.length ? (typed[i] === ch ? 'ok' : 'bad') : i === typed.length ? 'cur' : ''}>
            {ch}
          </span>
        ))}
      </p>
      <textarea
        className="text-input typing-area mono"
        rows={2}
        value={typed}
        placeholder="Click here and type the text above…"
        spellCheck={false}
        onKeyDown={(e) => {
          const idx = keyIndexForCode(e.code);
          if (idx === undefined || e.repeat) return;
          const next = { ...counts, [idx]: (counts[idx] ?? 0) + 1 };
          setCounts(next);
          saveCounts(next);
        }}
        onChange={(e) => {
          if (!start) setStart(performance.now());
          setNow(performance.now());
          setTyped(e.target.value.slice(0, target.length));
        }}
        aria-label="Typing area"
      />
      {done && <p className="hint">Done: {speed} WPM at {accuracy}% accuracy.</p>}
      <div className="row">
        <button onClick={() => reset()}>Restart</button>
        <button onClick={() => reset((sample + 1) % SAMPLE_TEXTS.length)}>Next text</button>
        <span className="sep" />
        <button
          onClick={() => {
            setCounts({});
            saveCounts({});
          }}
          disabled={!total}
        >
          Clear heatmap
        </button>
        {api?.dev && (
          <button className="primary" onClick={apply} disabled={!total || !!api.busy}>
            Save heatmap to keyboard
          </button>
        )}
      </div>
      {total > 0 && (
        <>
          <Keyboard selected={new Set()} onSelect={() => {}} fill={(k) => (heat[k.index] ? hex(heat[k.index]) : undefined)} sublabel={(k) => (counts[k.index] ? String(counts[k.index]) : undefined)} />
          <p className="hint">Most used: {top.join(' · ')}. Blue = rarely used, red = most used.</p>
        </>
      )}
    </section>
  );
}
