import { describe, expect, it } from 'vitest';
import { WirelessLink } from '../protocol/wireless/link';
import { MockWirelessIO } from '../protocol/wireless/mockWireless';
import { Mk75Wireless } from '../protocol/wireless/mk75Wireless';
import { byteLabel, describeOffset, diffReads, GUIDE, judgeKey, probeForFile, probeResultsFile, summarise, type ProbeRead } from './sideLightProbe';

const fast = { pace: 0, livePace: 0, ackMs: 300, readMs: 300 };

const led = (patch: Record<number, number> = {}) => {
  const b = new Uint8Array(128);
  b[0x06] = 4;
  b[0x7e] = 0x5a;
  b[0x7f] = 0xa5;
  for (const [o, v] of Object.entries(patch)) b[+o] = v;
  return b;
};
const read = (action: ProbeRead['action'], l: Uint8Array, palette = new Uint8Array(0x200)): ProbeRead => ({ t: 0, action, blocks: { led: l, palette } });

describe('side-light probe', () => {
  it('lists the bytes that differ between two reads, block by block', () => {
    expect(diffReads(read('baseline', led()), read('mode', led()))).toEqual([]);
    const pal = new Uint8Array(0x200);
    pal[0x1a3] = 7;
    expect(diffReads(read('baseline', led()), read('mode', led({ 0x04: 1, 0x06: 3 }), pal))).toEqual([
      { block: 'led', offset: 0x04, from: 0, to: 1 },
      { block: 'led', offset: 0x06, from: 4, to: 3 },
      { block: 'palette', offset: 0x1a3, from: 0, to: 7 },
    ]);
  });

  it('summarises which action moved which byte, with every value seen', () => {
    const reads = [
      read('baseline', led()),
      read('mode', led({ 0x04: 1 })),
      read('mode', led({ 0x04: 2 })),
      read('colour', led({ 0x04: 2, 0x08: 1 })),
      read('replug', led({ 0x04: 2, 0x08: 1 })),
    ];
    expect(summarise(reads)).toEqual([
      { block: 'led', offset: 0x04, values: [0, 1, 2], actions: ['mode'] },
      { block: 'led', offset: 0x08, values: [0, 1], actions: ['colour'] },
    ]);
    expect(summarise(reads.slice(0, 1))).toEqual([]);
  });

  it('names the bytes the app already decodes and leaves the rest unknown', () => {
    expect(describeOffset('led', 0x0e)).toBe('connection mode');
    expect(describeOffset('led', 0x3a)).toBe('effect 0 brightness');
    expect(describeOffset('led', 0x3b + 2 * 18)).toBe('effect 18 speed/colour');
    expect(describeOffset('led', 0x06)).toBe('');
    expect(describeOffset('keymap 1', 0x41)).toBe('key slot 16');
    expect(describeOffset('palette', 0x1f0)).toBe('');
    expect(byteLabel('led', 6)).toBe('led 0x06');
    expect(byteLabel('palette', 0x1a3)).toBe('palette 0x1A3');
  });

  it('stores reads in the device-data file as hex per block', () => {
    const [r] = probeForFile([read('check', led())]);
    expect(r).toMatchObject({ action: 'check', t: '1970-01-01T00:00:00.000Z' });
    expect(r.blocks.led).toHaveLength(256);
    expect(r.blocks.led.slice(-4)).toBe('5aa5');
    expect(r.blocks.palette).toHaveLength(0x400);
  });

  it('keeps every press visible: steady before colour and brightness, breathe before speed, mode last', () => {
    const at = (pred: (s: (typeof GUIDE)[number]) => boolean) => GUIDE.findIndex(pred);
    expect(GUIDE[0]).toMatchObject({ action: 'setup', kind: 'setup' });
    expect(GUIDE[1]).toMatchObject({ action: 'check', kind: 'press' });
    expect(at((s) => s.action === 'colour')).toBeGreaterThan(0);
    expect(at((s) => s.action === 'breathe')).toBe(at((s) => s.action === 'speed') - 1);
    const lastPress = GUIDE.map((s) => s.kind).lastIndexOf('press');
    expect(GUIDE[lastPress].action).toBe('mode');
    const count = (a: string) => GUIDE.filter((s) => s.action === a && s.kind === 'press').length;
    expect([count('colour'), count('brightness'), count('speed'), count('mode')]).toEqual([7, 4, 4, 5]);
    for (const s of GUIDE.filter((x) => x.kind === 'press')) expect(s.codes?.length).toBeGreaterThan(0);
  });

  it('saves the results before the re-plug, which comes last', () => {
    expect(GUIDE.slice(-2).map((s) => s.kind)).toEqual(['save', 'replug']);
    const f = probeResultsFile([read('baseline', led())], { kind: 'wired', flavour: 'g5wired', transport: 'MK75' }, '0.1.0');
    expect(f).toMatchObject({ format: 'mk75-side-light-probe', connection: { flavour: 'g5wired' } });
    expect(f.probe).toHaveLength(1);
  });

  it('accepts the expected key, ignores modifiers and flags anything else', () => {
    const mode = GUIDE.find((s) => s.action === 'mode')!;
    expect(judgeKey(mode, 'ShiftRight')).toBe('right');
    expect(judgeKey(mode, 'ControlRight')).toBe('ignore');
    expect(judgeKey(mode, 'KeyA')).toBe('wrong');
    expect(judgeKey(GUIDE.find((s) => s.action === 'check')!, 'F5')).toBe('right');
    expect(judgeKey(GUIDE.find((s) => s.action === 'check')!, 'F7')).toBe('wrong');
  });

  it('keeps how each press was detected in the file', () => {
    const [r] = probeForFile([{ ...read('mode', led()), signal: 'hid', hid: ['0601'], keys: [] }]);
    expect(r).toMatchObject({ signal: 'hid', hid: ['0601'] });
    expect('keys' in r).toBe(false);
  });

  it('reads every block from the simulator without writing or touching the caches', async () => {
    const io = new MockWirelessIO();
    const dev = new Mk75Wireless(new WirelessLink(io, 0x13, undefined, fast), '3632');
    const ref = { led: io.led, palette: io.palette, layers: [...io.layers] };
    const b = await dev.readRawBlocks();
    expect(Object.keys(b)).toEqual(['led', 'palette', 'keymap 0', 'keymap 1', 'keymap 2', 'keymap 3']);
    expect(b.led).toEqual(io.led);
    // The simulator, like real receivers, sends only the first 490 palette and 504 keymap bytes.
    expect(b.palette.subarray(0, 490)).toEqual(io.palette.subarray(0, 490));
    io.layers.forEach((l, i) => expect(b[`keymap ${i}`].subarray(0, 504)).toEqual(l.subarray(0, 504)));
    b.led[0x06] = 0x99; // a copy: changing it doesn't touch the device or the next read
    expect((await dev.readRawBlocks()).led[0x06]).toBe(io.led[0x06]);
    // Writes replace these arrays, so the same objects mean nothing was written.
    expect(io.led).toBe(ref.led);
    expect(io.palette).toBe(ref.palette);
    io.layers.forEach((l, i) => expect(l).toBe(ref.layers[i]));
  });

  it("refuses to report a sleeping keyboard's zeroed block", async () => {
    const io = new MockWirelessIO();
    const dev = new Mk75Wireless(new WirelessLink(io, 0x13, undefined, fast), '3632');
    io.asleepReads = Infinity;
    await expect(dev.readRawBlocks()).rejects.toThrow(/asleep/);
  });
});
