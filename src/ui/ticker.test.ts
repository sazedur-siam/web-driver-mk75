import { describe, expect, it } from 'vitest';
import { startTicker } from './ticker';

describe('ticker', () => {
  it('ticks repeatedly and stops cleanly', async () => {
    let n = 0;
    const t = startTicker(5, () => n++);
    await new Promise((r) => setTimeout(r, 60));
    t.stop();
    const after = n;
    expect(after).toBeGreaterThan(3);
    await new Promise((r) => setTimeout(r, 40));
    expect(n).toBe(after); // no ticks after stop
    expect(['worker', 'interval']).toContain(t.kind);
  });
});
