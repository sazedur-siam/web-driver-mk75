import { describe, expect, it } from 'vitest';
import { parseSideLight, patchSideLight } from './sideLight';
import { G5_OPS } from './g5Wired';
import { Mk75Wireless, type LayoutBLink } from './wireless/mk75Wireless';

function block() {
  const b = new Uint8Array(128);
  b[0x12] = 3; b[0x13] = 1;
  b[0x38] = b[0x39] = 0xff; b[0x7e] = 0x5a; b[0x7f] = 0xa5;
  b[0x20] = 0x77;
  return b;
}

describe('IC2481 side lights', () => {
  it('decodes observed values and patches only requested bytes', () => {
    const original = block();
    expect(parseSideLight(original)).toEqual({ mode: 3, color: 1, brightness: 0, speed: 0 });
    const result = patchSideLight(original, { mode: 4, color: 6, brightness: 2, speed: 4 });
    expect([...result].flatMap((v, i) => v === original[i] ? [] : [i])).toEqual([0x12, 0x13, 0x14, 0x15]);
    expect(original[0x12]).toBe(3);
  });
  it('rejects invalid blocks, unknown states and invalid edits', () => {
    const invalid = block(); invalid[0x38] = 0;
    expect(() => patchSideLight(invalid, { mode: 1 })).toThrow();
    expect(() => patchSideLight(block(), { mode: 5 })).toThrow();
    expect(() => patchSideLight(block(), { color: -1 })).toThrow();
    expect(() => patchSideLight(block(), { brightness: 5 })).toThrow();
    expect(() => patchSideLight(block(), { speed: 1.5 })).toThrow();
    const unknown = block(); unknown[0x13] = 7;
    expect(() => parseSideLight(unknown)).toThrow();
  });
  it('uses a fresh block and preserves fields changed by the keyboard', async () => {
    let raw = block(); let writes = 0;
    const link: LayoutBLink = { io: { name: 'test' }, async read() { return raw.slice(); },
      async write(_cmd, _sub, data) { writes++; raw = data.slice(); }, async close() {} };
    const dev = new Mk75Wireless(link, 'g5wired', G5_OPS);
    expect(await dev.sideLight!.read()).toEqual({ mode: 3, color: 1, brightness: 0, speed: 0 });
    raw[0x13] = 2; // changed at the keyboard after the UI read
    expect(await dev.sideLight!.write({ mode: 4 })).toEqual({ mode: 4, color: 2, brightness: 0, speed: 0 });
    expect(raw[0x20]).toBe(0x77);
    expect(writes).toBe(1);
    await dev.sideLight!.write({ mode: 4 });
    expect(writes).toBe(1);
    expect(new Mk75Wireless(link, '3632').sideLight).toBeUndefined();
    expect(new Mk75Wireless(link, 'combo').sideLight).toBeUndefined();
  });
  it('does not write when the current block has unknown side-light values', async () => {
    const raw = block(); raw[0x12] = 5;
    let writes = 0;
    const link: LayoutBLink = { io: { name: 'test' }, async read() { return raw.slice(); },
      async write() { writes++; }, async close() {} };
    const dev = new Mk75Wireless(link, 'g5wired', G5_OPS);
    await expect(dev.sideLight!.write({ mode: 1 })).rejects.toThrow('Unrecognised');
    expect(writes).toBe(0);
  });
  it('serialises simultaneous read-modify-write operations', async () => {
    let raw = block();
    const link: LayoutBLink = { io: { name: 'test' }, async read() { return raw.slice(); },
      async write(_cmd, _sub, data) { await Promise.resolve(); raw = data.slice(); }, async close() {} };
    const dev = new Mk75Wireless(link, 'g5wired', G5_OPS);
    await Promise.all([dev.sideLight!.write({ mode: 4 }), dev.sideLight!.write({ brightness: 3 })]);
    expect(parseSideLight(raw)).toEqual({ mode: 4, color: 1, brightness: 3, speed: 0 });
  });
});
