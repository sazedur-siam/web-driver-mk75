/**
 * Layer-based custom live effects. Each layer lights a set of keys with an animation; layers are composited
 * bottom-to-top with a blend mode. Rendering is a pure function of time (plus key presses for "reactive").
 */
import { MK75_KEYS } from '../device/mk75Layout';
import type { RGB } from './lighting';

export type LayerType = 'solid' | 'breathe' | 'wave' | 'ripple' | 'stars' | 'scroll' | 'reactive';
export type Blend = 'replace' | 'add' | 'max';

export interface Layer {
  id: string;
  type: LayerType;
  keys: number[]; // empty = all keys
  colors: [RGB, RGB];
  speed: number; // 0.1–4
  width: number; // 0.05–1 (wave/ripple band width)
  direction: 'horizontal' | 'vertical';
  origin?: number; // ripple centre key
  blend: Blend;
}

export interface CustomEffect {
  id: string;
  name: string;
  layers: Layer[];
}

export const LAYER_TYPES: { id: LayerType; name: string }[] = [
  { id: 'solid', name: 'Solid' },
  { id: 'breathe', name: 'Breathe' },
  { id: 'wave', name: 'Wave' },
  { id: 'ripple', name: 'Ripple' },
  { id: 'stars', name: 'Stars' },
  { id: 'scroll', name: 'Gradient scroll' },
  { id: 'reactive', name: 'Key reactive' },
];

const XS = MK75_KEYS.map((k) => (k.x1 + k.x2) / 2);
const YS = MK75_KEYS.map((k) => (k.y1 + k.y2) / 2);
const [X0, X1, Y0, Y1] = [Math.min(...XS), Math.max(...XS), Math.min(...YS), Math.max(...YS)];
/** Key centres normalised to 0..1 (u across, v down). */
export const CENTRE = new Map(MK75_KEYS.map((k, i) => [k.index, { u: (XS[i] - X0) / (X1 - X0), v: ((YS[i] - Y0) / (Y1 - Y0)) * ((Y1 - Y0) / (X1 - X0)) }]));
const ALL = MK75_KEYS.map((k) => k.index);

const mix = (a: RGB, b: RGB, t: number): RGB => [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * t) as RGB;
const scale = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];
/** Stable pseudo-random 0..1 per key (+ salt). */
const hash = (n: number, salt = 0) => {
  const x = Math.sin(n * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
};

/** Colour (and whether it's lit) for one key of one layer at time t. */
function layerColour(L: Layer, idx: number, t: number, pressed: Map<number, number>): RGB | null {
  const c = CENTRE.get(idx)!;
  const s = L.speed;
  switch (L.type) {
    case 'solid':
      return L.colors[0];
    case 'breathe':
      return scale(L.colors[0], 0.5 + 0.5 * Math.sin(2 * Math.PI * t * s * 0.5 - Math.PI / 2));
    case 'wave': {
      const pos = L.direction === 'horizontal' ? c.u : c.v / 0.4;
      const ph = (((pos - t * s * 0.4) % 1) + 1) % 1;
      const d = Math.min(ph, 1 - ph);
      const k = Math.max(0, 1 - d / Math.max(0.02, L.width));
      return k > 0 ? scale(mix(L.colors[0], L.colors[1], c.u), k) : null;
    }
    case 'ripple': {
      const o = CENTRE.get(L.origin ?? -1) ?? { u: 0.5, v: 0.2 };
      const dist = Math.hypot(c.u - o.u, c.v - o.v);
      const r = ((t * s * 0.5) % 1) * 1.1;
      const k = Math.max(0, 1 - Math.abs(dist - r) / Math.max(0.02, L.width * 0.5));
      return k > 0 ? scale(mix(L.colors[0], L.colors[1], Math.min(1, r)), k) : null;
    }
    case 'stars': {
      const k = Math.pow(Math.max(0, Math.sin(2 * Math.PI * (t * s * 0.35 + hash(idx)))), 10);
      return k > 0.02 ? scale(hash(idx, 1) > 0.5 ? L.colors[0] : L.colors[1], k) : null;
    }
    case 'scroll': {
      const pos = L.direction === 'horizontal' ? c.u : c.v / 0.4;
      return mix(L.colors[0], L.colors[1], 0.5 + 0.5 * Math.sin(2 * Math.PI * (pos - t * s * 0.25)));
    }
    case 'reactive': {
      const tp = pressed.get(idx);
      if (tp === undefined) return null;
      const k = Math.max(0, 1 - (t - tp) * s);
      return k > 0 ? scale(mix(L.colors[0], L.colors[1], 1 - k), k) : null;
    }
  }
}

/** Composite all layers for time t (seconds). `pressed` = key index → time of last press (seconds). */
export function renderEffect(e: CustomEffect, t: number, pressed: Map<number, number> = new Map()): Map<number, RGB> {
  const out = new Map<number, RGB>(ALL.map((i) => [i, [0, 0, 0] as RGB]));
  for (const L of e.layers) {
    const keys = L.keys.length ? L.keys : ALL;
    for (const idx of keys) {
      const c = layerColour(L, idx, t, pressed);
      if (!c) continue;
      const cur = out.get(idx)!;
      const next: RGB =
        L.blend === 'add' ? [cur[0] + c[0], cur[1] + c[1], cur[2] + c[2]] : L.blend === 'max' ? [Math.max(cur[0], c[0]), Math.max(cur[1], c[1]), Math.max(cur[2], c[2])] : c;
      out.set(idx, next);
    }
  }
  for (const [k, c] of out) out.set(k, c.map((v) => Math.max(0, Math.min(255, Math.round(v)))) as RGB);
  return out;
}

export const newLayer = (type: LayerType = 'wave'): Layer => ({
  id: Math.random().toString(36).slice(2, 9),
  type,
  keys: [],
  colors: [
    [0, 200, 255],
    [255, 0, 140],
  ],
  speed: 1,
  width: 0.25,
  direction: 'horizontal',
  blend: type === 'solid' || type === 'breathe' || type === 'scroll' ? 'replace' : 'add',
});

/** A starter effect so the designer isn't empty. */
export const EXAMPLE_EFFECT: CustomEffect = {
  id: 'aurora',
  name: 'Aurora',
  layers: [
    { ...newLayer('breathe'), id: 'base', colors: [[0, 60, 40], [0, 0, 0]], speed: 0.6 },
    { ...newLayer('wave'), id: 'wave', colors: [[0, 255, 160], [120, 0, 255]], width: 0.3, speed: 0.8, blend: 'add' },
    { ...newLayer('reactive'), id: 'react', colors: [[255, 255, 255], [255, 120, 0]], speed: 1.5, blend: 'max' },
  ],
};
