/**
 * On-screen preview of the built-in hardware lighting effects (Lighting tab).
 *
 * The firmware renders these effects itself; the vendor driver only shows a picture. These animations are
 * approximations drawn from each effect's name and options, so the user can get an idea of the look and flow
 * before saving. They do not talk to the keyboard. Assumes speed level 4 is the fastest (unconfirmed, CLAUDE.md §5).
 */
import { MK75_KEYS, type KeyDef } from '../device/mk75Layout';
import type { ModeSettings, RGB } from './lighting';

/** A key press (real or simulated) for the reactive effects. `t` is in seconds on the preview clock. */
export interface PreviewPress {
  index: number;
  t: number;
  hue: number;
}

export interface PreviewInput {
  modeIndex: number;
  settings: ModeSettings;
  /** Palette colour chosen for this effect (ignored when `settings.colorful`). */
  color: RGB;
  /** Seconds since the preview started. */
  t: number;
  presses?: PreviewPress[];
  /** Per-key colours for Self-define, by LED index. */
  perKey?: Map<number, RGB>;
}

/** Effects that react to key presses; the preview simulates presses for them. */
export const REACTIVE_MODES = new Set([3, 6, 8, 11]);
/** How long a press stays visible in any reactive effect (seconds). */
export const PRESS_LIFE = 2.2;

const X0 = 26;
const X1 = 611;
const Y0 = 28;
const Y1 = 255;
const W = X1 - X0;
const H = Y1 - Y0;
const CX = (X0 + X1) / 2;
const CY = (Y0 + Y1) / 2;

interface KeyGeo {
  key: KeyDef;
  x: number;
  y: number;
  /** 0..1 across the board */
  u: number;
  /** 0..1 down the board */
  v: number;
  /** angle around the centre, degrees */
  a: number;
  /** distance from the centre, layout units */
  d: number;
  row: number;
}

const rowOf = (y: number) => (y < 60 ? 0 : y < 110 ? 1 : y < 140 ? 2 : y < 180 ? 3 : y < 215 ? 4 : 5);

export const PREVIEW_KEYS: KeyGeo[] = MK75_KEYS.map((key) => {
  const x = (key.x1 + key.x2) / 2;
  const y = (key.y1 + key.y2) / 2;
  return {
    key,
    x,
    y,
    u: (x - X0) / W,
    v: (y - Y0) / H,
    a: (Math.atan2(y - CY, x - CX) * 180) / Math.PI,
    d: Math.hypot(x - CX, y - CY),
    row: rowOf(key.y1),
  };
});

const BY_INDEX = new Map(PREVIEW_KEYS.map((g) => [g.key.index, g]));

/** Serpentine path over the keys (row by row, alternating direction) for Retro snake. */
const SNAKE = [...PREVIEW_KEYS]
  .sort((a, b) => a.row - b.row || (a.row % 2 ? b.x - a.x : a.x - b.x))
  .map((g) => g.key.index);
const SNAKE_POS = new Map(SNAKE.map((index, i) => [index, i]));

export function hsv(h: number, s = 1, v = 1): RGB {
  h = ((h % 360) + 360) % 360;
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

/** Deterministic 0..1 hash so random-looking effects are stable between frames. */
export function hash01(a: number, b = 0): number {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const scale = (c: RGB, k: number): RGB => {
  const f = Math.max(0, Math.min(1, k));
  return [Math.round(c[0] * f), Math.round(c[1] * f), Math.round(c[2] * f)];
};
const add = (a: RGB, b: RGB): RGB => [Math.min(255, a[0] + b[0]), Math.min(255, a[1] + b[1]), Math.min(255, a[2] + b[2])];
const BLACK: RGB = [0, 0, 0];

/** Speed level 0..4 → time multiplier (0.5× .. 2×). */
export const speedFactor = (level: number) => 0.5 + 0.375 * level;
/** Brightness level 0..4 → 0.2 .. 1. */
export const brightnessFactor = (level: number) => (level + 1) / 5;

/** Colour of every key (by LED index) at time `t`. */
export function previewFrame(input: PreviewInput): Map<number, RGB> {
  const { modeIndex, settings, color, t } = input;
  const T = t * speedFactor(settings.speed);
  const bri = brightnessFactor(settings.brightness);
  const rainbow = settings.colorful;
  const presses = (input.presses ?? []).filter((p) => t - p.t >= 0 && t - p.t < PRESS_LIFE);
  /** The effect's colour at key `g`, or a hue across the board when "colourful". */
  const base = (g: KeyGeo, hue = g.u * 300): RGB => (rainbow ? hsv(hue) : color);
  const pressColor = (p: PreviewPress): RGB => (rainbow ? hsv(p.hue) : color);

  const out = new Map<number, RGB>();
  for (const g of PREVIEW_KEYS) {
    let c: RGB = BLACK;
    switch (modeIndex) {
      case 0: // Fixed on
        c = base(g);
        break;
      case 1: {
        // Respire: whole board breathes; colourful changes colour every breath.
        const cycle = 4;
        const level = (1 - Math.cos((2 * Math.PI * T) / cycle)) / 2;
        c = scale(rainbow ? hsv(Math.floor(T / cycle) * 67) : color, level);
        break;
      }
      case 2: // Rainbow: a spectrum flowing across the board
        c = hsv(g.u * 360 - T * 90);
        break;
      case 3: {
        // Flash away: a press sends light streaking away left and right along its row.
        for (const p of presses) {
          const o = BY_INDEX.get(p.index);
          if (!o || o.row !== g.row) continue;
          const age = t - p.t;
          const front = age * 420 * speedFactor(settings.speed);
          const dist = Math.abs(g.x - o.x);
          const k = dist < 6 ? 1 - age / PRESS_LIFE : Math.max(0, 1 - Math.abs(dist - front) / 45) * (1 - age / PRESS_LIFE);
          c = add(c, scale(pressColor(p), k));
        }
        break;
      }
      case 4: {
        // Raindrops: drops fall down random columns.
        for (let i = 0; i < 9; i++) {
          const period = 1.6 + hash01(i, 7) * 1.4;
          const phase = T / period + hash01(i, 3);
          const n = Math.floor(phase);
          const x = X0 + hash01(i, n) * W;
          const head = Y0 - 30 + (phase - n) * (H + 90);
          const dy = head - g.y;
          if (Math.abs(g.x - x) < 22 && dy > -14 && dy < 75) {
            const k = dy < 14 ? 1 : 1 - (dy - 14) / 61;
            c = add(c, scale(rainbow ? hsv(hash01(i, n + 99) * 360) : color, k));
          }
        }
        break;
      }
      case 5: // Rainbow wheel
        c = hsv(g.a + T * 90);
        break;
      case 6: {
        // Ripples shining: rings spread from each press.
        for (const p of presses) {
          const o = BY_INDEX.get(p.index);
          if (!o) continue;
          const age = t - p.t;
          const r = age * 260 * speedFactor(settings.speed);
          const k = Math.max(0, 1 - Math.abs(Math.hypot(g.x - o.x, g.y - o.y) - r) / 26) * (1 - age / PRESS_LIFE);
          c = add(c, scale(pressColor(p), k));
        }
        break;
      }
      case 7: {
        // Stars twinkle: random keys fade in and out.
        const id = g.key.index;
        const ph = T * 0.45 + hash01(id, 1);
        const n = Math.floor(ph);
        const on = hash01(id, n + 11) < 0.45;
        const k = on ? Math.pow(Math.sin(Math.PI * (ph - n)), 2) : 0;
        c = scale(rainbow ? hsv(hash01(id, n) * 360) : color, k);
        break;
      }
      case 8: {
        // Shadow disappear: board lit; pressed keys go dark and fade back.
        let k = 1;
        for (const p of presses) if (p.index === g.key.index) k = Math.min(k, (t - p.t) / PRESS_LIFE);
        c = scale(base(g), k * k);
        break;
      }
      case 9: {
        // Retro snake: a short snake winds along the rows.
        const len = 9;
        const pos = (T * 14) % SNAKE.length;
        const at = SNAKE_POS.get(g.key.index)!;
        const back = (pos - at + SNAKE.length) % SNAKE.length;
        if (back < len) c = scale(rainbow ? hsv(at * 9 + T * 40) : color, 1 - back / len);
        break;
      }
      case 10: // Neon stream: bands of light stream across; colourful cycles the colour
        c = rainbow
          ? hsv(T * 45 + g.u * 40)
          : scale(color, 0.3 + 0.7 * (1 + Math.sin(2 * Math.PI * (g.u * 1.2 - T * 0.5))) / 2);
        break;
      case 11: {
        // Reaction: the pressed key lights up and fades.
        for (const p of presses) {
          if (p.index !== g.key.index) continue;
          c = add(c, scale(pressColor(p), 1 - (t - p.t) / PRESS_LIFE));
        }
        break;
      }
      case 12: {
        // Sine wave: a sine-shaped band moves across.
        const y = CY + (H / 2.6) * Math.sin(2 * Math.PI * (g.u * 1.3 - T * 0.45));
        c = scale(base(g, g.u * 360 - T * 60), Math.max(0, 1 - Math.abs(g.y - y) / 48));
        break;
      }
      case 13: {
        // Retinue scanning: a bar sweeps back and forth with a trail.
        const ph = (T * 0.45) % 2;
        const x = X0 + (ph < 1 ? ph : 2 - ph) * W;
        c = scale(base(g), Math.max(0, 1 - Math.abs(g.x - x) / 70));
        break;
      }
      case 14: {
        // Rotating windmill: four rainbow blades turn around the centre.
        const ang = ((g.a - T * 80) * Math.PI) / 180;
        const k = Math.pow(Math.max(0, Math.cos(2 * ang)), 1.5);
        c = scale(hsv(g.a + T * 40), 0.15 + 0.85 * k);
        break;
      }
      case 15: // Colorful waterfall: colours pour down the board
        c = hsv(g.v * 240 - T * 110 + g.u * 30);
        break;
      case 16: // Blossoming: rainbow rings open out from the centre
        c = hsv(g.d * 1.6 - T * 120);
        break;
      case 17: // Rotating storm: a turning rainbow spiral
        c = hsv(g.a + g.d * 1.3 - T * 120);
        break;
      case 18: // Self-define: the per-key colours
        c = input.perKey?.get(g.key.index) ?? BLACK;
        break;
      default: // Off
        c = BLACK;
    }
    out.set(g.key.index, modeIndex === 18 || modeIndex === 19 ? c : scale(c, bri));
  }
  return out;
}

/** Pick a random key for a simulated press. */
export function randomPress(t: number, rnd: () => number = Math.random): PreviewPress {
  const g = PREVIEW_KEYS[Math.floor(rnd() * PREVIEW_KEYS.length)];
  return { index: g.key.index, t, hue: rnd() * 360 };
}

/** Browser KeyboardEvent → MK75 LED index (so typing drives the reactive previews). */
const CODE_VK: Record<string, number> = {
  ShiftLeft: 0xa0,
  ShiftRight: 0xa1,
  ControlLeft: 0xa2,
  ControlRight: 0xa3,
  AltLeft: 0xa4,
  AltRight: 0xa5,
  MetaLeft: 0x5b,
};
export function keyIndexForEvent(code: string, keyCode: number): number | undefined {
  const vk = CODE_VK[code] ?? keyCode;
  return MK75_KEYS.find((k) => k.vk === vk)?.index;
}
