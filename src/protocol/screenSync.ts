/**
 * Screen-sync ("ambient") lighting: map a small downscaled screen frame onto the MK75's keys.
 * zones   = each key takes the colour of the matching area of the screen (keyboard ↔ screen positions)
 * average = whole screen's mean colour on every key
 * edge    = the bottom edge of the screen spread across the keyboard left → right
 */
import { MK75_KEYS } from '../device/mk75Layout';
import type { RGB } from './lighting';
import { STREAM_LEN } from './mk75';

export type ScreenMode = 'zones' | 'average' | 'edge';
export const SCREEN_MODES: { id: ScreenMode; name: string }[] = [
  { id: 'zones', name: 'Zones' },
  { id: 'average', name: 'Average' },
  { id: 'edge', name: 'Bottom edge' },
];

/** Same shape as the DOM ImageData (RGBA bytes). */
export interface Frame {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

const XS = MK75_KEYS.map((k) => (k.x1 + k.x2) / 2);
const YS = MK75_KEYS.map((k) => (k.y1 + k.y2) / 2);
const [X0, X1, Y0, Y1] = [Math.min(...XS), Math.max(...XS), Math.min(...YS), Math.max(...YS)];
/** Key centres normalised to 0..1 across the board. */
const NORM = MK75_KEYS.map((k, i) => ({ index: k.index, u: (XS[i] - X0) / (X1 - X0), v: (YS[i] - Y0) / (Y1 - Y0) }));

function avg(f: Frame, x0: number, y0: number, x1: number, y1: number): RGB {
  let r = 0,
    g = 0,
    b = 0,
    n = 0;
  for (let y = Math.max(0, y0); y < Math.min(f.height, y1); y++)
    for (let x = Math.max(0, x0); x < Math.min(f.width, x1); x++) {
      const o = (y * f.width + x) * 4;
      r += f.data[o];
      g += f.data[o + 1];
      b += f.data[o + 2];
      n++;
    }
  return n ? ([r / n, g / n, b / n].map(Math.round) as RGB) : [0, 0, 0];
}

/** Boost saturation in RGB space (1 = unchanged). */
export function saturate([r, g, b]: RGB, amount: number): RGB {
  const l = 0.299 * r + 0.587 * g + 0.114 * b;
  return [r, g, b].map((c) => Math.max(0, Math.min(255, Math.round(l + (c - l) * amount)))) as RGB;
}

export function screenColours(f: Frame, mode: ScreenMode): Map<number, RGB> {
  const out = new Map<number, RGB>();
  if (mode === 'average') {
    const c = avg(f, 0, 0, f.width, f.height);
    for (const k of NORM) out.set(k.index, c);
    return out;
  }
  for (const k of NORM) {
    const cx = Math.min(f.width - 1, Math.floor(k.u * f.width));
    if (mode === 'edge') {
      out.set(k.index, avg(f, cx, f.height - Math.max(1, Math.floor(f.height / 6)), cx + 1, f.height));
    } else {
      const cy = Math.min(f.height - 1, Math.floor(k.v * f.height));
      out.set(k.index, avg(f, cx, cy, cx + 1, cy + 1));
    }
  }
  return out;
}

/** Stateful smoothing + saturation → 126×RGB live frame. */
export class ScreenSync {
  private prev = new Map<number, RGB>();
  constructor(
    public mode: ScreenMode = 'zones',
    public smooth = 0.5,
    public saturation = 1.3,
  ) {}

  frame(f: Frame, brightness = 1): Uint8Array {
    const a = Math.min(0.95, Math.max(0, this.smooth));
    const out = new Uint8Array(STREAM_LEN);
    for (const [idx, c] of screenColours(f, this.mode)) {
      const s = saturate(c, this.saturation);
      const p = this.prev.get(idx) ?? s;
      const m = [0, 1, 2].map((i) => p[i] * a + s[i] * (1 - a)) as RGB;
      this.prev.set(idx, m);
      out.set(m.map((v) => Math.round(v * brightness)), 3 * idx);
    }
    return out;
  }
}
