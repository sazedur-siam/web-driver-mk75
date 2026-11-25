import { describe, expect, it } from 'vitest';
import { encodeMacroSlot } from './macro';
import { splitText, textToEvents } from './textMacro';

const fmt = (r: ReturnType<typeof textToEvents>) => r.events.map((e) => `${e.down ? 'v' : '^'}${e.usage.toString(16)}`).join(' ');

describe('text → macro', () => {
  it('"Hi!" holds Shift for H and !, not i', () => {
    expect(fmt(textToEvents('Hi!'))).toBe('ve1 vb ^b ^e1 vc ^c ve1 v1e ^1e ^e1');
  });
  it('merges consecutive shifted characters into one Shift hold', () => {
    expect(fmt(textToEvents('AB'))).toBe('ve1 v4 ^4 v5 ^5 ^e1');
  });
  it('maps space, newline and tab; reports unsupported characters', () => {
    const r = textToEvents('a b\n\té€');
    expect(fmt(r)).toBe('v4 ^4 v2c ^2c v5 ^5 v28 ^28 v2b ^2b');
    expect(r.unsupported).toEqual(['é', '€']);
  });
  it('encodes into the vendor slot format with the chosen delay', () => {
    const slot = encodeMacroSlot(textToEvents('a', 10).events).slot;
    expect([...slot.slice(0, 6)]).toEqual([0x00, 0x01, 0x8a, 0x04, 0x0a, 0x04]);
  });
  it('knows the 128-byte capacity and splits long text', () => {
    expect(textToEvents('a'.repeat(31)).fits).toBe(true); // 2 + 31*4 = 126
    expect(textToEvents('a'.repeat(32)).fits).toBe(false);
    const parts = splitText('hello@example.com '.repeat(4));
    expect(parts.join('')).toBe('hello@example.com '.repeat(4));
    expect(parts.every((p) => textToEvents(p).fits)).toBe(true);
    expect(parts.length).toBeGreaterThan(1);
  });
});
