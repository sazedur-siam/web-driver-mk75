import { useState } from 'react';
import { describeOffset, diffBlocks, hex2, offsetLabel, PROBE_ACTIONS, summarise, type ProbeAction, type ProbeRead } from './sideLightProbe';
import type { DeviceApi } from './useDevice';

const actionLabel = (a: ProbeAction) => PROBE_ACTIONS.find((x) => x.id === a)!.label;

/**
 * Read-only side-light probe inside "Contribute device data": read the config block, press a side-light shortcut,
 * read again, see which bytes moved. Layout B boards only (readConfigBlock). Nothing is written to the keyboard.
 */
export function SideLightProbePanel({ api, reads, setReads }: { api: DeviceApi; reads: ProbeRead[]; setReads: (r: ProbeRead[]) => void }) {
  const [action, setAction] = useState<ProbeAction>(reads.length ? 'mode' : 'baseline');
  const [seen, setSeen] = useState('');
  const dev = api.dev;
  if (!dev?.readConfigBlock) return null;

  const read = () =>
    api.run('Reading the config block', async () => {
      const block = await dev.readConfigBlock!();
      setReads([...reads, { t: Date.now(), action, seen, block }]);
      setSeen('');
      if (action === 'baseline') setAction('mode');
    });

  const summary = summarise(reads);

  return (
    <details className="probe">
      <summary>Side-light probe (optional, helps add side-light control)</summary>
      <p className="muted small">
        Finds where the keyboard stores the side-light settings. Read once as a starting point, then press <b>one</b> side-light shortcut on the
        keyboard, pick it below and read again. Repeat for each shortcut until its setting wraps around. Nothing is written to the keyboard. The reads
        go into the file you save below.
      </p>
      <div className="probe-form">
        <label className="field">
          <span className="field-l">What I just pressed</span>
          <select value={action} onChange={(e) => setAction(e.target.value as ProbeAction)}>
            {PROBE_ACTIONS.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-l">Side lights now show</span>
          <input className="text-input" placeholder="e.g. steady, red, bright" value={seen} onChange={(e) => setSeen(e.target.value)} />
        </label>
        <button className="primary" disabled={!!api.busy} onClick={read}>
          Read the keyboard
        </button>
      </div>
      {api.error && <p className="hint warn">{api.error}</p>}

      {reads.length > 0 && (
        <ol className="probe-reads small">
          {reads.map((r, i) => {
            const changes = i ? diffBlocks(reads[i - 1].block, r.block) : [];
            return (
              <li key={r.t}>
                <b>{actionLabel(r.action)}</b>
                {r.seen.trim() && <span className="muted"> · {r.seen.trim()}</span>}
                <div className="mono">
                  {i === 0
                    ? 'starting point'
                    : changes.length === 0
                      ? 'no bytes changed'
                      : changes.map((c) => `${offsetLabel(c.offset)}: ${hex2(c.from)} → ${hex2(c.to)}`).join(' · ')}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {summary.length > 0 && (
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
              <tr key={s.offset}>
                <td className="mono">{offsetLabel(s.offset)}</td>
                <td>{describeOffset(s.offset) || <span className="muted">unknown</span>}</td>
                <td className="mono">{s.values.map(hex2).join(' ')}</td>
                <td>{s.actions.map((a) => actionLabel(a).split(' (')[0]).join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {reads.length > 0 && (
        <div className="actions">
          <button disabled={!!api.busy} onClick={() => setReads([])}>
            Clear reads
          </button>
        </div>
      )}
    </details>
  );
}
