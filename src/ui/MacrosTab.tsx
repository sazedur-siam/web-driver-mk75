import { useEffect, useRef, useState } from 'react';
import { MK75_KEYS } from '../device/mk75Layout';
import { HID_KEYS, HID_MODIFIERS } from '../protocol/keycodes';
import { MACRO_SLOT, MAX_MACROS, macroBytes, MOUSE_USAGE, RepeatMode, type Macro, type MacroEvent } from '../protocol/macro';
import { macroStore, newId, useMacros } from './macroStore';
import { saveKeysAndMacros } from './saveKeys';
import type { DeviceApi } from './useDevice';

const CODE_TO_USAGE = new Map<string, number>([...HID_KEYS.map((k) => [k.code, k.usage] as const), ...HID_MODIFIERS.map((m) => [m.code, m.usage] as const)]);
const USAGE_LABEL = new Map<number, string>([
  ...HID_KEYS.map((k) => [k.usage, k.label] as const),
  ...HID_MODIFIERS.map((m) => [m.usage, m.label] as const),
  [MOUSE_USAGE.left, 'Mouse left'],
  [MOUSE_USAGE.right, 'Mouse right'],
  [MOUSE_USAGE.middle, 'Mouse middle'],
]);
const MOUSE_BTN: Record<number, number> = { 0: MOUSE_USAGE.left, 1: MOUSE_USAGE.middle, 2: MOUSE_USAGE.right };

export const REPEAT_LABELS: { mode: (typeof RepeatMode)[keyof typeof RepeatMode]; label: string }[] = [
  { mode: RepeatMode.Once, label: 'Play once' },
  { mode: RepeatMode.UntilReleased, label: 'Repeat while held' },
  { mode: RepeatMode.UntilAnyKey, label: 'Repeat until any key' },
];

export function MacrosTab({ api }: { api: DeviceApi }) {
  const store = useMacros();
  const [editing, setEditing] = useState<Macro | null>(store.macros[0] ?? null);
  const [recording, setRecording] = useState(false);
  const [recordDelays, setRecordDelays] = useState(true);
  const [fixedDelay, setFixedDelay] = useState(20);
  const lastT = useRef(0);
  const evRef = useRef<MacroEvent[]>([]);

  /** Append an event; the previous event's delay becomes the time since it happened. */
  const recordEvent = (usage: number, down: boolean) => {
    const now = performance.now();
    const list = evRef.current;
    if (list.length) list[list.length - 1].delay = recordDelays ? Math.min(60000, Math.round(now - lastT.current)) : fixedDelay;
    lastT.current = now;
    list.push({ usage, down, delay: recordDelays ? 10 : fixedDelay });
    setEditing((e) => (e ? { ...e, events: [...list] } : e));
  };
  const recordRef = useRef(recordEvent);
  recordRef.current = recordEvent;

  useEffect(() => {
    if (!recording) return;
    const push = (usage: number, down: boolean) => recordRef.current(usage, down);
    const kd = (e: KeyboardEvent) => {
      e.preventDefault();
      if (e.repeat) return;
      const u = CODE_TO_USAGE.get(e.code);
      if (u !== undefined) push(u, true);
    };
    const ku = (e: KeyboardEvent) => {
      e.preventDefault();
      const u = CODE_TO_USAGE.get(e.code);
      if (u !== undefined) push(u, false);
    };
    window.addEventListener('keydown', kd, true);
    window.addEventListener('keyup', ku, true);
    return () => {
      window.removeEventListener('keydown', kd, true);
      window.removeEventListener('keyup', ku, true);
    };
  }, [recording]);

  const assignedKeys = (id: string) =>
    Object.entries(store.assignments)
      .filter(([, a]) => a.macroId === id)
      .map(([k]) => MK75_KEYS.find((x) => x.index === Number(k))?.label ?? `#${k}`);

  const startRecord = () => {
    if (!editing) return;
    evRef.current = [];
    lastT.current = performance.now();
    setEditing({ ...editing, events: [] });
    setRecording(true);
  };
  const stopRecord = () => setRecording(false);
  const saveMacro = () => editing && macroStore.upsert(editing);
  const newMacro = () => {
    if (store.macros.length >= MAX_MACROS) return;
    const m = { id: newId(), name: `Macro ${store.macros.length + 1}`, events: [] };
    macroStore.upsert(m);
    setEditing(m);
  };
  const setEv = (i: number, patch: Partial<MacroEvent>) =>
    editing && setEditing({ ...editing, events: editing.events.map((e, j) => (j === i ? { ...e, ...patch } : e)) });
  const delEv = (i: number) => editing && setEditing({ ...editing, events: editing.events.filter((_, j) => j !== i) });

  const bytes = editing ? macroBytes(editing.events) : 0;
  const dirty = editing && JSON.stringify(store.macros.find((m) => m.id === editing.id)) !== JSON.stringify(editing);
  const assignedCount = Object.keys(store.assignments).length;

  const writeAll = () =>
    api.snap &&
    api.run('Writing macros', async () => {
      if (editing && dirty) macroStore.upsert(editing);
      await saveKeysAndMacros(api, api.snap!.matrix);
    });

  return (
    <div className="panel-grid">
      <section className="card">
        <header className="card-h">
          <h2>Macros</h2>
          <span className="muted">
            {store.macros.length}/{MAX_MACROS}
          </span>
        </header>
        <div className="macro-list">
          {store.macros.length === 0 && <p className="muted">No macros yet.</p>}
          {store.macros.map((m) => (
            <button key={m.id} className={`macro-item${editing?.id === m.id ? ' on' : ''}`} onClick={() => !recording && setEditing(m)}>
              <b>{m.name}</b>
              <span className="muted small">
                {m.events.length} events{assignedKeys(m.id).length ? ` · on ${assignedKeys(m.id).join(', ')}` : ''}
              </span>
            </button>
          ))}
        </div>
        <div className="actions">
          <button onClick={newMacro} disabled={recording || store.macros.length >= MAX_MACROS}>
            New macro
          </button>
          <button className="primary" onClick={writeAll} disabled={!!api.busy || recording || assignedCount === 0}>
            Write macros to keyboard
          </button>
        </div>
        <p className="hint">
          Assign macros to keys on the <b>Key mapping</b> tab. The keyboard can't send macros back, so they're kept in this browser
          (include them in a backup).
        </p>
      </section>

      {editing && (
        <section className="card">
          <header className="card-h">
            <input className="name-input" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} aria-label="Macro name" />
            <button className="danger-link" onClick={() => { macroStore.remove(editing.id); setEditing(null); }} disabled={recording}>
              Delete
            </button>
          </header>
          <div className="row">
            {recording ? (
              <button className="primary rec" onClick={stopRecord}>
                ■ Stop recording
              </button>
            ) : (
              <button className="primary" onClick={startRecord}>
                ● Record
              </button>
            )}
            <label className="chk">
              <input type="checkbox" checked={recordDelays} onChange={(e) => setRecordDelays(e.target.checked)} disabled={recording} /> record delays
            </label>
            {!recordDelays && (
              <label className="chk">
                fixed <input type="number" min={3} max={60000} value={fixedDelay} onChange={(e) => setFixedDelay(Number(e.target.value))} style={{ width: 70 }} /> ms
              </label>
            )}
          </div>
          {recording && (
            <div
              className="mouse-pad"
              onMouseDown={(e) => {
                e.preventDefault();
                if (MOUSE_BTN[e.button]) recordEvent(MOUSE_BTN[e.button], true);
              }}
              onMouseUp={(e) => {
                e.preventDefault();
                if (MOUSE_BTN[e.button]) recordEvent(MOUSE_BTN[e.button], false);
              }}
              onContextMenu={(e) => e.preventDefault()}
            >
              Type on your keyboard, or click here to record mouse buttons (left / middle / right)
            </div>
          )}
          <div className="capacity" title="Bytes used in the 128-byte macro slot">
            <div style={{ width: `${Math.min(100, (bytes / MACRO_SLOT) * 100)}%` }} className={bytes > MACRO_SLOT - 2 ? 'over' : ''} />
            <span className="small muted">
              {bytes}/{MACRO_SLOT} bytes
            </span>
          </div>
          <div className="events">
            {editing.events.length === 0 && <p className="muted">Press Record, then type the sequence.</p>}
            {editing.events.map((ev, i) => (
              <div key={i} className="event">
                <span className={`ev-dir ${ev.down ? 'down' : 'up'}`}>{ev.down ? '↓' : '↑'}</span>
                <span className="ev-key">{USAGE_LABEL.get(ev.usage) ?? `0x${ev.usage.toString(16)}`}</span>
                <label className="small muted">
                  then wait{' '}
                  <input type="number" min={3} max={6553500} value={ev.delay} onChange={(e) => setEv(i, { delay: Math.max(0, Number(e.target.value)) })} /> ms
                </label>
                <button className="x-btn" onClick={() => delEv(i)} aria-label="Remove event">
                  ×
                </button>
              </div>
            ))}
          </div>
          <div className="actions">
            <button className="primary" onClick={saveMacro} disabled={!dirty || recording}>
              Save macro
            </button>
            <button onClick={() => setEditing(store.macros.find((m) => m.id === editing.id) ?? editing)} disabled={!dirty || recording}>
              Revert
            </button>
          </div>
          <p className="hint">Wired MK75 macros support keyboard keys, modifiers and left/right/middle mouse buttons (about 60 events).</p>
        </section>
      )}
    </div>
  );
}
