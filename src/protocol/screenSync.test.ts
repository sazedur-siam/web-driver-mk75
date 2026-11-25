import { describe, expect, it } from 'vitest';
import { MK75_KEYS } from '../device/mk75Layout';
import { saturate, screenColours, ScreenSync, type Frame } from './screenSync';

/** 32×12 frame: left half red, right half blue; bottom row green. */
function testFrame(): Frame {
  const w = 32,
    h = 12;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const c = y === h - 1 ? [0, 255, 0] : x < w / 2 ? [255, 0, 0] : [0, 0, 255];
      data.set([...c, 255], o);
    }
  return { data, width: w, height: h };
}
const idx = (l: string) => MK75_KEYS.find((k) => k.label === l)!.index;

describe('screen sync', () => {
  it('zones map screen halves to keyboard halves', () => {
    const m = screenColours(testFrame(), 'zones');
    expect(m.get(idx('Q'))).toEqual([255, 0, 0]);
    expect(m.get(idx('P'))).toEqual([0, 0, 255]);
    expect(m.size).toBe(MK75_KEYS.length);
  });
  it('average and bottom edge', () => {
    const avg = screenColours(testFrame(), 'average').get(idx('G'))!;
    expect(avg[0]).toBeGreaterThan(100);
    expect(avg[2]).toBeGreaterThan(100);
    expect(screenColours(testFrame(), 'edge').get(idx('Esc'))![1]).toBeGreaterThan(100); // green bottom row
  });
  it('saturation boost keeps greys grey and pushes colour', () => {
    expect(saturate([128, 128, 128], 2)).toEqual([128, 128, 128]);
    const s = saturate([200, 100, 100], 1.5);
    expect(s[0]).toBeGreaterThan(200);
    expect(s[1]).toBeLessThan(100);
  });
  it('smoothing eases towards new colours; frame is 126×RGB', () => {
    const ss = new ScreenSync('average', 0.5, 1);
    const black: Frame = { data: new Uint8ClampedArray(4 * 4).fill(0), width: 2, height: 2 };
    const white: Frame = { data: new Uint8ClampedArray(4 * 4).fill(255), width: 2, height: 2 };
    ss.frame(black);
    const f = ss.frame(white);
    expect(f.length).toBe(378);
    const q = idx('Q');
    expect(f[3 * q]).toBeGreaterThan(100);
    expect(f[3 * q]).toBeLessThan(200); // halfway, not jumped
  });
});
