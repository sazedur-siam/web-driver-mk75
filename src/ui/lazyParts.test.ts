import { describe, expect, it } from 'vitest';
import { reloadOnceForNewBuild } from './lazyParts';

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

describe('reload after a chunk fails to load', () => {
  it('reloads once per session, then leaves it to the fallback card', () => {
    const s = memory();
    let reloads = 0;
    expect(reloadOnceForNewBuild(s, () => reloads++)).toBe(true);
    expect(reloadOnceForNewBuild(s, () => reloads++)).toBe(false);
    expect(reloads).toBe(1);
  });

  it('never reloads without session storage, so a blocked storage cannot cause a reload loop', () => {
    let reloads = 0;
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => undefined,
    };
    expect(reloadOnceForNewBuild(throwing, () => reloads++)).toBe(false);
    expect(reloadOnceForNewBuild(null, () => reloads++)).toBe(false);
    expect(reloads).toBe(0);
  });
});
