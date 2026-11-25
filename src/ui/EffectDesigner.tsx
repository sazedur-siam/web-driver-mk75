import { useState } from 'react';
import { MK75_KEYS } from '../device/mk75Layout';
import { LAYER_TYPES, newLayer, type Blend, type CustomEffect, type Layer, type LayerType } from '../protocol/effectDesigner';
import { fromHex, hex } from '../protocol/lighting';
import { REGIONS } from '../protocol/perKeyTools';
import { effectStore, useEffects } from './effectStore';
import { Keyboard } from './Keyboard';

/** Layer-based custom effect editor. `selectedId`/`onSelect` choose which effect the Live tab plays. */
export function EffectDesigner({ selectedId, onSelect }: { selectedId: string; onSelect: (id: string) => void }) {
  const effects = useEffects();
  const effect = effects.find((e) => e.id === selectedId) ?? effects[0];
  const [layerId, setLayerId] = useState<string | null>(effect?.layers[0]?.id ?? null);
  const [addType, setAddType] = useState<LayerType>('wave');
  const [renaming, setRenaming] = useState(false);
  if (!effect) return null;
  const layer = effect.layers.find((l) => l.id === layerId) ?? effect.layers[0];

  const save = (e: CustomEffect) => effectStore.upsert(e);
  const setLayer = (patch: Partial<Layer>) => layer && save({ ...effect, layers: effect.layers.map((l) => (l.id === layer.id ? { ...l, ...patch } : l)) });
  const move = (id: string, d: -1 | 1) => {
    const i = effect.layers.findIndex((l) => l.id === id);
    const j = i + d;
    if (j < 0 || j >= effect.layers.length) return;
    const ls = [...effect.layers];
    [ls[i], ls[j]] = [ls[j], ls[i]];
    save({ ...effect, layers: ls });
  };
  const newEffect = (from?: CustomEffect) => {
    const e: CustomEffect = from
      ? { ...structuredClone(from), id: Math.random().toString(36).slice(2, 9), name: `${from.name} copy` }
      : { id: Math.random().toString(36).slice(2, 9), name: `Effect ${effects.length + 1}`, layers: [newLayer('wave')] };
    save(e);
    onSelect(e.id);
    setLayerId(e.layers[0]?.id ?? null);
  };

  return (
    <div className="designer">
      <div className="row">
        {renaming ? (
          <input
            className="text-input"
            autoFocus
            defaultValue={effect.name}
            onBlur={(e) => {
              save({ ...effect, name: e.target.value.trim() || effect.name });
              setRenaming(false);
            }}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            aria-label="Effect name"
          />
        ) : (
          <select value={effect.id} onChange={(e) => onSelect(e.target.value)} aria-label="Custom effect">
            {effects.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        )}
        <button onClick={() => newEffect()}>New</button>
        <button onClick={() => newEffect(effect)}>Duplicate</button>
        <button onClick={() => setRenaming(true)}>Rename</button>
        <button className="danger-link" onClick={() => effectStore.remove(effect.id)}>
          Delete
        </button>
      </div>

      <div className="layer-list" role="list" aria-label="Layers (bottom to top)">
        {effect.layers.map((l, i) => (
          <div key={l.id} role="listitem" className={`layer-item${l.id === layer?.id ? ' on' : ''}`} onClick={() => setLayerId(l.id)}>
            <span className="layer-swatch" style={{ background: `linear-gradient(90deg, ${hex(l.colors[0])}, ${hex(l.colors[1])})` }} />
            <b>{LAYER_TYPES.find((t) => t.id === l.type)?.name}</b>
            <span className="muted small">
              {l.blend} · {l.keys.length ? `${l.keys.length} keys` : 'all keys'}
            </span>
            <span className="layer-actions">
              <button onClick={(e) => (e.stopPropagation(), move(l.id, -1))} disabled={i === 0} aria-label="Move down">
                ↓
              </button>
              <button onClick={(e) => (e.stopPropagation(), move(l.id, 1))} disabled={i === effect.layers.length - 1} aria-label="Move up">
                ↑
              </button>
              <button onClick={(e) => (e.stopPropagation(), save({ ...effect, layers: effect.layers.filter((x) => x.id !== l.id) }))} aria-label="Remove layer">
                ×
              </button>
            </span>
          </div>
        ))}
        <div className="row">
          <select value={addType} onChange={(e) => setAddType(e.target.value as LayerType)} aria-label="New layer type">
            {LAYER_TYPES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <button
            onClick={() => {
              const l = newLayer(addType);
              save({ ...effect, layers: [...effect.layers, l] });
              setLayerId(l.id);
            }}
          >
            + Add layer
          </button>
          <span className="hint">Layers draw bottom → top.</span>
        </div>
      </div>

      {layer && (
        <div className="layer-props">
          <div className="row">
            <select value={layer.type} onChange={(e) => setLayer({ type: e.target.value as LayerType })} aria-label="Layer type">
              {LAYER_TYPES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <input type="color" value={hex(layer.colors[0])} onChange={(e) => setLayer({ colors: [fromHex(e.target.value), layer.colors[1]] })} aria-label="Colour 1" />
            <input type="color" value={hex(layer.colors[1])} onChange={(e) => setLayer({ colors: [layer.colors[0], fromHex(e.target.value)] })} aria-label="Colour 2" />
            <select value={layer.blend} onChange={(e) => setLayer({ blend: e.target.value as Blend })} aria-label="Blend">
              <option value="replace">Replace</option>
              <option value="add">Add</option>
              <option value="max">Lighten (max)</option>
            </select>
            {(layer.type === 'wave' || layer.type === 'scroll') && (
              <select value={layer.direction} onChange={(e) => setLayer({ direction: e.target.value as Layer['direction'] })} aria-label="Direction">
                <option value="horizontal">Left → right</option>
                <option value="vertical">Top → bottom</option>
              </select>
            )}
            {layer.type === 'ripple' && (
              <select value={layer.origin ?? ''} onChange={(e) => setLayer({ origin: e.target.value === '' ? undefined : Number(e.target.value) })} aria-label="Ripple centre">
                <option value="">Centre</option>
                {MK75_KEYS.map((k) => (
                  <option key={k.index} value={k.index}>
                    from {k.label}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="slider-grid">
            <label className="field">
              <span className="field-l">
                Speed <b>{layer.speed.toFixed(2)}×</b>
              </span>
              <input type="range" min={0.1} max={4} step={0.05} value={layer.speed} onChange={(e) => setLayer({ speed: Number(e.target.value) })} />
            </label>
            {(layer.type === 'wave' || layer.type === 'ripple') && (
              <label className="field">
                <span className="field-l">
                  Width <b>{Math.round(layer.width * 100)}%</b>
                </span>
                <input type="range" min={0.05} max={1} step={0.01} value={layer.width} onChange={(e) => setLayer({ width: Number(e.target.value) })} />
              </label>
            )}
          </div>
          <span className="field-l">Keys for this layer {layer.keys.length ? `(${layer.keys.length})` : '(all)'}</span>
          <div className="chips">
            <button className="chip" onClick={() => setLayer({ keys: [] })}>
              All keys
            </button>
            {REGIONS.map((r) => (
              <button key={r.id} className="chip" onClick={() => setLayer({ keys: r.keys })}>
                {r.name}
              </button>
            ))}
          </div>
          <Keyboard multi selected={new Set(layer.keys)} onSelect={(s) => setLayer({ keys: [...s] })} />
        </div>
      )}
    </div>
  );
}
