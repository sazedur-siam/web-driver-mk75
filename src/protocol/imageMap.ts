/**
 * Image → keys. The image is drawn onto a canvas shaped like the MK75's key area (BOARD_W × BOARD_H, in the
 * vendor layout's coordinate units); each key takes the average colour under its rectangle.
 */
import { MK75_KEYS } from '../device/mk75Layout';
import type { RGB } from './lighting';
import { STREAM_LEN } from './mk75';
import type { Frame } from './screenSync';

const X0 = Math.min(...MK75_KEYS.map((k) => k.x1));
const Y0 = Math.min(...MK75_KEYS.map((k) => k.y1));
export const BOARD_W = Math.max(...MK75_KEYS.map((k) => k.x2)) - X0;
export const BOARD_H = Math.max(...MK75_KEYS.map((k) => k.y2)) - Y0;

/** Average colour of each key's rectangle on a board-shaped frame (any resolution with the board's aspect). */
export function sampleBoard(f: Frame): Map<number, RGB> {
  const sx = f.width / BOARD_W;
  const sy = f.height / BOARD_H;
  const out = new Map<number, RGB>();
  for (const k of MK75_KEYS) {
    // Inset 15 % so neighbouring keys don't bleed in.
    const ix = (k.x2 - k.x1) * 0.15;
    const iy = (k.y2 - k.y1) * 0.15;
    const x0 = Math.max(0, Math.floor((k.x1 - X0 + ix) * sx));
    const x1 = Math.min(f.width, Math.max(x0 + 1, Math.ceil((k.x2 - X0 - ix) * sx)));
    const y0 = Math.max(0, Math.floor((k.y1 - Y0 + iy) * sy));
    const y1 = Math.min(f.height, Math.max(y0 + 1, Math.ceil((k.y2 - Y0 - iy) * sy)));
    let r = 0,
      g = 0,
      b = 0,
      n = 0;
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const o = (y * f.width + x) * 4;
        const a = f.data[o + 3] / 255; // transparent pixels count as black
        r += f.data[o] * a;
        g += f.data[o + 1] * a;
        b += f.data[o + 2] * a;
        n++;
      }
    out.set(k.index, n ? ([r / n, g / n, b / n].map(Math.round) as RGB) : [0, 0, 0]);
  }
  return out;
}

/** Brightness (0..2) and contrast (0..3) adjustment, clamped to 0..255. */
export function adjust([r, g, b]: RGB, brightness: number, contrast: number): RGB {
  return [r, g, b].map((c) => Math.max(0, Math.min(255, Math.round(((c - 128) * contrast + 128) * brightness)))) as RGB;
}

export function coloursToRecord(m: Map<number, RGB>, brightness = 1, contrast = 1): Record<number, RGB> {
  return Object.fromEntries([...m].map(([k, c]) => [k, adjust(c, brightness, contrast)]));
}

export function recordToFrame(rec: Record<number, RGB>): Uint8Array {
  const out = new Uint8Array(STREAM_LEN);
  for (const [k, c] of Object.entries(rec)) out.set(c, 3 * Number(k));
  return out;
}

export interface Placement {
  zoom: number; // 1 = cover the board
  x: number; // -1..1 pan
  y: number; // -1..1 pan
}

/** Destination rectangle for drawing a w×h image onto the board canvas ("cover" fit, then zoom/pan). */
export function placeImage(w: number, h: number, cw: number, ch: number, p: Placement) {
  const cover = Math.max(cw / w, ch / h) * p.zoom;
  const dw = w * cover;
  const dh = h * cover;
  const dx = (cw - dw) / 2 - (p.x * (dw - cw)) / 2; // x = -1 shows the left edge
  const dy = (ch - dh) / 2 - (p.y * (dh - ch)) / 2; // y = -1 shows the top edge
  return { dx, dy, dw, dh };
}
