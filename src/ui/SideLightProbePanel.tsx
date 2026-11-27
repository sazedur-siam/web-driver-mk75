import { actionLabel, byteLabel, describeOffset, diffReads, hex2, PROBE_ACTIONS, probeAction, summarise, type ProbeAction, type ProbeRead } from './sideLightProbe';
import type { ReactNode } from 'react';
import type { DeviceApi } from './useDevice';

const SHORTCUTS = PROBE_ACTIONS.filter((a) => ['mode', 'colour', 'speed', 'brightness'].includes(a.id));
const READING = 'Reading the keyboard';

/** "1 byte changed: led 0x06 00 → 02" for read i (compared with the read before it). */
function resultText(reads: ProbeRead[], i: number) {
  const changes = diffReads(reads[i - 1], reads[i]);
  if (changes.length === 0) return 'nothing changed';
  const shown = changes.slice(0, 8).map((c) => `${byteLabel(c.block, c.offset)} ${hex2(c.from)} → ${hex2(c.to)}`);
  if (changes.length > 8) shown.push(`… ${changes.length - 8} more`);
  return `${changes.length} byte${changes.length === 1 ? '' : 's'} changed: ${shown.join(', ')}`;
}

function Step({ n, off, children }: { n: number; off?: boolean; children: ReactNode }) {
  return (
    <div className={`probe-step${off ? ' off' : ''}`}>
      <span className="probe-num">{n}</span>
      <div className="probe-body">{children}</div>
    </div>
  );
}

/**
 * Read-only side-light probe inside "Contribute device data": snapshot the keyboard's blocks, press a shortcut on
 * the keyboard, click the same shortcut here, see which bytes moved. Layout B boards only (readRawBlocks).
 */
export function SideLightProbePanel({ api, reads, setReads }: { api: DeviceApi; reads: ProbeRead[]; setReads: (r: ProbeRead[]) => void }) {
  const dev = api.dev;
  if (!dev?.readRawBlocks) return null;

  const read = (action: ProbeAction) =>
    api.run(READING, async () => {
      const blocks = await dev.readRawBlocks!();
      setReads([...reads, { t: Date.now(), action, blocks }]);
    });

  const started = reads.length > 0;
  const busy = !!api.busy;
  const last = reads.length - 1;
  const summary = summarise(reads);
  const key = (a: (typeof PROBE_ACTIONS)[number]) => (
    <button key={a.id} disabled={!started || busy} onClick={() => read(a.id)}>
      <span className="probe-key">{a.keys}</span>
      <span className="probe-what">{a.what}</span>
    </button>
  );

  return (
    // Re-opens itself after a reconnect (the panel unmounts while the keyboard is unplugged).
    <details className="probe" open={started || undefined}>
      <summary>Side-light probe: help add side-light control</summary>
      <p className="muted small">It only reads the keyboard; nothing is changed.</p>

      <Step n={1}>
        <b>Take a snapshot</b> of the keyboard's current settings.
        <div>
          {started ? (
            <span className="probe-done">✓ Done</span>
          ) : (
            <button className="primary" disabled={busy} onClick={() => read('baseline')}>
              Take snapshot
            </button>
          )}
        </div>
      </Step>

      <Step n={2} off={!started}>
        <b>Check that the probe sees changes.</b> Press Fn + F6 (or Fn + F5) on the keyboard so the key backlight gets brighter (or dimmer), then click
        this. It should say a byte changed.
        <div className="probe-keys">{key(probeAction('check'))}</div>
      </Step>

      <Step n={3} off={!started}>
        <b>Press a side-light shortcut on the keyboard, then click the same shortcut here.</b> Repeat each one until the setting comes back round.
        <div className="probe-keys">{SHORTCUTS.map(key)}</div>
        <p className="small muted">
          Finally, unplug the keyboard and plug it back in. Keep this window open: it reconnects by itself. Then{' '}
          <button className="probe-inline" disabled={!started || busy} onClick={() => read('replug')}>
            check after reconnecting
          </button>
        </p>
      </Step>

      {api.busy === READING && <p className="hint">Reading…</p>}
      {api.error && <p className="hint warn">{api.error}</p>}
      {last > 0 && (
        <p className="probe-last">
          <b>{actionLabel(reads[last].action)}:</b> <span className="mono">{resultText(reads, last)}</span>
        </p>
      )}

      {summary.length > 0 && (
        <>
          <h4 className="probe-h">Bytes that changed so far</h4>
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
                  <td>{s.actions.map((a) => probeAction(a).keys).join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {last > 0 && (
        <details className="small">
          <summary>All {last} clicks</summary>
          <ol className="probe-reads">
            {reads.slice(1).map((r, i) => (
              <li key={r.t}>
                <b>{actionLabel(r.action)}:</b> <span className="mono">{resultText(reads, i + 1)}</span>
              </li>
            ))}
          </ol>
        </details>
      )}

      {started && (
        <div className="actions">
          <button disabled={busy} onClick={() => setReads([])}>
            Start over
          </button>
        </div>
      )}
    </details>
  );
}
