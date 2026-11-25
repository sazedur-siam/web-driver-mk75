import { describe, expect, it } from 'vitest';
import { batteryColours, clockColours, coloursToFrame, F_ROW, NUM_ROW, timerColours } from './signals';

const BG: [number, number, number] = [100, 100, 100];
const dim = (c?: number[]) => !!c && c.every((v) => v <= 15);

describe('light signals', () => {
  it('timer fills the F-row with progress', () => {
    const m = timerColours(12.5 * 60_000, 25 * 60_000, BG); // halfway
    const lit = F_ROW.filter((k) => !dim(m.get(k)));
    expect(lit.length).toBe(6);
    expect(m.get(F_ROW[0])![1]).toBeGreaterThan(100); // greenish/amber at 50 %
    expect(dim(m.get(F_ROW[11]))).toBe(true);
  });
  it('timer flashes the whole board when done', () => {
    const a = timerColours(25 * 60_000 + 100, 25 * 60_000, BG);
    const b = timerColours(25 * 60_000 + 500, 25 * 60_000, BG);
    expect(a.get(NUM_ROW[0])).not.toEqual(b.get(NUM_ROW[0]));
  });
  it('clock shows hour on the number row and 5-minute steps on the F-row', () => {
    const m = clockColours(new Date(2026, 0, 1, 15, 27, 10), BG); // 3:27 → 3 hours, 5 five-minute steps
    expect(NUM_ROW.filter((k) => !dim(m.get(k)))).toHaveLength(3);
    expect(F_ROW.filter((k) => !dim(m.get(k)))).toHaveLength(5);
  });
  it('battery bar and colours', () => {
    const m = batteryColours(0.15, false, 0, BG);
    expect(m.get(NUM_ROW[0])).toEqual([255, 30, 30]);
    expect(dim(m.get(NUM_ROW[2]))).toBe(true);
    expect(NUM_ROW.slice(0, 10).filter((k) => !dim(batteryColours(0.8, false, 0, BG).get(k)))).toHaveLength(8);
  });
  it('frames are 126×RGB with brightness applied', () => {
    const f = coloursToFrame(new Map([[0, [200, 100, 50]]]), 0.5);
    expect(f.length).toBe(378);
    expect([...f.slice(0, 3)]).toEqual([100, 50, 25]);
  });
});
