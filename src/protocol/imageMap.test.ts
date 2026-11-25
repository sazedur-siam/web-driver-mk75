import { describe, expect, it } from 'vitest';
import { MK75_KEYS } from '../device/mk75Layout';
import { adjust, BOARD_H, BOARD_W, placeImage, recordToFrame, sampleBoard } from './imageMap';
import type { Frame } from './screenSync';

const idx = (l: string) => MK75_KEYS.find((k) => k.label === l)!.index;

/** Board-shaped frame: top half white, bottom half split red | blue. */
function frame(w = 117, h = 45): Frame {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const c = y < h / 2 ? [255, 255, 255] : x < w / 2 ? [255, 0, 0] : [0, 0, 255];
      data.set([...c, 255], (y * w + x) * 4);
    }
  return { data, width: w, height: h };
}

describe('image to keys', () => {
  it('board size comes from the MK75 layout', () => {
    expect(BOARD_W).toBeGreaterThan(500);
    expect(BOARD_H).toBeGreaterThan(200);
  });
  it('samples the colour under each key', () => {
    const m = sampleBoard(frame());
    expect(m.get(idx('F1'))).toEqual([255, 255, 255]); // top half
    expect(m.get(idx('LCtrl'))).toEqual([255, 0, 0]); // bottom-left
    expect(m.get(idx('Right'))).toEqual([0, 0, 255]); // bottom-right
    expect(m.size).toBe(MK75_KEYS.length);
  });
  it('brightness/contrast adjust and frame layout', () => {
    expect(adjust([128, 128, 128], 1, 3)).toEqual([128, 128, 128]);
    expect(adjust([200, 100, 0], 0.5, 1)).toEqual([100, 50, 0]);
    const f = recordToFrame({ 5: [1, 2, 3] });
    expect(f.length).toBe(378);
    expect([...f.slice(15, 18)]).toEqual([1, 2, 3]);
  });
  it('places an image with cover fit, zoom and pan', () => {
    const p = placeImage(100, 100, 585, 227, { zoom: 1, x: 0, y: 0 });
    expect(p.dw).toBeCloseTo(585);
    expect(p.dh).toBeCloseTo(585);
    expect(p.dy).toBeCloseTo((227 - 585) / 2);
    const top = placeImage(100, 100, 585, 227, { zoom: 1, x: 0, y: -1 });
    expect(top.dy).toBeCloseTo(0);
  });
});
