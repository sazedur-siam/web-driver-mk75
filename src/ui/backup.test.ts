import { describe, expect, it } from 'vitest';
import { MockMk75 } from '../protocol/mock';
import { Mk75 } from '../protocol/mk75';
import { WirelessLink } from '../protocol/wireless/link';
import { MockWirelessIO } from '../protocol/wireless/mockWireless';
import { Mk75Wireless } from '../protocol/wireless/mk75Wireless';
import { buildBackup, parseBackup, restoreBackup } from './backup';
import { macroStore } from './macroStore';
import type { DeviceSnapshot } from './useDevice';

const read = async (d: { readProfile(): Promise<Uint8Array>; readKeyMatrix(): Promise<Uint8Array>; readRgbTable(): Promise<Uint8Array> }): Promise<DeviceSnapshot> => ({
  profile: await d.readProfile(),
  matrix: await d.readKeyMatrix(),
  rgbTable: await d.readRgbTable(),
});
const wireless = () => {
  const io = new MockWirelessIO();
  return { io, dev: new Mk75Wireless(new WirelessLink(io, 0x13, undefined, { pace: 0, livePace: 0, ackMs: 300, readMs: 300 }), '3632') };
};

describe('backup', () => {
  it('saves the side lights and restores them, changing only those bytes of the config block', async () => {
    macroStore.replaceAll({ macros: [], assignments: {} });
    const { io, dev } = wireless();
    const snap = await read(dev);
    const file = parseBackup(JSON.stringify(buildBackup(snap, await dev.readSideLights())));
    expect(file.sideLights).toEqual({ mode: 3, colour: 0, brightness: 4, speed: 4 });

    await dev.writeSideLights({ mode: 1, colour: 5, brightness: 0, speed: 2 }); // changed after the backup
    const before = new Uint8Array(io.led);
    const res = await restoreBackup(dev, snap, file);
    expect(res.notes).toEqual([]);
    expect([...io.led.subarray(0x12, 0x16)]).toEqual([3, 0, 4, 4]);
    const moved = [...io.led].flatMap((v, i) => (v === before[i] ? [] : [i]));
    expect(moved).toEqual([0x12, 0x13, 0x14, 0x15]);
  });

  it('an older backup without side lights leaves them as they are', async () => {
    const { io, dev } = wireless();
    const snap = await read(dev);
    const file = parseBackup(JSON.stringify({ ...buildBackup(snap), sideLights: undefined }));
    expect(file.sideLights).toBeUndefined();
    await dev.writeSideLights({ mode: 4, colour: 6 });
    await restoreBackup(dev, snap, file);
    expect([...io.led.subarray(0x12, 0x14)]).toEqual([4, 6]);
  });

  it('skips the side lights on a board without them, and says so', async () => {
    const dev = new Mk75(new MockMk75(), { readDelayMs: 0, writeDelayMs: 0 });
    const snap = await read(dev);
    const file = parseBackup(JSON.stringify(buildBackup(snap, { mode: 3, colour: 2, brightness: 4, speed: 4 })));
    const res = await restoreBackup(dev, snap, file);
    expect(res.notes).toHaveLength(1);
    expect(res.notes[0]).toMatch(/side lights/);
  });

  it('rejects damaged files before anything is written', async () => {
    const { dev } = wireless();
    const good = buildBackup(await read(dev), await dev.readSideLights());
    expect(() => parseBackup(JSON.stringify({ ...good, format: 'other' }))).toThrow(/Not a Lingbao/);
    expect(() => parseBackup(JSON.stringify({ ...good, keyMatrix: '00' }))).toThrow(/truncated/);
    expect(() => parseBackup(JSON.stringify({ ...good, profile: undefined }))).toThrow(/truncated/);
    expect(() => parseBackup(JSON.stringify({ ...good, sideLights: { mode: 9 } }))).toThrow(/side lights/);
    expect(() => parseBackup(JSON.stringify({ ...good, sideLights: 'steady' }))).toThrow(/side lights/);
    // Out-of-range fields are dropped, like in profiles; the valid ones are kept.
    expect(parseBackup(JSON.stringify({ ...good, sideLights: { mode: 2, colour: 99 } })).sideLights).toEqual({ mode: 2 });
  });
});
