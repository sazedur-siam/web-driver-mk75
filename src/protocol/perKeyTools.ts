/** Per-key colour generators: gradients, key regions and colourway-matched fills. */
import { MK75_KEYS, type KeyDef } from '../device/mk75Layout';
import type { RGB } from './lighting';

const centre = (k: KeyDef) => ({ x: (k.x1 + k.x2) / 2, y: (k.y1 + k.y2) / 2 });
const lerp = (a: RGB, b: RGB, t: number): RGB => [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t)) as RGB;

/** Colour at position t∈[0,1] along a multi-stop gradient. */
export function sampleStops(stops: RGB[], t: number): RGB {
  if (stops.length === 1) return stops[0];
  const x = Math.min(1, Math.max(0, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  return lerp(stops[i], stops[i + 1], x - i);
}

export type GradientDir = 'horizontal' | 'vertical' | 'radial';

/** Gradient across the given keys (by their positions on the board). Radial goes from `origin` outwards. */
export function gradient(stops: RGB[], dir: GradientDir, keys: number[] = MK75_KEYS.map((k) => k.index), origin?: number): Record<number, RGB> {
  const defs = MK75_KEYS.filter((k) => keys.includes(k.index));
  if (!defs.length) return {};
  const pts = defs.map((k) => ({ k, ...centre(k) }));
  const o = origin !== undefined ? MK75_KEYS.find((k) => k.index === origin) : undefined;
  const oc = o ? centre(o) : { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length };
  const metric = (p: { x: number; y: number }) => (dir === 'horizontal' ? p.x : dir === 'vertical' ? p.y : Math.hypot(p.x - oc.x, p.y - oc.y));
  const vals = pts.map(metric);
  const min = Math.min(...vals);
  const span = Math.max(...vals) - min || 1;
  return Object.fromEntries(pts.map((p, i) => [p.k.index, sampleStops(stops, (vals[i] - min) / span)]));
}

const labels = (...ls: string[]) => MK75_KEYS.filter((k) => ls.includes(k.label)).map((k) => k.index);

export const REGIONS: { id: string; name: string; keys: number[] }[] = [
  { id: 'wasd', name: 'WASD + arrows', keys: labels('W', 'A', 'S', 'D', 'Up', 'Down', 'Left', 'Right') },
  { id: 'gaming', name: 'Gaming cluster', keys: labels('Q', 'W', 'E', 'R', 'A', 'S', 'D', 'F', 'Z', 'X', 'C', 'V', '1', '2', '3', '4', '5', 'LShift', 'LCtrl', 'Space', 'Tab') },
  { id: 'frow', name: 'F-row', keys: labels('Esc', ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`)) },
  { id: 'numrow', name: 'Number row', keys: labels('`', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '=', 'Backspace') },
  { id: 'letters', name: 'Letters', keys: MK75_KEYS.filter((k) => /^[A-Z]$/.test(k.label)).map((k) => k.index) },
  { id: 'mods', name: 'Modifiers', keys: MK75_KEYS.filter((k) => k.cap === 'mod').map((k) => k.index) },
  { id: 'coding', name: 'Coding shortcuts', keys: labels('LCtrl', 'LShift', 'LAlt', 'C', 'V', 'X', 'Z', 'S', 'F', 'Tab', 'Enter', '/', '[', ']', ';') },
  { id: 'arrows', name: 'Arrows + nav', keys: labels('Up', 'Down', 'Left', 'Right', 'Delete', 'End', 'PgUp', 'PgDn') },
];

/** Backlight colours that match each MK75 colourway (alphas / modifiers / accent keys). */
export const COLOURWAY_FILLS: Record<string, { name: string; alpha: RGB; mod: RGB; accent: RGB }> = {
  'green-orange': { name: 'Dark green-orange', alpha: [64, 220, 170], mod: [30, 120, 60], accent: [255, 120, 0] },
  'milk-tea': { name: 'Iced milk tea', alpha: [255, 220, 170], mod: [255, 160, 90], accent: [255, 110, 40] },
  arthur: { name: 'Arthur', alpha: [60, 110, 255], mod: [140, 60, 255], accent: [0, 200, 255] },
  summer: { name: 'Summer Wilderness', alpha: [200, 240, 255], mod: [60, 170, 255], accent: [0, 200, 200] },
};

export function colourwayFill(id: string): Record<number, RGB> {
  const c = COLOURWAY_FILLS[id] ?? COLOURWAY_FILLS['green-orange'];
  return Object.fromEntries(MK75_KEYS.map((k) => [k.index, k.cap === 'alpha' ? c.alpha : k.cap === 'accent' ? c.accent : c.mod]));
}
