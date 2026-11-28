import { useRef, useState } from 'react';
import type { SideLights } from '../protocol/device';
import { buildBackup, parseBackup, restoreBackup, type BackupFile } from './backup';
import type { DeviceApi } from './useDevice';

const toHex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

export function BackupTab({ api }: { api: DeviceApi }) {
  const { snap, dev, log } = api;
  const file = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<BackupFile | null>(null);

  if (!snap || !dev) return null;

  const exportBackup = () =>
    api.run('Preparing backup', async () => {
      // The side lights aren't in the snapshot; read them now. A failed read shouldn't stop the backup.
      let side: SideLights | undefined;
      if (dev.readSideLights) {
        try {
          side = await dev.readSideLights();
        } catch (e) {
          api.push({ dir: 'error', text: `Backup saved without the side lights: ${e instanceof Error ? e.message : String(e)}` });
        }
      }
      const b = buildBackup(snap, side);
      const url = URL.createObjectURL(new Blob([JSON.stringify(b, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `mk75-backup-${b.created.slice(0, 19).replace(/[:T]/g, '-')}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      setPending(parseBackup(await f.text()));
    } catch (e) {
      api.setError(e instanceof Error ? e.message : String(e));
    }
  };

  const restore = () =>
    pending &&
    api.run('Restoring backup', async () => {
      const res = await restoreBackup(dev, snap, pending);
      api.setSnap(res.snap);
      for (const n of res.notes) api.push({ dir: 'info', text: n });
      api.push({ dir: 'info', text: `Restored backup from ${pending.created}` });
      setPending(null);
    });

  return (
    <div className="panel-grid">
      <section className="card">
        <header className="card-h">
          <h2>Backup &amp; restore</h2>
        </header>
        <p className="muted">
          Save the keyboard's lighting profile, key matrix, colour palette and side lights, plus your macros and saved profiles, before
          experimenting. Per-key Self-define colours aren't included, because they can't be read back from the keyboard.
        </p>
        <div className="actions">
          <button className="primary" onClick={exportBackup} disabled={!!api.busy}>
            Download backup
          </button>
          <button onClick={() => file.current?.click()}>Load backup…</button>
          <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => onFile(e.target.files?.[0])} />
        </div>
        {pending && (
          <div className="confirm">
            <p>
              Restore backup from <b>{new Date(pending.created).toLocaleString()}</b>? This overwrites lighting, palette and key mapping{pending.sideLights ? ', and the side lights' : ''}.
            </p>
            <div className="actions">
              <button className="danger" onClick={restore} disabled={!!api.busy}>
                Restore to keyboard
              </button>
              <button onClick={() => setPending(null)}>Cancel</button>
            </div>
          </div>
        )}
        <details>
          <summary>Raw blocks</summary>
          <pre className="mono small">
            {`profile  (83/03 b6) ${toHex(snap.profile).slice(0, 96)}…\nmatrix   (84/04 d4) ${toHex(snap.matrix).slice(0, 96)}…\nrgbTable (88/08 b8) ${toHex(snap.rgbTable).slice(0, 96)}…`}
          </pre>
        </details>
      </section>

      <section className="card">
        <header className="card-h">
          <h2>HID log</h2>
          <div className="row">
            <button onClick={() => window.dispatchEvent(new Event('mk75:report'))}>Report an Issue</button>
            <button onClick={api.refresh} disabled={!!api.busy}>
              Re-read device
            </button>
          </div>
        </header>
        <div className="log mono small" role="log">
          {log.length === 0 && <div className="muted">No traffic yet.</div>}
          {log
            .slice()
            .reverse()
            .map((l, i) => (
              <div key={i} className={`log-${l.dir}`}>
                <span className="muted">{new Date(l.t).toLocaleTimeString()}</span> {l.dir === 'out' ? '→' : l.dir === 'in' ? '←' : '•'} {l.text}
              </div>
            ))}
        </div>
      </section>
    </div>
  );
}
