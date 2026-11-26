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
import { LAYOUTS, layoutActions, type LayoutTweaks } from '../protocol/layouts';
import { Keyboard } from './Keyboard';
import { REPEAT_LABELS, STORE_REPEAT_LABELS } from './MacrosTab';
import { macroStore, useMacros } from './macroStore';
import { saveKeysAndMacros, withMacroCodes } from './saveKeys';
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
  const macros = useMacros();
  const [macroSel, setMacroSel] = useState('');
  const [macroMode, setMacroMode] = useState<number>(1);
  // Assignments as they were when the tab opened, so "Revert all" can restore them too.
  const [savedAssignments] = useState(() => macroStore.get().assignments);
  const [layoutId, setLayoutId] = useState('qwerty');
  const [tweaks, setTweaks] = useState<LayoutTweaks>({});

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
    if (macros.assignments[index]) macroStore.assign(index, null);
    setMatrix(withMacroCodes(setKeyCode(matrix, index, encodeAction(a))).matrix);
  }
  assignRef.current = assign;

  function assignMacro() {
    if (index === undefined || isFn || !matrix || !macroSel) return;
    macroStore.assign(index, { macroId: macroSel, mode: macroMode as 1 | 2 | 4 });
    setMatrix(withMacroCodes(matrix).matrix);
  }

  const macroName = (keyIndex: number) => {
    const a = macros.assignments[keyIndex];
    return a ? macros.macros.find((m) => m.id === a.macroId)?.name : undefined;
  };
  const describe = (keyIndex: number) => {
    const a = decodeAction(getKeyCode(matrix, keyIndex));
    if (a.kind === 'macro') return macroName(keyIndex) ?? `Macro (set elsewhere)`;
    return describeAction(a);
  };
  const foreignMacros = MK75_KEYS.filter((k) => decodeAction(getKeyCode(matrix, k.index)).kind === 'macro' && !macros.assignments[k.index]);

  const save = () => api.run('Saving key mapping', () => saveKeysAndMacros(api, matrix));

  /** Preview a hardware layout + tweaks on the pending matrix (saved with the normal Save button). */
  function previewLayout(id = layoutId, t = tweaks) {
    if (!matrix) return;
    let m = matrix;
    for (const [idx, action] of layoutActions(id, t)) {
      if (macros.assignments[idx]) macroStore.assign(idx, null);
      m = setKeyCode(m, idx, encodeAction(action));
    }
    setMatrix(m);
  }

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
            return d && encodeAction(d) === encodeAction(a) ? undefined : describe(k.index);
          }}
        />
        <div className="layout-row">
          <label className="field-l" htmlFor="layout-select">
            Layout
          </label>
          <select
            id="layout-select"
            value={layoutId}
            onChange={(e) => {
              setLayoutId(e.target.value);
              previewLayout(e.target.value, tweaks);
            }}
          >
            {LAYOUTS.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
          {(
            [
              ['macSwap', 'Mac: Ctrl · Option · Cmd'],
              ['capsToCtrl', 'Caps Lock → Ctrl'],
              ['capsToEsc', 'Caps Lock → Esc'],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="chk">
              <input
                type="checkbox"
                checked={!!tweaks[k]}
                onChange={(e) => {
                  const t = { ...tweaks, [k]: e.target.checked };
                  if (k === 'capsToCtrl' && e.target.checked) t.capsToEsc = false;
                  if (k === 'capsToEsc' && e.target.checked) t.capsToCtrl = false;
                  setTweaks(t);
                  previewLayout(layoutId, t);
                }}
              />
              {label}
            </label>
          ))}
          <span className="hint">Stored in the keyboard: keep your computer on US QWERTY. Review the highlighted keys, then Save.</span>
        </div>
        <div className="actions">
          <button className="primary" disabled={!changed.size || !!api.busy} onClick={save}>
            Save to keyboard
          </button>
          <button
            disabled={!changed.size}
            onClick={() => {
              macroStore.replaceAll({ ...macroStore.get(), assignments: savedAssignments });
              setMatrix(snap.matrix);
            }}
          >
            Revert all
          </button>
        </div>
        {foreignMacros.length > 0 && (
          <p className="hint warn">
            {foreignMacros.map((k) => k.label).join(', ')} {foreignMacros.length > 1 ? 'have' : 'has'} a macro that wasn't made in this browser.
            Saving macros from here overwrites the keyboard's macro storage, so reassign or reset those keys.
          </p>
        )}
      </section>

      {key && (
        <section className="card">
          <header className="card-h">
            <h2>
              {key.label} <span className="muted">→ {current ? describe(key.index) : '—'}</span>
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
              <div className="field">
                <span className="field-l">Macro</span>
                {!dev.caps.macros ? (
                  <p className="hint">Macros are not supported on this receiver type. Connect the USB cable.</p>
                ) : macros.macros.length === 0 ? (
                  <p className="hint">Create macros on the Macros tab first.</p>
                ) : (
                  <div className="row">
                    <select value={macroSel} onChange={(e) => setMacroSel(e.target.value)} aria-label="Macro">
                      <option value="">Choose macro…</option>
                      {macros.macros.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                    <select value={macroMode} onChange={(e) => setMacroMode(Number(e.target.value))} aria-label="Repeat mode">
                      {(dev.caps.macros === 'store' ? STORE_REPEAT_LABELS : REPEAT_LABELS).map((r) => (
                        <option key={r.mode} value={r.mode}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                    <button disabled={!macroSel} onClick={assignMacro}>
                      Assign macro
                    </button>
                  </div>
                )}
              </div>
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
