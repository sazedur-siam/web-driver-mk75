import { useEffect, useRef, useState } from 'react';
import { toHex } from './profileStore';
import {
  actionLabel,
  byteLabel,
  describeOffset,
  diffReads,
  GUIDE,
  hex2,
  judgeKey,
  probeResultsFile,
  summarise,
  type ProbeRead,
  type ProbeSignal,
} from './sideLightProbe';
import type { DeviceApi } from './useDevice';

const POLL_MS = 800;
/** After this long without a detected press, offer "I pressed it, nothing was detected". */
const NUDGE_MS = 8000;
/**
 * After a press, keep reading until two reads in a row agree, for at least SETTLE_MIN_MS and at most
 * SETTLE_MAX_MS. A real MK75 sends its input reports at once but updates the config block a moment later; reading
 * once 500 ms after the press credited changes to the next step.
 */
const SETTLE_POLL_MS = 400;
const SETTLE_MIN_MS = 1500;
const SETTLE_MAX_MS = 4000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const appVersion = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';

/** Download the probe on its own; needs no device, so it also works while the keyboard is unplugged. */
function downloadResults(file: ReturnType<typeof probeResultsFile>) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  const d = new Date(file.created);
  const p2 = (n: number) => String(n).padStart(2, '0');
  // Local time, so the name matches the clock of whoever saved it.
  a.download = `mk75-side-light-probe-${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

const SIGNAL_TEXT: Record<ProbeSignal, string> = {
  bytes: 'detected: a byte changed',
  hid: 'detected: the keyboard sent a message',
  key: 'detected: the computer saw the key',
  none: 'not detected (you confirmed the press)',
};

function changesText(reads: ProbeRead[], i: number) {
  const changes = diffReads(reads[i - 1], reads[i]);
  if (changes.length === 0) return 'no bytes changed';
  const shown = changes.slice(0, 6).map((c) => `${byteLabel(c.block, c.offset)} ${hex2(c.from)} → ${hex2(c.to)}`);
  if (changes.length > 6) shown.push(`… ${changes.length - 6} more`);
  return shown.join(', ');
}

/**
 * Guided, read-only side-light probe inside "Contribute device data". Each step tells the user which shortcut to
 * press and only moves on when the page detects it: a byte change in any readable block (polled), an input report
 * from the vendor interface, or the key event itself. If nothing is detectable, the user can confirm the press.
 * Stays mounted while the keyboard is unplugged, so the re-plug step can finish after the automatic reconnect.
 */
export function SideLightProbePanel({ api, reads, setReads }: { api: DeviceApi; reads: ProbeRead[]; setReads: (r: ProbeRead[]) => void }) {
  const dev = api.dev?.readRawBlocks ? api.dev : null;
  /** -1 = not started, GUIDE.length = finished. */
  const [step, setStep] = useState(-1);
  const [wrongKey, setWrongKey] = useState<string | null>(null);
  const [nudge, setNudge] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [settling, setSettling] = useState(false);
  const readsRef = useRef(reads);
  readsRef.current = reads;
  const seen = useRef<{ hid: string[]; keys: string[] }>({ hid: [], keys: [] });
  const replugFrom = useRef<unknown>(null);
  /** The connection the test started on, for the results file (the device may be gone when saving). */
  const connection = useRef<{ kind: string; flavour: string; transport: string } | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  /** The step already recorded: the poll, a keyboard message and the user's button can all finish the same step. */
  const recordedFor = useRef(-2);

  const cur = step >= 0 && step < GUIDE.length ? GUIDE[step] : null;

  const record = (blocks: Record<string, Uint8Array>, signal?: ProbeSignal) => {
    if (recordedFor.current === step) return;
    recordedFor.current = step;
    const action = step < 0 ? 'baseline' : GUIDE[step].action;
    const extra = signal ? { signal, hid: [...seen.current.hid], keys: [...seen.current.keys] } : {};
    setReads([...readsRef.current, { t: Date.now(), action, blocks, ...extra }]);
    setStep((s) => s + 1);
  };

  const save = () => {
    downloadResults(probeResultsFile(readsRef.current, connection.current, appVersion));
    setSavedAt(readsRef.current.length);
  };

  /** Read now and record (start, Ready, "I pressed it"). */
  const readAndRecord = async (signal?: ProbeSignal) => {
    if (!dev) return;
    if (step < 0) {
      const flavour = (dev as { flavour?: string }).flavour ?? 'cdev916';
      connection.current = { kind: dev.kind, flavour, transport: dev.transport.name };
    }
    setWorking(true);
    try {
      record(await dev.readRawBlocks!(), signal);
      setError(null);
    } catch (e) {
      setError(errText(e));
    } finally {
      setWorking(false);
    }
  };

  // A press step: watch for the press, then record the blocks and move on.
  useEffect(() => {
    if (!cur || cur.kind !== 'press' || !dev) return;
    const ref = readsRef.current[readsRef.current.length - 1];
    let finished = false;
    let cancelled = false;
    seen.current = { hid: [], keys: [] };
    setWrongKey(null);
    setNudge(false);
    setSettling(false);

    const same = (a: Record<string, Uint8Array>, b: Record<string, Uint8Array>) => diffReads({ ...ref, blocks: a }, { ...ref, blocks: b }).length === 0;
    /** Read until the keyboard has finished updating its blocks (see SETTLE_MIN_MS). */
    const settle = async () => {
      const start = Date.now();
      let prev = await dev.readRawBlocks!();
      for (;;) {
        await sleep(SETTLE_POLL_MS);
        if (cancelled) return prev;
        const next = await dev.readRawBlocks!();
        const elapsed = Date.now() - start;
        if ((same(prev, next) && elapsed >= SETTLE_MIN_MS) || elapsed >= SETTLE_MAX_MS) return next;
        prev = next;
      }
    };

    const finish = async (signal: ProbeSignal) => {
      if (finished) return;
      finished = true;
      setSettling(true);
      try {
        const blocks = await settle();
        if (!cancelled) record(blocks, signal);
      } catch (e) {
        finished = false;
        if (!cancelled) setError(errText(e));
      } finally {
        if (!cancelled) setSettling(false);
      }
    };

    const off = dev.onRawInput?.((id, data) => {
      seen.current.hid.push(hex2(id) + toHex(data));
      void finish('hid');
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || finished) return;
      seen.current.keys.push(e.code);
      const verdict = judgeKey(cur, e.code);
      if (verdict === 'right') void finish('key');
      else if (verdict === 'wrong') setWrongKey(e.code);
    };
    window.addEventListener('keydown', onKey, true);
    const nudgeTimer = setTimeout(() => setNudge(true), NUDGE_MS);

    void (async () => {
      while (!finished && !cancelled) {
        await sleep(POLL_MS);
        if (finished || cancelled) break;
        try {
          const blocks = await dev.readRawBlocks!();
          if (!cancelled) setError(null);
          if (!same(ref.blocks, blocks)) await finish('bytes');
        } catch (e) {
          if (!cancelled) setError(errText(e));
        }
      }
    })();

    return () => {
      cancelled = true;
      off?.();
      window.removeEventListener('keydown', onKey, true);
      clearTimeout(nudgeTimer);
    };
  }, [step, dev]);

  // The re-plug step: remember the connection it started on, record once a new one appears.
  useEffect(() => {
    if (cur?.kind !== 'replug') return;
    if (!replugFrom.current) replugFrom.current = dev ?? 'gone';
    if (!dev || dev === replugFrom.current) return;
    let cancelled = false;
    void (async () => {
      await sleep(500);
      if (cancelled) return;
      replugFrom.current = null;
      await readAndRecord();
    })();
    return () => {
      cancelled = true;
    };
  }, [step, dev]);

  if (!dev && reads.length === 0) return null;

  const started = step >= 0;
  const finished = step >= GUIDE.length;
  const summary = summarise(reads);
  const restart = () => {
    setReads([]);
    setStep(-1);
    setError(null);
    replugFrom.current = null;
    recordedFor.current = -2;
  };

  return (
    // Open while a test runs, so it survives the dialog re-rendering during a reconnect.
    <details className="probe" open={started || undefined}>
      <summary>Side-light probe: help add side-light control</summary>
      <p className="muted small">A guided test. The page tells you which keys to press and moves on when it notices each press. It only reads the keyboard; nothing is changed.</p>

      {!started && (
        <button className="primary" disabled={!dev || working} onClick={() => void readAndRecord()}>
          Start the test
        </button>
      )}

      {cur && (
        <div className="probe-now">
          <div className="probe-progress">
            Step {step + 1} of {GUIDE.length}
          </div>
          <div className="probe-prompt">{cur.prompt}</div>
          <p className="small">{cur.detail}</p>
          {cur.kind === 'press' && settling && <p className="probe-got">✓ Got it. Recording, don't press anything yet…</p>}
          {cur.kind === 'press' && !settling && dev && (
            <>
              <p className="hint">Waiting for the key press…</p>
              {wrongKey && (
                <p className="hint warn">
                  The computer saw <b>{wrongKey}</b>, which isn't this shortcut. {cur.prompt}.
                </p>
              )}
              {nudge && (
                <div className="probe-nudge">
                  <span className="small">Pressed it but nothing happened here? The keyboard may not report this change.</span>
                  <button disabled={!dev || working} onClick={() => void readAndRecord('none')}>
                    I pressed it, nothing was detected
                  </button>
                </div>
              )}
            </>
          )}
          {cur.kind === 'setup' && (
            <button className="primary" disabled={!dev || working} onClick={() => void readAndRecord()}>
              Ready
            </button>
          )}
          {cur.kind === 'save' && (
            <button
              className="primary"
              onClick={() => {
                save();
                setStep((s) => s + 1);
              }}
            >
              Save results
            </button>
          )}
          {cur.kind === 'replug' && dev && <p className="hint">Waiting for the keyboard to disconnect…</p>}
        </div>
      )}

      {!dev && (
        <div className="probe-nudge">
          <span className="small">
            Keyboard disconnected. Plug it back in; the page should reconnect within a few seconds. If it doesn't, click Reconnect. Your progress is kept.
          </span>
          <button className="primary" disabled={!!api.busy} onClick={() => void api.reconnect()}>
            {api.busy === 'Reconnecting' ? 'Reconnecting…' : 'Reconnect'}
          </button>
          {api.error && <span className="hint warn">{api.error}</span>}
        </div>
      )}

      {finished && (
        <div className="probe-now">
          <div className="probe-prompt">✓ All done</div>
          <p className="small">Thanks! Save the results once more so the file includes the re-plug check.</p>
          <div>
            <button className="primary" onClick={save}>
              Save results
            </button>
          </div>
        </div>
      )}

      {error && <p className="hint warn">{error}</p>}

      {reads.length > 1 && (
        <ol className="probe-reads small">
          {reads.slice(1).map((r, i) => (
            <li key={r.t}>
              <b>{actionLabel(r.action)}</b>
              {r.signal && <span className={r.signal === 'none' ? 'muted' : 'probe-ok'}> · {SIGNAL_TEXT[r.signal]}</span>}
              <div className="mono">{changesText(reads, i + 1)}</div>
              {!!r.hid?.length && <div className="mono muted">keyboard sent: {r.hid.join(' | ')}</div>}
            </li>
          ))}
        </ol>
      )}

      {summary.length > 0 && (
        <>
          <h4 className="probe-h">Bytes that changed</h4>
          <table className="probe-table small">
            <thead>
              <tr>
                <th>Byte</th>
                <th>Known as</th>
                <th>Values seen</th>
                <th>Changed by</th>
              </tr>
            </thead>
            <tbody>
              {summary.map((s) => (
                <tr key={`${s.block}:${s.offset}`}>
                  <td className="mono">{byteLabel(s.block, s.offset)}</td>
                  <td>{describeOffset(s.block, s.offset) || <span className="muted">unknown</span>}</td>
                  <td className="mono">{s.values.map(hex2).join(' ')}</td>
                  <td>{s.actions.map(actionLabel).join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {started && (
        <div className="actions">
          <button disabled={reads.length < 2} onClick={save}>
            Save results
          </button>
          <button disabled={working} onClick={restart}>
            Start over
          </button>
          {savedAt !== null && (
            <span className="hint">
              Saved {savedAt - 1} step{savedAt === 2 ? '' : 's'} to your Downloads folder.
            </span>
          )}
        </div>
      )}
    </details>
  );
}
