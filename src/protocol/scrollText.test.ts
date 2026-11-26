import { describe, expect, it } from 'vitest';
import { scrollTextFrame } from './scrollText';
import { MK75_KEYS } from '../device/mk75Layout';

const color = [200, 40, 10] as [number, number, number];
describe('scrolling text', () => {
  it('generates a bounded RGB frame and scrolls with time', () => {
    const a = scrollTextFrame('HELLO 123', 0, 3, color, 1);
    const b = scrollTextFrame('HELLO 123', 1, 3, color, 1);
    expect(a).toHaveLength(378);
    expect(a.some((v) => v > 0)).toBe(true);
    expect(a).not.toEqual(b);
    expect(Math.max(...a)).toBeLessThanOrEqual(200);
  });
  it('uses the same glyph for lowercase and uppercase and falls back safely', () => {
    expect(scrollTextFrame('a', 0, 1, color, 1)).toEqual(scrollTextFrame('A', 0, 1, color, 1));
    expect(scrollTextFrame('❤', 0, 1, color, 1)).toEqual(scrollTextFrame('?', 0, 1, color, 1));
  });
  it('returns black for an empty message and applies brightness', () => {
    expect(scrollTextFrame('', 0, 1, color, 1).every((v) => v === 0)).toBe(true);
    const frame = scrollTextFrame('H', 0, 1, color, 0.5);
    expect(Math.max(...frame)).toBe(100);
  });
  it('uses wider strokes separated by a blank column', () => {
    const f = scrollTextFrame('HH', 0, 1, color, 1);
    const lit = (x: number, y: number) => f[(x * 6 + y) * 3] > 0;
    expect([0, 1, 3, 4].map((x) => lit(x, 1))).toEqual([true, true, true, true]);
    expect(lit(2, 1)).toBe(false);
    expect(lit(5, 1)).toBe(false);
  });
  it('supports narrow glyphs and reaches the navigation and arrow LEDs', () => {
    const wide = scrollTextFrame('H', 0, 1, color, 1, 'wide');
    const narrow = scrollTextFrame('H', 0, 1, color, 1, 'narrow');
    expect(wide).not.toEqual(narrow);
    expect(narrow).toEqual(scrollTextFrame('H', 6, 1, color, 1, 'narrow'));
    for (const { index } of MK75_KEYS) {
      expect(Array.from({ length: 8 }, (_, t) => scrollTextFrame('8', t, 1, color, 1)[index * 3]).some(Boolean), `LED ${index}`).toBe(true);
    }
  });
  it('provides a wider block style and can exclude only the bottom row', () => {
    const block = scrollTextFrame('H', 0, 1, color, 1, 'block');
    expect(block).not.toEqual(scrollTextFrame('H', 0, 1, color, 1, 'wide'));
    expect(block).toEqual(scrollTextFrame('H', 10, 1, color, 1, 'block'));
    for (let t = 0; t < 10; t++) {
      const included = scrollTextFrame('8', t, 1, color, 1, 'block', true);
      const excluded = scrollTextFrame('8', t, 1, color, 1, 'block', false);
      for (const { index } of MK75_KEYS) {
        if (index % 6 === 5) expect(excluded.slice(index * 3, index * 3 + 3)).toEqual(new Uint8Array(3));
        else expect(excluded.slice(index * 3, index * 3 + 3)).toEqual(included.slice(index * 3, index * 3 + 3));
      }
    }
  });
  it('wraps continuously with a short gap instead of a blank-screen reset', () => {
    expect(scrollTextFrame('HI', 0, 1, color, 1)).toEqual(scrollTextFrame('HI', 14, 1, color, 1));
    const frame = scrollTextFrame('H', 3, 1, color, 1);
    const lit = (x: number, y: number) => frame[(x * 6 + y) * 3] > 0;
    // One copy exits at the left while the next copy is already entering at the right.
    expect(lit(0, 1)).toBe(true);
    expect(lit(5, 1)).toBe(true);
    expect(frame.some((v) => v > 0)).toBe(true);
  });
});
