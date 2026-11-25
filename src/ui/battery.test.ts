import { describe, expect, it } from 'vitest';
import { nextAlerted } from './battery';

describe('nextAlerted', () => {
  it('fires each threshold once, re-arms when charging', () => {
    let a: number | null = null;
    const seen: (number | null)[] = [];
    for (const [level, charging] of [[50, false], [19, false], [18, false], [20, false], [9, false], [5, false], [6, true], [15, false]] as const) {
      const next = nextAlerted(level, charging, a);
      seen.push(next !== a ? next : null);
      a = next;
    }
    // 19 → 20 % alert; 9 → 10 % alert; charging resets; 15 → 20 % alert again.
    expect(seen).toEqual([null, 20, null, null, 10, null, null, 20]);
  });

  it('jumping straight below 10 % fires only the 10 % alert', () => {
    expect(nextAlerted(7, false, null)).toBe(10);
    expect(nextAlerted(19, false, 10)).toBe(10);
  });
});
