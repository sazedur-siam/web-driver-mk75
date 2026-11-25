import { useRef, useState } from 'react';
import { PAGE_LEN, PROFILE_LEN } from '../protocol/mk75';
import { macroStore } from './macroStore';
import { withMacroCodes } from './saveKeys';
import type { DeviceApi } from './useDevice';

const toHex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
const fromHexStr = (s: string) => new Uint8Array((s.match(/../g) ?? []).map((h) => parseInt(h, 16)));

interface BackupFile {
  format: 'mk75-driver-backup';
  version: 1;
  created: string;
  profile: string;
  keyMatrix: string;
  rgbTable: string;
  /** Macro library + assignments (kept in the browser; the keyboard can't send them back). */
  macros?: ReturnType<typeof macroStore.get>;
}

export function BackupTab({ api }: { api: DeviceApi }) {
  const { snap, dev, log } = api;
  const file = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<BackupFile | null>(null);

  if (!snap || !dev) return null;

  const exportBackup = () => {
    const b: BackupFile = {
      format: 'mk75-driver-backup',
      version: 1,
      created: new Date().toISOString(),
      profile: toHex(snap.profile),
      keyMatrix: toHex(snap.matrix),
      rgbTable: toHex(snap.rgbTable),
      macros: macroStore.get(),
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(b, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `mk75-backup-${b.created.slice(0, 19).replace(/[:T]/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      const b = JSON.parse(await f.text()) as BackupFile;
      if (b.format !== 'mk75-driver-backup') throw new Error('Not a Lingbao MK75 Driver backup file');
      if (fromHexStr(b.profile).length !== PROFILE_LEN || fromHexStr(b.keyMatrix).length !== PAGE_LEN || fromHexStr(b.rgbTable).length !== PAGE_LEN)
        throw new Error('Backup file is truncated or corrupted');
      setPending(b);
    } catch (e) {
      api.setError(e instanceof Error ? e.message : String(e));
    }
  };

  const restore = () =>
    pending &&
    api.run('Restoring backup', async () => {
      if (pending.macros?.macros) macroStore.replaceAll(pending.macros);
      await dev.writeRgbTable(fromHexStr(pending.rgbTable));
      // Macro pages first (ids are re-planned deterministically in key order), then the matrix.
      const { matrix, plan } = withMacroCodes(fromHexStr(pending.keyMatrix));
      if (plan.pages.length) await dev.writeMacroPages(plan.pages);
      await dev.writeKeyMatrix(matrix);
      await dev.writeProfile(fromHexStr(pending.profile));
      api.setSnap({ profile: await dev.readProfile(), matrix: await dev.readKeyMatrix(), rgbTable: await dev.readRgbTable() });
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
          Save the keyboard's lighting profile, key matrix and colour palette, plus your macros, before experimenting. Per-key
          Self-define colours aren't included, because they can't be read back from the keyboard.
        </p>
        <div className="actions">
          <button className="primary" onClick={exportBackup}>
            Download backup
          </button>
          <button onClick={() => file.current?.click()}>Load backup…</button>
          <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => onFile(e.target.files?.[0])} />
        </div>
        {pending && (
          <div className="confirm">
            <p>
              Restore backup from <b>{new Date(pending.created).toLocaleString()}</b>? This overwrites lighting, palette and key mapping.
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
          <button onClick={api.refresh} disabled={!!api.busy}>
            Re-read device
          </button>
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
