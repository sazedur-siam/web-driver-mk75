import { describe, expect, it } from 'vitest';
import { MK75_KEYS } from '../device/mk75Layout';
import { colourwayFill, gradient, REGIONS, sampleStops } from './perKeyTools';

const idx = (l: string) => MK75_KEYS.find((k) => k.label === l)!.index;

describe('per-key tools', () => {
  it('samples multi-stop gradients', () => {
    expect(sampleStops([[0, 0, 0], [255, 255, 255]], 0.5)).toEqual([128, 128, 128]);
    expect(sampleStops([[255, 0, 0], [0, 255, 0], [0, 0, 255]], 1)).toEqual([0, 0, 255]);
  });
  it('horizontal gradient runs left (Esc) to right (Delete)', () => {
    const g = gradient([[255, 0, 0], [0, 0, 255]], 'horizontal');
    expect(Object.keys(g)).toHaveLength(MK75_KEYS.length);
    expect(g[idx('Esc')]).toEqual([255, 0, 0]);
    expect(g[idx('Delete')]).toEqual([0, 0, 255]);
    expect(g[idx('G')][0]).toBeGreaterThan(50); // middle is a mix
    expect(g[idx('G')][2]).toBeGreaterThan(50);
  });
  it('radial gradient starts at the origin key and only colours the targets', () => {
    const keys = REGIONS.find((r) => r.id === 'letters')!.keys;
    const g = gradient([[255, 255, 255], [0, 0, 0]], 'radial', keys, idx('G'));
    expect(g[idx('G')]).toEqual([255, 255, 255]);
    expect(g[idx('Esc')]).toBeUndefined();
    expect(Object.keys(g)).toHaveLength(26);
  });
  it('regions and colourway fills', () => {
    expect(REGIONS.find((r) => r.id === 'wasd')!.keys).toHaveLength(8);
    expect(REGIONS.find((r) => r.id === 'frow')!.keys).toHaveLength(13);
    const f = colourwayFill('green-orange');
    expect(f[idx('A')]).toEqual([64, 220, 170]);
    expect(f[idx('Esc')]).toEqual([255, 120, 0]);
    expect(f[idx('Tab')]).toEqual([30, 120, 60]);
  });
});
