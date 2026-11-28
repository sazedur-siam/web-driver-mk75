import { describe, expect, it } from 'vitest';
import { MK75_KEYS } from '../device/mk75Layout';
import { hsv, keyIndexForEvent, PRESS_LIFE, PREVIEW_KEYS, previewFrame, REACTIVE_MODES } from './effectPreview';
import { LED_MODES, type ModeSettings, type RGB } from './lighting';

const S: ModeSettings = { speed: 2, brightness: 4, colorful: false, colorIndex: 0 };
const RED: RGB = [255, 0, 0];
const frame = (modeIndex: number, t = 1, extra: Partial<Parameters<typeof previewFrame>[0]> = {}) =>
  previewFrame({ modeIndex, settings: S, color: RED, t, ...extra });
const lit = (m: Map<number, RGB>) => [...m.values()].filter((c) => c.some((v) => v > 0)).length;
const same = (a: Map<number, RGB>, b: Map<number, RGB>) => [...a].every(([k, c]) => c.join() === b.get(k)!.join());

describe('effect preview', () => {
  it('colours every key with valid bytes for every effect, settings and time', () => {
    for (const m of LED_MODES)
      for (const colorful of [false, true])
        for (const t of [0, 0.7, 3.3, 61]) {
          const f = previewFrame({ modeIndex: m.index, settings: { ...S, colorful }, color: RED, t, presses: [{ index: 35, t: t - 0.3, hue: 90 }] });
          expect(f.size).toBe(MK75_KEYS.length);
          for (const c of f.values()) for (const v of c) expect(Number.isInteger(v) && v >= 0 && v <= 255).toBe(true);
        }
  });

  it('Fixed on uses the palette colour scaled by brightness', () => {
    expect(frame(0).get(0)).toEqual([255, 0, 0]);
    const dim = previewFrame({ modeIndex: 0, settings: { ...S, brightness: 0 }, color: RED, t: 0 });
    expect(dim.get(0)).toEqual([51, 0, 0]);
  });

  it('Off is dark and Self-define shows the per-key colours as they are', () => {
    expect(lit(frame(19))).toBe(0);
    const f = frame(18, 1, { perKey: new Map([[0, [1, 2, 3] as RGB]]) });
    expect(f.get(0)).toEqual([1, 2, 3]);
    expect(lit(f)).toBe(1);
  });

  it('animated effects change over time; speed changes how fast', () => {
    for (const i of [1, 2, 4, 5, 7, 9, 10, 12, 13, 14, 15, 16, 17]) expect(same(frame(i, 1), frame(i, 1.4)), LED_MODES[i].name).toBe(false);
    const slow = previewFrame({ modeIndex: 2, settings: { ...S, speed: 0 }, color: RED, t: 2 });
    const fast = previewFrame({ modeIndex: 2, settings: { ...S, speed: 4 }, color: RED, t: 0.5 });
    expect(same(slow, fast)).toBe(true); // 0.5x for 2 s == 2x for 0.5 s
  });

  it('reactive effects light up from a press and settle after it', () => {
    const space = 35;
    for (const i of REACTIVE_MODES) {
      const idle = frame(i, 5);
      const pressed = frame(i, 5, { presses: [{ index: space, t: 4.9, hue: 0 }] });
      expect(same(idle, pressed), LED_MODES[i].name).toBe(false);
      const after = frame(i, 5 + PRESS_LIFE, { presses: [{ index: space, t: 5, hue: 0 }] });
      expect(same(idle, after), LED_MODES[i].name).toBe(true);
    }
    expect(frame(11, 5, { presses: [{ index: space, t: 5, hue: 0 }] }).get(space)).toEqual([255, 0, 0]);
    expect(frame(8, 5, { presses: [{ index: space, t: 5, hue: 0 }] }).get(space)).toEqual([0, 0, 0]);
  });

  it('colourful uses many hues', () => {
    const f = previewFrame({ modeIndex: 0, settings: { ...S, colorful: true }, color: RED, t: 0 });
    expect(new Set([...f.values()].map((c) => c.join())).size).toBeGreaterThan(10);
  });

  it('maps browser keys to LED indices', () => {
    expect(keyIndexForEvent('KeyA', 0x41)).toBe(MK75_KEYS.find((k) => k.label === 'A')!.index);
    expect(keyIndexForEvent('ShiftRight', 0x10)).toBe(82);
    expect(keyIndexForEvent('F13', 0x7c)).toBeUndefined();
  });

  it('hsv covers the primaries and every key has geometry', () => {
    expect(hsv(0)).toEqual([255, 0, 0]);
    expect(hsv(120)).toEqual([0, 255, 0]);
    expect(hsv(-120)).toEqual([0, 0, 255]);
    for (const g of PREVIEW_KEYS) expect(g.u >= 0 && g.u <= 1 && g.v >= 0 && g.v <= 1).toBe(true);
  });
});
