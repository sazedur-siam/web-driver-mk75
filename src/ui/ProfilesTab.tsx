import { useRef, useState } from 'react';
import { LED_MODES, parseProfile } from '../protocol/lighting';
import { GALLERY } from '../presets/gallery';
import { factoryKeyCode, presetFromBlocks, presetSummary } from '../protocol/preset';
import { applyProfile, captureProfile, profileMatrix, readSideLightsFor } from './applyProfile';
import { presetStore, shareLink } from './presetStore';
import { fromHex, profileStore, useProfiles, validateProfile, type Profile } from './profileStore';
import type { DeviceApi } from './useDevice';
import { GameModeProfilesNote } from './GameModeCard';

const eq = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

function download(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'profile';

export function ProfilesTab({ api }: { api: DeviceApi }) {
  const { profiles, activeId } = useProfiles();
  const { snap, dev } = api;
  const [name, setName] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState<string | null>(null);

  if (!snap || !dev) return null;

  /** Which keyboard blocks would change if this profile were applied now. */
  const changes = (p: Profile) => {
    const out: string[] = [];
    if (!eq(fromHex(p.profile), snap.profile)) out.push('lighting');
    if (!eq(fromHex(p.rgbTable), snap.rgbTable)) out.push('palette');
    try {
      if (!eq(profileMatrix(p, dev.caps.macros, snap.matrix).matrix, snap.matrix)) out.push('keys');
    } catch {
      out.push('keys'); // macros don't fit; Apply shows the error instead of crashing the page
    }
    return out;
  };

  const saveNew = () =>
    api.run('Saving profile', async () => {
      const n = name.trim() || `Profile ${profiles.length + 1}`;
      const p = captureProfile(n, snap, undefined, undefined, await readSideLightsFor(dev));
      profileStore.upsert(p);
      profileStore.setActive(p.id);
      setName('');
      api.push({ dir: 'info', text: `Saved profile "${n}"` });
    });

  const apply = (p: Profile) =>
    api.run(`Applying "${p.name}"`, async () => {
      const res = await applyProfile(dev, snap, p, (s) => api.push({ dir: 'info', text: `${p.name}: ${s}…` }));
      api.setSnap(res.snap);
      profileStore.setActive(p.id);
      api.push({
        dir: 'info',
        text: `Applied "${p.name}": ${res.wrote.length ? `wrote ${res.wrote.join(', ')}` : 'already up to date, nothing written'}${
          res.skipped.length ? `; skipped ${res.skipped.join(', ')}` : ''
        }`,
      });
    });

  const share = async (p: Profile) => {
    const preset = presetFromBlocks(p.name, { profile: fromHex(p.profile), rgbTable: fromHex(p.rgbTable), matrix: fromHex(p.keyMatrix) }, factoryKeyCode, p.perKey);
    const url = await shareLink(preset);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(p.id);
      setTimeout(() => setCopied(null), 2500);
    } catch {
      window.prompt('Copy this link', url);
    }
    api.push({ dir: 'info', text: `Share link for "${p.name}" (${url.length} chars)${p.macros.macros.length ? '; macros are not included in links' : ''}` });
  };

  const update = (p: Profile) =>
    api.run(`Updating "${p.name}"`, async () => {
      profileStore.upsert(captureProfile(p.name, snap, p.id, p.created, await readSideLightsFor(dev)));
      api.push({ dir: 'info', text: `Updated "${p.name}" from the keyboard` });
    });

  const duplicate = (p: Profile) => {
    const now = new Date().toISOString();
    profileStore.upsert({ ...structuredClone(p), id: Math.random().toString(36).slice(2, 10), name: `${p.name} copy`, created: now, updated: now });
  };

  const onImport = async (f: File | undefined) => {
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      const list = (Array.isArray(data?.profiles) ? data.profiles : [data]).map(validateProfile);
      const existing = new Set(profileStore.get().profiles.map((p) => p.id));
      for (const p of list) profileStore.upsert(existing.has(p.id) ? { ...p, id: Math.random().toString(36).slice(2, 10) } : p);
      api.push({ dir: 'info', text: `Imported ${list.length} profile${list.length > 1 ? 's' : ''}` });
    } catch (e) {
      api.setError(`Import failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      if (file.current) file.current.value = '';
    }
  };

  return (
    <div className="panel-grid">
      <section className="card">
        <header className="card-h">
          <h2>Profiles</h2>
          <span className="muted small">{profiles.length} saved in this browser</span>
        </header>
        <GameModeProfilesNote api={api} />
        {profiles.length === 0 && <p className="muted">No profiles yet. Save the keyboard's current setup to create one.</p>}
        <div className="profile-list">
          {profiles.map((p) => {
            const ch = changes(p);
            const effect = LED_MODES[parseProfile(fromHex(p.profile)).activeIndex]?.name;
            const active = p.id === activeId && ch.length === 0;
            const nMacros = p.macros.macros.length;
            return (
              <div key={p.id} className={`profile-item${active ? ' on' : ''}`}>
                <div className="profile-main">
                  {renaming === p.id ? (
                    <input
                      className="name-input"
                      autoFocus
                      value={renameText}
                      onChange={(e) => setRenameText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && renameText.trim()) {
                          profileStore.upsert({ ...p, name: renameText.trim(), updated: new Date().toISOString() });
                          setRenaming(null);
                        }
                        if (e.key === 'Escape') setRenaming(null);
                      }}
                      onBlur={() => setRenaming(null)}
                      aria-label="Profile name"
                    />
                  ) : (
                    <b>
                      {p.name}
                      {active && <span className="pill ok small-pill">on keyboard</span>}
                    </b>
                  )}
                  <span className="muted small">
                    {effect}
                    {Object.keys(p.perKey).length ? ' · per-key colours' : ''}
                    {nMacros ? ` · ${nMacros} macro${nMacros > 1 ? 's' : ''}` : ''} ·{' '}
                    {ch.length ? `will change ${ch.join(', ')}` : 'matches the keyboard'}
                  </span>
                </div>
                <div className="row">
                  <button className="primary" disabled={!!api.busy} onClick={() => apply(p)}>
                    Apply
                  </button>
                  <button onClick={() => update(p)} title="Overwrite this profile with the keyboard's current setup">
                    Update
                  </button>
                  <button onClick={() => { setRenaming(p.id); setRenameText(p.name); }}>Rename</button>
                  <button onClick={() => duplicate(p)}>Duplicate</button>
                  <button onClick={() => share(p)}>{copied === p.id ? 'Link copied ✓' : 'Share link'}</button>
                  <button onClick={() => download(`mk75-profile-${slug(p.name)}.json`, p)}>Export</button>
                  {confirmDelete === p.id ? (
                    <>
                      <button className="danger" onClick={() => { profileStore.remove(p.id); setConfirmDelete(null); }}>
                        Delete
                      </button>
                      <button onClick={() => setConfirmDelete(null)}>Cancel</button>
                    </>
                  ) : (
                    <button className="danger-link" onClick={() => setConfirmDelete(p.id)}>
                      Delete
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="card">
        <h2>Save current setup</h2>
        <p className="muted small">Captures lighting, palette, key mapping, per-key colours and macros as they are now.</p>
        <div className="row">
          <input
            className="text-input"
            placeholder={`Profile ${profiles.length + 1}`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && saveNew()}
            aria-label="New profile name"
          />
          <button className="primary" onClick={saveNew}>
            Save as profile
          </button>
        </div>
        <h2>Preset gallery</h2>
        <div className="gallery">
          {GALLERY.map((g) => (
            <button key={g.name} className="gallery-item" onClick={() => presetStore.preview(g)}>
              <b>{g.name}</b>
              <span className="muted small">{presetSummary(g)}</span>
            </button>
          ))}
        </div>
        <h2>Import / export</h2>
        <div className="row">
          <button onClick={() => download('mk75-profiles.json', { format: 'mk75-profiles', version: 1, profiles })} disabled={!profiles.length}>
            Export all
          </button>
          <button onClick={() => file.current?.click()}>Import…</button>
          <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => onImport(e.target.files?.[0])} />
        </div>
        <p className="hint">
          The keyboard stores one setup at a time. Applying a profile writes it into the keyboard, where it stays after you close this tab.
          Blocks that already match aren't rewritten.
          {dev.kind === 'wireless' && ' Over 2.4 GHz / Bluetooth, macros are skipped (they need the USB cable).'}
        </p>
      </section>
    </div>
  );
}
