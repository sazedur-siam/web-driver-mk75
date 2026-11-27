import { useState } from 'react';
import { describeOffset, diffBlocks, hex2, offsetLabel, PROBE_ACTIONS, summarise, type ProbeAction, type ProbeRead } from './sideLightProbe';
import type { DeviceApi } from './useDevice';

const actionLabel = (a: ProbeAction) => PROBE_ACTIONS.find((x) => x.id === a)!.label;

/**
 * Read-only side-light probe inside "Contribute device data": read the config block, press a side-light shortcut,
 * read again, see which bytes moved. Layout B boards only (readConfigBlock). Nothing is written to the keyboard.
 */
export function SideLightProbePanel({ api, reads, setReads }: { api: DeviceApi; reads: ProbeRead[]; setReads: (r: ProbeRead[]) => void }) {
  const [seen, setSeen] = useState('');
  const dev = api.dev;
  if (!dev?.readConfigBlock) return null;

  const read = (action: ProbeAction) =>
    api.run('Reading the config block', async () => {
      const block = await dev.readConfigBlock!();
      setReads([...reads, { t: Date.now(), action, seen, block }]);
      setSeen('');
    });

  const summary = summarise(reads);
  const started = reads.length > 0;

  return (
    <details className="probe">
      <summary>Side-light probe (optional, helps add side-light control)</summary>
      <p className="muted small">
        Finds where the keyboard stores the side-light settings. Click <b>Read starting point</b> first. Then press <b>one</b> side-light shortcut on
        the keyboard and click the button for it: that reads the keyboard right away. Repeat until each setting comes back round. Nothing is written
        to the keyboard. The reads go into the file you save below.
      </p>
      <label className="field">
        <span className="field-l">Side lights now show (optional, typed before clicking)</span>
        <input className="text-input" placeholder="e.g. steady, red, bright" value={seen} onChange={(e) => setSeen(e.target.value)} />
      </label>
      <div className="probe-actions">
        {PROBE_ACTIONS.filter((a) => (a.id === 'baseline') !== started).map((a) => (
          <button key={a.id} className={a.id === 'baseline' ? 'primary' : undefined} disabled={!!api.busy} onClick={() => read(a.id)}>
            {a.id === 'baseline' ? 'Read starting point' : a.label}
          </button>
        ))}
      </div>
      {api.busy === 'Reading the config block' && <p className="hint">Reading…</p>}
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
