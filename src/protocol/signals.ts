/**
 * Light signals: the keyboard as a status display while the page is open.
 * Each generator returns per-key colours; keys not mentioned show the dim background.
 */
import { MK75_KEYS } from '../device/mk75Layout';
import type { RGB } from './lighting';
import { STREAM_LEN } from './mk75';

const byLabel = (l: string) => MK75_KEYS.find((k) => k.label === l)!.index;
export const F_ROW = Array.from({ length: 12 }, (_, i) => byLabel(`F${i + 1}`));
export const NUM_ROW = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '='].map(byLabel);
const ESC = byLabel('Esc');
const ALL = MK75_KEYS.map((k) => k.index);

const lerp = (a: RGB, b: RGB, t: number): RGB => [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t)) as RGB;
const scale = (c: RGB, k: number): RGB => c.map((v) => Math.round(v * k)) as RGB;

/** Pomodoro / countdown: F-row progress bar (green → orange → red), flashing board when finished. */
export function timerColours(elapsedMs: number, totalMs: number, background: RGB): Map<number, RGB> {
  const m = new Map<number, RGB>(ALL.map((i) => [i, scale(background, 0.15)]));
  if (elapsedMs >= totalMs) {
    const on = Math.floor((elapsedMs - totalMs) / 400) % 2 === 0;
    for (const i of ALL) m.set(i, on ? [255, 40, 40] : [255, 255, 255]);
    return m;
  }
  const p = Math.max(0, elapsedMs) / totalMs;
  const lit = p * F_ROW.length;
  const col: RGB = p < 0.6 ? lerp([0, 230, 90], [255, 170, 0], p / 0.6) : lerp([255, 170, 0], [255, 30, 30], (p - 0.6) / 0.4);
  F_ROW.forEach((k, i) => {
    const frac = Math.max(0, Math.min(1, lit - i));
    m.set(k, frac > 0 ? scale(col, 0.25 + 0.75 * frac) : scale(background, 0.15));
  });
  return m;
}

/** Clock: hour (1-12) lit along the number row, minutes in 5-minute steps on the F-row, seconds pulse on Esc. */
export function clockColours(d: Date, background: RGB): Map<number, RGB> {
  const m = new Map<number, RGB>(ALL.map((i) => [i, scale(background, 0.12)]));
  const h = d.getHours() % 12 || 12;
  const five = Math.floor(d.getMinutes() / 5); // 0..11
  NUM_ROW.forEach((k, i) => i < h && m.set(k, [0, 200, 255]));
  F_ROW.forEach((k, i) => i < five && m.set(k, [255, 140, 0]));
  const pulse = 0.3 + 0.7 * Math.abs(Math.sin((d.getMilliseconds() / 1000) * Math.PI));
  m.set(ESC, scale([255, 255, 255], pulse));
  return m;
}

/** Battery: number row bar (red < 20 %, amber < 50 %, else green); breathing while charging. */
export function batteryColours(level: number, charging: boolean, t: number, background: RGB): Map<number, RGB> {
  const m = new Map<number, RGB>(ALL.map((i) => [i, scale(background, 0.12)]));
  const bar = NUM_ROW.slice(0, 10);
  const col: RGB = level < 0.2 ? [255, 30, 30] : level < 0.5 ? [255, 170, 0] : [0, 230, 90];
  const k = charging ? 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(t * 3)) : 1;
  const lit = Math.max(1, Math.round(level * bar.length));
  bar.forEach((key, i) => i < lit && m.set(key, scale(col, k)));
  return m;
}

/** Per-key colours → 126×RGB live frame. */
export function coloursToFrame(m: Map<number, RGB>, brightness = 1): Uint8Array {
  const out = new Uint8Array(STREAM_LEN);
  for (const [idx, c] of m) out.set(scale(c, brightness), 3 * idx);
  return out;
}
