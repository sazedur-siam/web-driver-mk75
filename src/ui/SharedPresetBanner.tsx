import { describeAction } from '../protocol/keycodes';
import { hex } from '../protocol/lighting';
import { presetSummary } from '../protocol/preset';
import { applyProfile, profileFromPreset } from './applyProfile';
import { Keyboard } from './Keyboard';
import { profileStore } from './profileStore';
import { presetStore, usePendingPreset } from './presetStore';
import type { DeviceApi } from './useDevice';

/** Preview of a shared/gallery preset with Apply / Save as profile / Dismiss. */
export function SharedPresetBanner({ api }: { api: DeviceApi }) {
  const { pending, error } = usePendingPreset();
  if (error)
    return (
      <div className="banner err" role="alert">
        {error}
        <button className="x" onClick={() => presetStore.dismiss()} aria-label="Dismiss">
          ×
        </button>
      </div>
    );
  if (!pending) return null;
  const { dev, snap } = api;
  const p = pending;

  const apply = () =>
    dev &&
    snap &&
    api.run(`Applying preset "${p.name}"`, async () => {
      const res = await applyProfile(dev, snap, profileFromPreset(p, snap));
      api.setSnap(res.snap);
      api.push({ dir: 'info', text: `Applied preset "${p.name}": ${res.wrote.join(', ') || 'nothing to change'}` });
      presetStore.dismiss();
    });
  const save = () => {
    if (!snap) return;
    profileStore.upsert(profileFromPreset(p, snap));
    api.push({ dir: 'info', text: `Saved preset "${p.name}" as a profile` });
    presetStore.dismiss();
  };

  return (
    <section className="card preset-banner" aria-label="Shared preset">
      <header className="card-h">
        <h2>
          Preset: <span className="brand-mk">{p.name}</span>
        </h2>
        <span className="muted small">{presetSummary(p)}</span>
      </header>
      {(p.perKey || p.keys) && (
        <div className="preset-preview">
          <Keyboard
            selected={new Set()}
            onSelect={() => {}}
            fill={(k) => (p.perKey?.[k.index] ? hex(p.perKey[k.index]) : undefined)}
            sublabel={(k) => (p.keys?.[k.index] ? describeAction(p.keys[k.index]) : undefined)}
            highlight={(k) => !!p.keys?.[k.index]}
          />
        </div>
      )}
      <div className="row">
        <button className="primary" disabled={!dev || !!api.busy} onClick={apply}>
          Apply to keyboard
        </button>
        <button disabled={!snap} onClick={save}>
          Save as profile
        </button>
        <button onClick={() => presetStore.dismiss()}>Dismiss</button>
        {!dev && <span className="hint">Connect your MK75 to apply or save this preset.</span>}
      </div>
    </section>
  );
}
