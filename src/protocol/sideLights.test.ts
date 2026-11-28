import { describe, expect, it } from 'vitest';
import { WirelessLink } from './wireless/link';
import { MockWirelessIO } from './wireless/mockWireless';
import { Mk75Wireless } from './wireless/mk75Wireless';

const fast = { pace: 0, livePace: 0, ackMs: 300, readMs: 300 };
const make = () => {
  const io = new MockWirelessIO();
  return { io, dev: new Mk75Wireless(new WirelessLink(io, 0x13, undefined, fast), '3632') };
};
const diff = (a: Uint8Array, b: Uint8Array) => [...a].flatMap((v, i) => (v === b[i] ? [] : [i]));

describe('side lights (layout B 0x12 mode, 0x13 colour, 0x14 brightness, 0x15 speed)', () => {
  it('reads all four from the config block', async () => {
    const { io, dev } = make();
    io.led.set([4, 6, 2, 0], 0x12);
    expect(await dev.readSideLights()).toEqual({ mode: 4, colour: 6, brightness: 2, speed: 0 });
  });

  it('brightness and speed writes change only their own byte', async () => {
    const { io, dev } = make();
    const before = new Uint8Array(io.led);
    await dev.writeSideLights({ brightness: 1 });
    expect(diff(before, io.led)).toEqual([0x14]);
    const mid = new Uint8Array(io.led);
    await dev.writeSideLights({ speed: 0 });
    expect(diff(mid, io.led)).toEqual([0x15]);
  });

  it('an empty write sends nothing', async () => {
    const { io, dev } = make();
    const ref = io.led;
    await dev.writeSideLights({});
    expect(io.led).toBe(ref);
  });

  it('a mode write changes only byte 0x12, a colour write only 0x13', async () => {
    const { io, dev } = make();
    const before = new Uint8Array(io.led);
    await dev.writeSideLights({ mode: 1 });
    expect(diff(before, io.led)).toEqual([0x12]);
    const mid = new Uint8Array(io.led);
    await dev.writeSideLights({ colour: 5 });
    expect(diff(mid, io.led)).toEqual([0x13]);
    expect(await dev.readSideLights()).toEqual({ mode: 1, colour: 5, brightness: 4, speed: 4 });
    expect([io.led[0x7e], io.led[0x7f]]).toEqual([0x5a, 0xa5]);
  });

  it('refuses out-of-range values without writing anything', async () => {
    const { io, dev } = make();
    const ref = io.led;
    await expect(dev.writeSideLights({ mode: 5 })).rejects.toThrow(RangeError);
    await expect(dev.writeSideLights({ colour: 7 })).rejects.toThrow(RangeError);
    await expect(dev.writeSideLights({ mode: -1 })).rejects.toThrow(RangeError);
    await expect(dev.writeSideLights({ colour: 1.5 })).rejects.toThrow(RangeError);
    await expect(dev.writeSideLights({ brightness: 5 })).rejects.toThrow(RangeError);
    await expect(dev.writeSideLights({ mode: 1, speed: 9 })).rejects.toThrow(RangeError); // one bad field stops the whole write
    expect(io.led).toBe(ref); // SetLed replaces the array: same object = nothing written
  });

  it('never writes the zeroed block a sleeping keyboard returns', async () => {
    const { io, dev } = make();
    const ref = io.led;
    io.asleepReads = Infinity;
    await expect(dev.writeSideLights({ mode: 2 })).rejects.toThrow(/asleep/);
    expect(io.led).toBe(ref);
  });

  it('keeps a concurrent debounce write and a side-light write from undoing each other', async () => {
    const { io, dev } = make();
    await Promise.all([dev.writeSettings({ debounce: 4 }), dev.writeSideLights({ mode: 0, colour: 2 })]);
    expect([io.led[0x03], io.led[0x12], io.led[0x13]]).toEqual([4, 0, 2]);
  });
});
