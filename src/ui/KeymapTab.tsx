import { useEffect, useMemo, useRef, useState } from 'react';
import { MK75_KEYS } from '../device/mk75Layout';
import {
  actionFromKeyboardEvent,
  CONSUMER_KEYS,
  decodeAction,
  describeAction,
  encodeAction,
  getKeyCode,
  HID_KEYS,
  HID_MODIFIERS,
  MOD,
  MOUSE_BUTTONS,
  setKeyCode,
  SHORTCUTS,
  type KeyAction,
} from '../protocol/keycodes';
import { vkToHid } from '../protocol/mock';
import { Keyboard } from './Keyboard';
import type { DeviceApi } from './useDevice';

function defaultAction(index: number): KeyAction | null {
  const k = MK75_KEYS.find((x) => x.index === index);
  if (!k || k.vk === 0xfa) return null; // Fn key: firmware-handled, never remap
  const hid = vkToHid(k.vk);
  return hid === undefined ? null : { kind: 'key', usage: hid, mods: 0 };
}

const FN_INDEX = MK75_KEYS.find((k) => k.vk === 0xfa)?.index;

export function KeymapTab({ api }: { api: DeviceApi }) {
  const { snap, dev } = api;
  const [matrix, setMatrix] = useState<Uint8Array | null>(snap?.matrix ?? null);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [capture, setCapture] = useState(false);
  const [mods, setMods] = useState(0);
  const [keySel, setKeySel] = useState('');

  useEffect(() => setMatrix(snap?.matrix ?? null), [snap]);

  const changed = useMemo(() => {
    if (!snap || !matrix) return new Set<number>();
    return new Set(MK75_KEYS.filter((k) => getKeyCode(snap.matrix, k.index) !== getKeyCode(matrix, k.index)).map((k) => k.index));
  }, [snap, matrix]);

  const assignRef = useRef<(a: KeyAction) => void>(() => {});

  useEffect(() => {
    if (!capture) return;
    let done = false;
    const isMod = (code: string) => HID_MODIFIERS.some((m) => m.code === code);
    const finish = (a: KeyAction | null) => {
      done = true;
      if (a) assignRef.current(a);
      setCapture(false);
    };
    // Modifiers held with a main key form a combo; a modifier pressed and released alone is assigned by itself.
    const onDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (done || isMod(e.code)) return;
      finish(actionFromKeyboardEvent(e));
    };
    const onUp = (e: KeyboardEvent) => {
      if (done || !isMod(e.code)) return;
      e.preventDefault();
      finish(actionFromKeyboardEvent({ code: e.code, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false }));
    };
    window.addEventListener('keydown', onDown, true);
    window.addEventListener('keyup', onUp, true);
    return () => {
      window.removeEventListener('keydown', onDown, true);
      window.removeEventListener('keyup', onUp, true);
    };
  }, [capture]);

  if (!snap || !dev || !matrix) return null;
  const index = [...sel][0];
  const key = MK75_KEYS.find((k) => k.index === index);
  const current = index !== undefined ? decodeAction(getKeyCode(matrix, index)) : null;
  const isFn = index === FN_INDEX;

  function assign(a: KeyAction) {
    if (index === undefined || isFn || !matrix) return;
    setMatrix(setKeyCode(matrix, index, encodeAction(a)));
  }
  assignRef.current = assign;

  const save = () =>
    api.run('Saving key mapping', async () => {
      await dev.writeKeyMatrix(matrix);
      const back = await dev.readKeyMatrix();
      api.setSnap({ ...snap, matrix: back });
      api.push({ dir: 'info', text: `Key mapping saved (${changed.size} keys changed)` });
    });

  return (
    <div className="stack">
      <section className="card">
        <header className="card-h">
          <h2>Key mapping (base layer)</h2>
          <span className="muted">{changed.size ? `${changed.size} unsaved change${changed.size > 1 ? 's' : ''}` : 'Select a key to remap it.'}</span>
        </header>
        <Keyboard
          selected={sel}
          onSelect={setSel}
          highlight={(k) => changed.has(k.index)}
          sublabel={(k) => {
            if (k.index === FN_INDEX) return undefined;
            const a = decodeAction(getKeyCode(matrix, k.index));
            const d = defaultAction(k.index);
            return d && encodeAction(d) === encodeAction(a) ? undefined : describeAction(a);
          }}
        />
        <div className="actions">
          <button className="primary" disabled={!changed.size || !!api.busy} onClick={save}>
            Save to keyboard
          </button>
          <button disabled={!changed.size} onClick={() => setMatrix(snap.matrix)}>
            Revert all
          </button>
        </div>
      </section>

      {key && (
        <section className="card">
          <header className="card-h">
            <h2>
              {key.label} <span className="muted">→ {current ? describeAction(current) : '—'}</span>
            </h2>
            <span className="muted mono">matrix #{key.index}</span>
          </header>
          {isFn ? (
            <p className="muted">Fn is handled by the firmware and can't be remapped.</p>
          ) : (
            <div className="assign">
              <div className="field">
                <span className="field-l">Press a key or combination</span>
                <button className={capture ? 'capture on' : 'capture'} onClick={() => setCapture(!capture)}>
                  {capture ? 'Listening… press a key or combination' : 'Click, then press'}
                </button>
              </div>
              <div className="field">
                <span className="field-l">Keyboard key</span>
                <div className="row">
                  {(['LCtrl', 'LShift', 'LAlt', 'LGui'] as const).map((m) => (
                    <label key={m} className="chk">
                      <input type="checkbox" checked={!!(mods & MOD[m])} onChange={(e) => setMods(e.target.checked ? mods | MOD[m] : mods & ~MOD[m])} />
                      {m.slice(1).replace('Gui', 'Win')}
                    </label>
                  ))}
                  <select value={keySel} onChange={(e) => setKeySel(e.target.value)} aria-label="Key">
                    <option value="">Choose key…</option>
                    {HID_KEYS.map((k) => (
                      <option key={k.code} value={k.usage}>
                        {k.label}
                      </option>
                    ))}
                    {HID_MODIFIERS.map((k) => (
                      <option key={k.code} value={`m${k.usage}`}>
                        {k.label}
                      </option>
                    ))}
                  </select>
                  <button
                    disabled={!keySel}
                    onClick={() =>
                      assign(keySel.startsWith('m') ? { kind: 'modifier', usage: Number(keySel.slice(1)) } : { kind: 'key', usage: Number(keySel), mods })
                    }
                  >
                    Assign
                  </button>
                </div>
              </div>
              <Picker label="Media" items={CONSUMER_KEYS.map((c) => ({ label: c.label, a: { kind: 'consumer', usage: c.usage } as KeyAction }))} onPick={assign} />
              <Picker label="Mouse" items={MOUSE_BUTTONS.map((l, i) => ({ label: l, a: { kind: 'mouse', button: i } as KeyAction }))} onPick={assign} />
              <Picker label="Shortcuts" items={SHORTCUTS.map((s) => ({ label: s.label, a: { kind: 'key', usage: s.usage, mods: s.mods } as KeyAction }))} onPick={assign} />
              <div className="row">
                <button onClick={() => assign({ kind: 'disabled' })}>Disable key</button>
                <button
                  disabled={!defaultAction(index)}
                  onClick={() => {
                    const d = defaultAction(index);
                    if (d) assign(d);
                  }}
                >
                  Reset to default
                </button>
                <button onClick={() => setMatrix(setKeyCode(matrix, index, getKeyCode(snap.matrix, index)))}>Undo this key</button>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function Picker({ label, items, onPick }: { label: string; items: { label: string; a: KeyAction }[]; onPick: (a: KeyAction) => void }) {
  return (
    <div className="field">
      <span className="field-l">{label}</span>
      <div className="chips">
        {items.map((it) => (
          <button key={it.label} className="chip" onClick={() => onPick(it.a)}>
            {it.label}
          </button>
        ))}
      </div>
    </div>
  );
}
