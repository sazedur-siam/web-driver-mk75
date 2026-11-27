import { describe, expect, it } from 'vitest';
import { WirelessLink } from '../protocol/wireless/link';
import { MockWirelessIO } from '../protocol/wireless/mockWireless';
import { Mk75Wireless } from '../protocol/wireless/mk75Wireless';
import { describeOffset, diffBlocks, probeForFile, summarise, type ProbeRead } from './sideLightProbe';

const fast = { pace: 0, livePace: 0, ackMs: 300, readMs: 300 };

const block = (patch: Record<number, number> = {}) => {
  const b = new Uint8Array(128);
  b[0x06] = 4;
  b[0x7e] = 0x5a;
  b[0x7f] = 0xa5;
  for (const [o, v] of Object.entries(patch)) b[+o] = v;
  return b;
};
const read = (action: ProbeRead['action'], b: Uint8Array, seen = ''): ProbeRead => ({ t: 0, action, seen, block: b });

describe('side-light probe', () => {
  it('lists the bytes that differ between two reads', () => {
    expect(diffBlocks(block(), block())).toEqual([]);
    expect(diffBlocks(block(), block({ 0x04: 1, 0x06: 3 }))).toEqual([
      { offset: 0x04, from: 0, to: 1 },
      { offset: 0x06, from: 4, to: 3 },
    ]);
  });

  it('summarises which action moved which byte, with every value seen', () => {
    const reads = [
      read('baseline', block()),
      read('mode', block({ 0x04: 1 })),
      read('mode', block({ 0x04: 2 })),
      read('colour', block({ 0x04: 2, 0x08: 1 })),
      read('replug', block({ 0x04: 2, 0x08: 1 })),
    ];
    expect(summarise(reads)).toEqual([
      { offset: 0x04, values: [0, 1, 2], actions: ['mode'] },
      { offset: 0x08, values: [0, 1], actions: ['colour'] },
    ]);
    expect(summarise(reads.slice(0, 1))).toEqual([]);
  });

  it('names the offsets the app already decodes and leaves the rest unknown', () => {
    expect(describeOffset(0x0e)).toBe('connection mode');
    expect(describeOffset(0x3a)).toBe('effect 0 brightness');
    expect(describeOffset(0x3b + 2 * 18)).toBe('effect 18 speed/colour');
    expect(describeOffset(0x06)).toBe('');
    expect(describeOffset(0x74)).toBe('');
  });

  it('stores reads in the device-data file as hex with what the user saw', () => {
    const [r] = probeForFile([read('mode', block(), ' steady, red ')]);
    expect(r).toMatchObject({ action: 'mode', seen: 'steady, red', t: '1970-01-01T00:00:00.000Z' });
    expect(r.block).toHaveLength(256);
    expect(r.block.slice(-4)).toBe('5aa5');
  });

  it('reads the config block from the simulator without writing anything', async () => {
    const io = new MockWirelessIO();
    const dev = new Mk75Wireless(new WirelessLink(io, 0x13, undefined, fast), '3632');
    const ref = io.led;
    const b = await dev.readConfigBlock();
    expect(b).toEqual(io.led);
    b[0x06] = 0x99; // a copy: changing it doesn't touch the device or the next read
    expect((await dev.readConfigBlock())[0x06]).toBe(io.led[0x06]);
    expect(io.led).toBe(ref); // SetLed replaces the array, so the same object means no write
  });

  it('refuses to report a sleeping keyboard\'s zeroed block', async () => {
    const io = new MockWirelessIO();
    const dev = new Mk75Wireless(new WirelessLink(io, 0x13, undefined, fast), '3632');
    io.asleepReads = Infinity;
    await expect(dev.readConfigBlock()).rejects.toThrow(/asleep/);
  });
});
