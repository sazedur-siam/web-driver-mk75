/**
 * Host-driven live lighting ("Real-time effects" and music mode in the official MK75 driver).
 * The vendor computes every frame on the PC and streams it ~50 fps as report 0x08
 * [0A 7A 01] + 126 x RGB (see Mk75.sendLiveFrame). Frame = base colour x intensity / 255 per key,
 * animated over the key groups in the MK75 Cartoon/ET unit files.
 * The vendor's exact per-mode maths isn't recoverable from the binary; these are close reimplementations.
 */
import { MK75_KEYS } from '../device/mk75Layout';
import { parseColumns, parseUnits, UNIT_FILES } from '../device/mk75Units';
import type { RGB } from './lighting';
import { STREAM_LEN } from './mk75';

export const LED_COUNT = STREAM_LEN / 3; // 126

export const RT_MODES = ['Static', 'Stars', 'Snow', 'Breathing', 'Shrink', 'Aspect', 'Follow', 'Rotating', 'Rainbow wave'] as const;
export type RtMode = (typeof RT_MODES)[number];

export const MUSIC_MODES = ['Spectrum bars', 'Pulse rings', 'Stream', 'Beat flash'] as const;
export type MusicMode = (typeof MUSIC_MODES)[number];

export type ColorSource = { kind: 'solid'; color: RGB } | { kind: 'rainbow' } | { kind: 'perkey'; colors: Map<number, RGB>; fallback: RGB };

const LED_KEYS = MK75_KEYS.map((k) => k.index);
const CENTER = new Map(MK75_KEYS.map((k) => [k.index, { x: (k.x1 + k.x2) / 2, y: (k.y1 + k.y2) / 2 }]));
const XMIN = 26;
const XMAX = 611;

const STREAM = parseUnits(UNIT_FILES.stream);
const WHEEL = parseUnits(UNIT_FILES.wheel);
const FLOWER = parseUnits(UNIT_FILES.flower);
const BARS = parseColumns(UNIT_FILES.audiobar);
const RINGS = parseUnits(UNIT_FILES.flowerRings);

export function hsv(h: number, s = 1, v = 1): RGB {
  h = ((h % 1) + 1) % 1;
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  const [r, g, b] = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6];
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

function baseColor(src: ColorSource, idx: number, t: number): RGB {
  if (src.kind === 'solid') return src.color;
  if (src.kind === 'perkey') return src.colors.get(idx) ?? src.fallback;
  const c = CENTER.get(idx);
  return hsv((c ? (c.x - XMIN) / (XMAX - XMIN) : 0) * 0.8 + t * 0.1);
}

/** Write intensities (0..1 per LED index) × colour into a 378-byte frame. */
export function compose(intensity: Map<number, number>, src: ColorSource, t: number, brightness = 1): Uint8Array {
  const out = new Uint8Array(STREAM_LEN);
  for (const idx of LED_KEYS) {
    const k = Math.max(0, Math.min(1, (intensity.get(idx) ?? 0) * brightness));
    if (k <= 0) continue;
    const [r, g, b] = baseColor(src, idx, t);
    out[3 * idx] = Math.round(r * k);
    out[3 * idx + 1] = Math.round(g * k);
    out[3 * idx + 2] = Math.round(b * k);
  }
  return out;
}

const groupWave = (groups: { keys: number[] }[], phase: number, width: number, wrap: boolean) => {
  const m = new Map<number, number>();
  const n = groups.length;
  groups.forEach((g, i) => {
    let d = Math.abs(i - phase);
    if (wrap) d = Math.min(d, n - d);
    const v = Math.max(0, 1 - d / width);
    for (const k of g.keys) m.set(k, Math.max(m.get(k) ?? 0, v));
  });
  return m;
};

/** Stateful real-time effect generator. `speed` 0.25–3 (1 = normal). */
export class RtEffect {
  private stars = new Map<number, number>();
  private pressed = new Map<number, number>();
  private last = 0;

  constructor(
    public mode: RtMode,
    public speed = 1,
  ) {}

  /** Feed a key press (Follow mode): LED index. */
  press(idx: number) {
    this.pressed.set(idx, 1);
  }

  intensities(t: number): Map<number, number> {
    const dt = Math.min(0.1, Math.max(0, t - this.last));
    this.last = t;
    const s = this.speed;
    switch (this.mode) {
      case 'Static':
      case 'Rainbow wave':
        return new Map(LED_KEYS.map((k) => [k, 1]));
      case 'Breathing': {
        const v = (Math.sin(t * Math.PI * s * 0.8 - Math.PI / 2) + 1) / 2;
        return new Map(LED_KEYS.map((k) => [k, 0.05 + 0.95 * v]));
      }
      case 'Stars': {
        for (const [k, v] of this.stars) {
          const nv = v - dt * 1.4 * s;
          if (nv <= 0) this.stars.delete(k);
          else this.stars.set(k, nv);
        }
        // Expected `rate` new stars per frame: whole part always, fractional part by chance.
        const rate = dt * 14 * s;
        const count = Math.min(6, Math.floor(rate) + (Math.random() < rate % 1 ? 1 : 0));
        for (let i = 0; i < count; i++) this.stars.set(LED_KEYS[Math.floor(Math.random() * LED_KEYS.length)], 1);
        return new Map(this.stars);
      }
      case 'Snow':
        return groupWave(STREAM, (t * 6 * s) % (STREAM.length + 3) - 1.5, 2.2, false);
      case 'Rotating':
        return groupWave(WHEEL, (t * 5 * s) % WHEEL.length, 3, true);
      case 'Shrink': {
        const n = FLOWER.length;
        return groupWave(FLOWER, n - 1 - ((t * 4 * s) % (n + 2)) + 1, 1.6, false);
      }
      case 'Aspect': {
        const n = FLOWER.length;
        return groupWave(FLOWER, ((t * 4 * s) % (n + 2)) - 1, 1.6, false);
      }
      case 'Follow': {
        for (const [k, v] of this.pressed) {
          const nv = v - dt * 1.2 * s;
          if (nv <= 0) this.pressed.delete(k);
          else this.pressed.set(k, nv);
        }
        return new Map(this.pressed);
      }
    }
  }
}

/** Audio analysis → per-key intensity for the music modes. */
export class MusicVisualizer {
  private smoothBands: number[] = [];
  private level = 0;
  private history: number[] = [];
  private peak = 0.05;
  private flash = 0;
  private lastBeat = 0;

  constructor(
    public mode: MusicMode,
    public gain = 1,
    public smooth = 0.6,
    public autoGain = true,
  ) {}

  /** `bins`: byte frequency data (0..255) from an AnalyserNode. */
  intensities(bins: Uint8Array, t: number): Map<number, number> {
    const bands = BARS.length;
    // Log-spaced bands over the useful spectrum.
    const raw: number[] = [];
    const n = bins.length;
    for (let b = 0; b < bands; b++) {
      const lo = Math.floor(Math.pow(n, b / bands) - 1);
      const hi = Math.max(lo + 1, Math.floor(Math.pow(n, (b + 1) / bands) - 1));
      let sum = 0;
      for (let i = lo; i < hi; i++) sum += bins[i];
      raw.push(sum / (hi - lo) / 255);
    }
    const level = raw.reduce((a, b) => a + b, 0) / bands;
    if (this.autoGain) {
      this.peak = Math.max(level, this.peak * 0.995, 0.02);
    }
    const g = this.autoGain ? 0.8 / this.peak : this.gain;
    const a = Math.min(0.95, Math.max(0, this.smooth));
    this.smoothBands = raw.map((v, i) => (this.smoothBands[i] ?? 0) * a + Math.min(1, v * g) * (1 - a));
    this.level = this.level * a + Math.min(1, level * g) * (1 - a);

    const m = new Map<number, number>();
    switch (this.mode) {
      case 'Spectrum bars':
        BARS.forEach((segs, c) => {
          const lit = this.smoothBands[c] * segs.length;
          segs.forEach((keys, si) => {
            const v = Math.max(0, Math.min(1, lit - si));
            for (const k of keys) m.set(k, v);
          });
        });
        break;
      case 'Pulse rings': {
        const lit = this.level * RINGS.length * 1.2;
        RINGS.forEach((r, i) => r.keys.forEach((k) => m.set(k, Math.max(0, Math.min(1, lit - i)))));
        break;
      }
      case 'Stream': {
        this.history.unshift(this.level);
        this.history.length = Math.min(this.history.length, STREAM.length);
        STREAM.forEach((u, i) => u.keys.forEach((k) => m.set(k, this.history[i] ?? 0)));
        break;
      }
      case 'Beat flash': {
        const bass = this.smoothBands[0] ?? 0;
        if (bass > 0.7 && t - this.lastBeat > 0.15) {
          this.flash = 1;
          this.lastBeat = t;
        }
        this.flash *= 0.88;
        for (const k of LED_KEYS) m.set(k, Math.max(this.flash, this.level * 0.25));
        break;
      }
    }
    return m;
  }
}

/** Frame → per-key CSS colours, for the on-screen preview. */
export function frameToFill(frame: Uint8Array): Map<number, string> {
  const m = new Map<number, string>();
  for (const idx of LED_KEYS) {
    const r = frame[3 * idx];
    const g = frame[3 * idx + 1];
    const b = frame[3 * idx + 2];
    m.set(idx, `rgb(${r},${g},${b})`);
  }
  return m;
}
