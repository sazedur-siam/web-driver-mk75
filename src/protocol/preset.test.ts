import { describe, expect, it } from 'vitest';
import { MK75_KEYS } from '../device/mk75Layout';
import { encodeAction, getKeyCode } from './keycodes';
import { parseProfile, parseRgbTable, type RGB } from './lighting';
import { MockMk75 } from './mock';
import { applyPresetToBlocks, decodePreset, encodePreset, presetFromBlocks, validatePreset, type Preset } from './preset';

const blocks = () => {
  const m = new MockMk75();
  return { profile: m.profile, rgbTable: m.rgbTable, matrix: m.matrix };
};

describe('shareable presets', () => {
  it('round-trips through a compact link', async () => {
    const perKey: Record<number, RGB> = Object.fromEntries(MK75_KEYS.map((k) => [k.index, [k.index, 255 - k.index, 128] as RGB]));
    const p: Preset = {
      v: 1,
      name: 'Neon WASD',
      lighting: { mode: 1, speed: 3, brightness: 4, colorful: false, colorIndex: 2, palette: Array.from({ length: 7 }, (_, i) => [i * 30, 0, 255] as RGB) },
      perKey,
      keys: { 3: { kind: 'key', usage: 0xe0, mods: 0 }, 92: { kind: 'consumer', usage: 0xcd } },
    };
    const s = await encodePreset(p);
    expect(s).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(s.length).toBeLessThan(1600); // full 81-key colour map stays link-sized
    expect(await decodePreset(s)).toEqual(p);
  });

  it('rejects damaged or invalid links', async () => {
    await expect(decodePreset('not-a-real-link')).rejects.toThrow(/damaged/);
    expect(() => validatePreset({ v: 2, name: 'x' })).toThrow();
    expect(() => validatePreset({ v: 1, name: 'x', lighting: { mode: 1, speed: 9, brightness: 0, colorful: false, colorIndex: 0 } })).toThrow(/lighting/);
    for (const mode of ['18', 'length', 'map', 1.5])
      expect(() => validatePreset({ v: 1, name: 'x', lighting: { mode, speed: 1, brightness: 1, colorful: false, colorIndex: 0 } })).toThrow(/lighting/);
    expect(() => validatePreset({ v: 1, name: 'x', keys: { 59: { kind: 'key', usage: 4, mods: 0 } } })).toThrow(/key/); // Fn key
    expect(() => validatePreset({ v: 1, name: 'x', keys: { 46: { kind: 'macro', slot: 0, mode: 1 } } })).toThrow(/key/);
    expect(() => validatePreset({ v: 1, name: 'empty' })).toThrow(/empty/);
  });

  it('captures only non-default keys and applies onto keyboard blocks', () => {
    const b = blocks();
    const defaults = new Uint8Array(b.matrix);
    const p = applyPresetToBlocks(
      { v: 1, name: 't', lighting: { mode: 2, speed: 1, brightness: 3, colorful: true, colorIndex: 0, palette: Array(7).fill([1, 2, 3]) }, keys: { 8: { kind: 'key', usage: 0x1d, mods: 0 } } },
      b,
    );
    expect(parseProfile(p.profile).activeIndex).toBe(2);
    expect(parseProfile(p.profile).perMode[2]).toEqual({ speed: 1, brightness: 3, colorful: true, colorIndex: 0 });
    expect(parseRgbTable(p.rgbTable)[2][0]).toEqual([1, 2, 3]);
    expect(getKeyCode(p.matrix, 8)).toBe(encodeAction({ kind: 'key', usage: 0x1d, mods: 0 }));

    const captured = presetFromBlocks('back', p, (i) => getKeyCode(defaults, i), null);
    expect(Object.keys(captured.keys!)).toEqual(['8']);
    expect(captured.lighting!.mode).toBe(2);
  });
});
