import { describe, expect, it } from 'vitest';
import { MK75_KEYS } from '../device/mk75Layout';
import { EXAMPLE_EFFECT, newLayer, renderEffect, type CustomEffect } from './effectDesigner';

const idx = (l: string) => MK75_KEYS.find((k) => k.label === l)!.index;
const fx = (layers: CustomEffect['layers']): CustomEffect => ({ id: 'x', name: 'x', layers });

describe('effect designer', () => {
  it('solid layer on selected keys only', () => {
    const m = renderEffect(fx([{ ...newLayer('solid'), keys: [idx('W')], colors: [[10, 20, 30], [0, 0, 0]] }]), 0);
    expect(m.get(idx('W'))).toEqual([10, 20, 30]);
    expect(m.get(idx('Q'))).toEqual([0, 0, 0]);
  });
  it('blend modes: replace, add (clamped), max', () => {
    const base = { ...newLayer('solid'), colors: [[200, 0, 0], [0, 0, 0]] as [[number, number, number], [number, number, number]] };
    const top = (blend: 'replace' | 'add' | 'max') => ({ ...newLayer('solid'), blend, colors: [[100, 50, 0], [0, 0, 0]] as [[number, number, number], [number, number, number]] });
    const q = idx('Q');
    expect(renderEffect(fx([base, top('replace')]), 0).get(q)).toEqual([100, 50, 0]);
    expect(renderEffect(fx([base, { ...top('add'), colors: [[100, 50, 0], [0, 0, 0]] }]), 0).get(q)).toEqual([255, 50, 0]);
    expect(renderEffect(fx([base, top('max')]), 0).get(q)).toEqual([200, 50, 0]);
  });
  it('wave moves over time and reactive decays after a press', () => {
    const wave = fx([{ ...newLayer('wave'), width: 0.1 }]);
    const a = renderEffect(wave, 0).get(idx('Esc'));
    const b = renderEffect(wave, 0.7).get(idx('Esc'));
    expect(a).not.toEqual(b);
    const react = fx([{ ...newLayer('reactive'), speed: 1, colors: [[255, 255, 255], [0, 0, 0]] }]);
    const pressed = new Map([[idx('A'), 10]]);
    expect(renderEffect(react, 10, pressed).get(idx('A'))).toEqual([255, 255, 255]);
    expect(renderEffect(react, 10.5, pressed).get(idx('A'))![0]).toBeLessThan(255);
    expect(renderEffect(react, 12, pressed).get(idx('A'))).toEqual([0, 0, 0]);
  });
  it('example effect renders all keys within range and is deterministic', () => {
    const m1 = renderEffect(EXAMPLE_EFFECT, 1.23);
    const m2 = renderEffect(EXAMPLE_EFFECT, 1.23);
    expect(m1.size).toBe(MK75_KEYS.length);
    expect([...m1.values()].every((c) => c.every((v) => v >= 0 && v <= 255))).toBe(true);
    expect([...m1]).toEqual([...m2]);
  });
});
