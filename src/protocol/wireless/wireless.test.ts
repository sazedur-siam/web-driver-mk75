import { describe, expect, it } from 'vitest';
import { MK75_KEYS } from '../../device/mk75Layout';
import { encodeAction, getKeyCode, setKeyCode } from '../keycodes';
import { CUSTOM_GROUP, CUSTOM_MODE_INDEX, parseProfile, patchProfile, parseRgbTable, patchRgbTable } from '../lighting';
import { wiredToWireless, wirelessToWired } from './codes';
import { WirelessLink } from './link';
import { planMacros } from '../macro';
import { MockWirelessIO } from './mockWireless';
import { Mk75Wireless } from './mk75Wireless';
import { buildPacket, chunk } from './packet';

const hx = (id: number, b: Uint8Array) => [id, ...b].map((x) => x.toString(16).padStart(2, '0')).join(' ');
const fast = { pace: 0, livePace: 0, ackMs: 300, readMs: 300 };

// Expected bytes = requests captured by emulating the vendor CDevComboFilm/CDev3632 send routines.
describe('wireless packets match vendor', () => {
  it('read LED profile request', () => {
    expect(hx(0x15, buildPacket(0x15, 0x44, 1, 0, 0, new Uint8Array(0)))).toBe('15 44 01 00 00 ' + '00 '.repeat(14) + '5a');
  });
  it('online query / matrix layer 1 / reset', () => {
    expect(hx(0x15, buildPacket(0x15, 0x07, 1, 0, 0, new Uint8Array(0))).endsWith('1d')).toBe(true);
    const l1 = buildPacket(0x15, 0x41, 1, 0, 1, new Uint8Array(0));
    expect(hx(0x15, l1).slice(0, 14)).toBe('15 41 01 00 10');
    expect(l1[18]).toBe(0x67);
    expect(buildPacket(0x13, 0x06, 1, 0, 1, new Uint8Array(0))[18]).toBe(0x2a);
  });
  it('on-board write carries data length', () => {
    const p = buildPacket(0x15, 0x0a, 1, 0, 0, Uint8Array.of(3));
    expect(hx(0x15, p).slice(0, 17)).toBe('15 0a 01 00 01 03');
    expect(p[18]).toBe(0x24);
  });
  it('LED write = 10 packets, palette 0x200 = 37 packets, per-key = 27', () => {
    expect(chunk(0x15, 0x04, 0, new Uint8Array(128))).toHaveLength(10);
    expect(chunk(0x15, 0x09, 0, new Uint8Array(0x200))).toHaveLength(37);
    expect(chunk(0x15, 0x02, 0, new Uint8Array(0x17a))).toHaveLength(27);
    expect(chunk(0x15, 0x01, 2, new Uint8Array(512))[0][3]).toBe(0x2e); // layer 2, 14 bytes
  });
});

// Expected = vendor G5KB encoder outputs (emulated) vs wired 916KB encoder outputs.
describe('wired ↔ wireless key codes', () => {
  const pairs: [number, number][] = [
    [0x04000000, 0x04000000], // A
    [0x06010000, 0x06000100], // Ctrl+C
    [0xe0000006, 0x00000100], // LCtrl alone
    [0xcd000004, 0xcd000002], // Play/Pause
    [0x8a010004, 0x8a010002], // Mail
    [0xf0000007, 0x00010101], // left
    [0xf1000007, 0x00010201], // middle
    [0xf2000007, 0x00010301], // right
    [0xf3000007, 0x00010501], // forward
    [0xf4000007, 0x00010401], // back
    [0, 0],
  ];
  it.each(pairs)('%s ↔ %s', (wired, wl) => {
    expect(wiredToWireless(wired)).toBe(wl >>> 0);
    expect(wirelessToWired(wl)).toBe(wired >>> 0);
  });
  it('vendor preset form (key in byte 2) decodes too', () => {
    expect(wirelessToWired(0x001d0100)).toBe(0x1d010000); // Ctrl+Z preset
    expect(wiredToWireless(0x1d010000)).toBe(0x1d000100); // re-encoded in the user-combo form
  });
  it('firmware-only codes pass through as null', () => {
    expect(wirelessToWired(0x14000007)).toBeNull(); // knob function
  });
});

describe('Mk75Wireless adapter against the simulator', () => {
  const make = () => {
    const io = new MockWirelessIO();
    const dev = new Mk75Wireless(new WirelessLink(io, 0x15, undefined, fast), 'combo');
    dev.setLiveLeds(MK75_KEYS.map((k) => k.index));
    return { io, dev };
  };

  it('online + profile round trip in layout B', async () => {
    const { io, dev } = make();
    expect(await dev.online()).toBe(true);
    const p = await dev.readProfile();
    const st = parseProfile(p);
    expect(st.activeIndex).toBe(0);
    expect(p[0x11]).toBe(4);
    st.activeIndex = 1; // Respire hw 2
    st.perMode[1] = { speed: 3, brightness: 1, colorful: true, colorIndex: 0 };
    await dev.writeProfile(patchProfile(p, st));
    expect(io.led[0x0a]).toBe(2);
    expect(io.led[0x3a + 2]).toBe(1);
    expect(io.led[0x3b + 2]).toBe(0x37);
    expect([io.led[0x7e], io.led[0x7f]]).toEqual([0x5a, 0xa5]);
    expect(io.led[0x18]).toBe(4); // untouched sleep preserved
  });

  it('never writes back the zeroed block a sleeping keyboard returns', async () => {
    const { io, dev } = make();
    const p = await dev.readProfile();
    const before = new Uint8Array(io.led);
    io.asleepReads = Infinity;
    const st = parseProfile(p);
    st.activeIndex = 1;
    await expect(dev.writeProfile(patchProfile(p, st))).rejects.toThrow(/asleep/);
    await expect(dev.readProfile()).rejects.toThrow(/asleep/);
    expect(io.led).toEqual(before);
  });

  it('retries past one sleeping read, then saves', async () => {
    const { io, dev } = make();
    const p = await dev.readProfile();
    io.asleepReads = 1;
    const st = parseProfile(p);
    st.activeIndex = 1;
    await dev.writeProfile(patchProfile(p, st));
    expect(io.led[0x0a]).toBe(2);
    expect([io.led[0x38], io.led[0x39]]).toEqual([0xff, 0xff]);
    expect(io.led[0x18]).toBe(4); // real config kept, not the zeroed one
  });

  it('self-define activates custom group 0x20 even if previously 0', async () => {
    const { io, dev } = make();
    io.led[0x0b] = 0;
    const p = await dev.readProfile();
    const st = parseProfile(p);
    st.activeIndex = CUSTOM_MODE_INDEX;
    await dev.writeProfile(patchProfile(p, st));
    expect(io.led[0x09]).toBe(1);
    expect(io.led[0x0a]).toBe(21);
    expect(io.led[0x0b]).toBe(CUSTOM_GROUP);
  });

  it('sleep off / on', async () => {
    const { io, dev } = make();
    const p = await dev.readProfile();
    p[0x11] = 0xff;
    await dev.writeProfile(p);
    expect([io.led[0x16], io.led[0x18]]).toEqual([0, 0]);
    const q = await dev.readProfile();
    expect(q[0x11]).toBe(0xff);
    q[0x11] = 20;
    await dev.writeProfile(q);
    expect([io.led[0x16], io.led[0x18]]).toEqual([0, 20]); // tap/hold threshold untouched
  });

  it('debounce round-trips through byte 0x03 and keeps the rest of the block', async () => {
    const { io, dev } = make();
    expect(await dev.readSettings()).toEqual({ debounce: 2, knob: 0 });
    const before = new Uint8Array(io.led);
    await dev.writeSettings({ debounce: 4 });
    expect(io.led[0x03]).toBe(4);
    before[0x03] = 4;
    expect(io.led).toEqual(before);
    await expect(dev.writeSettings({ debounce: 5 })).rejects.toThrow(RangeError);
    io.asleepReads = Infinity;
    await expect(dev.writeSettings({ debounce: 1 })).rejects.toThrow(/asleep/);
    expect(io.led[0x03]).toBe(4);
  });

  it('concurrent read-modify-writes of the LED block do not undo each other', async () => {
    const { io, dev } = make();
    const p = await dev.readProfile();
    p[0x05] = 3;
    await Promise.all([dev.writeSettings({ debounce: 4 }), dev.writeProfile(p)]);
    expect(io.led[0x03]).toBe(4);
    expect(io.led[0x0a]).toBe(3);
  });

  it('a short block reply is retried, never zero-padded', async () => {
    const { io, dev } = make();
    const full = io.layers[0];
    let short = true; // first read of layer 0 answers with one 14-byte packet
    io.layers = new Proxy(io.layers, {
      get: (t, k) => (k === '0' && short ? ((short = false), full.subarray(0, 14)) : Reflect.get(t, k)),
    });
    const m = await dev.readKeyMatrix();
    expect(short).toBe(false);
    expect(getKeyCode(m, 0)).toBe(0x29000000);
    expect(getKeyCode(m, 20)).toBe(getKeyCode(await dev.readKeyMatrix(), 20));
    expect(getKeyCode(m, 20)).not.toBe(0);
  });

  it('knob mode round-trips through byte 0x1A', async () => {
    const { io, dev } = make();
    await dev.writeSettings({ knob: 1 });
    expect(io.led[0x1a]).toBe(1);
    expect(io.led[0x03]).toBe(2); // debounce untouched
    expect((await dev.readSettings()).knob).toBe(1);
    await expect(dev.writeSettings({ knob: 2 })).rejects.toThrow(RangeError);
  });

  it('reads sleep from byte 0x18 even when 0x16 (tap/hold) is 0', async () => {
    const { io, dev } = make();
    io.led[0x16] = 0;
    io.led[0x18] = 2;
    expect((await dev.readProfile())[0x11]).toBe(2);
  });

  it('key remap converts to wireless encoding and keeps the trailer', async () => {
    const { io, dev } = make();
    const m = await dev.readKeyMatrix();
    expect(getKeyCode(m, 0)).toBe(0x29000000); // Esc in wired view
    await dev.writeKeyMatrix(setKeyCode(m, 3, encodeAction({ kind: 'key', usage: 0x06, mods: 0x01 })));
    const v = new DataView(io.layers[0].buffer);
    expect(v.getUint32(3 * 4, true)).toBe(0x06000100);
    expect(v.getUint32(508, true)).toBe(0xa55a0000);
    expect(v.getUint32(0, true)).toBe(0x29000000); // other keys untouched
  });

  it('macros are refused on combo (0x15) receivers', async () => {
    const { dev } = make();
    await expect(dev.writeMacroPages([])).rejects.toThrow(/receiver type/);
    expect(dev.caps.macros).toBe(false);
  });

  it('macro store over 0x13 receivers: one transfer per block, block in the layer nibble', async () => {
    const io = new MockWirelessIO();
    const dev = new Mk75Wireless(new WirelessLink(io, 0x13, undefined, fast), '3632');
    expect(dev.caps.macros).toBe('store');
    const lib = [{ id: 'x', name: 'X', events: [{ usage: 4, down: true, delay: 20 }] }];
    const plan = planMacros(new Map([[9, { macroId: 'x', mode: 2 as const }]]), lib, 'store');
    await dev.writeMacroPages(plan.pages);
    expect(io.macroBlocks.length).toBe(1);
    expect([...io.macroBlocks[0].subarray(0, 11)]).toEqual([4, 0, 7, 0, 2, 0x58, 0, 0, 0, 20, 4]);
    const m = await dev.readKeyMatrix();
    await dev.writeKeyMatrix(setKeyCode(m, 9, plan.codes.get(9)!));
    expect(new DataView(io.layers[0].buffer).getUint32(36, true)).toBe(0x00010203); // 03 02 01 00
    expect(getKeyCode(await dev.readKeyMatrix(), 9)).toBe(plan.codes.get(9)); // reads back as the wired macro code
  });

  it('macro store is refused when the Fn or tap/hold layer holds an OEM macro cell (ids would shift)', async () => {
    const io = new MockWirelessIO();
    const dev = new Mk75Wireless(new WirelessLink(io, 0x13, undefined, fast), '3632');
    const lib = [{ id: 'x', name: 'X', events: [{ usage: 4, down: true, delay: 20 }] }];
    const plan = planMacros(new Map([[9, { macroId: 'x', mode: 1 as const }]]), lib, 'store');
    new DataView(io.layers[3].buffer).setUint32(5 * 4, 0x00010103, true); // 03 01 01 00: macro 0, mode 1
    await expect(dev.writeMacroPages(plan.pages)).rejects.toThrow(/tap\/hold layer has macro keys/);
    expect(io.macroBlocks.length).toBe(0);
    new DataView(io.layers[3].buffer).setUint32(5 * 4, 0x01000003, true); // stock do-nothing cell (mode 0) is fine
    await dev.writeMacroPages(plan.pages);
    expect(io.macroBlocks.length).toBe(1);
  });

  it('checkKeyMatrix rejects a protected-cell change without writing anything', async () => {
    const io = new MockWirelessIO();
    new DataView(io.layers[0].buffer).setUint32(4 * 4, 0x16000007, true); // firmware function on key 4
    const dev = new Mk75Wireless(new WirelessLink(io, 0x13, undefined, fast), '3632');
    const m = await dev.readKeyMatrix();
    const before = new Uint8Array(io.layers[0]);
    await expect(dev.checkKeyMatrix(setKeyCode(m, 4, encodeAction({ kind: 'key', usage: 5, mods: 0 })))).rejects.toThrow(/keyboard function/);
    expect(io.layers[0]).toEqual(before);
    await dev.checkKeyMatrix(m); // unchanged matrix passes
  });

  it('Fn layer: reads and writes layer 1 only, keeps firmware functions, round-trips lighting cells', async () => {
    const { io, dev } = make();
    const base = new Uint8Array(io.layers[0]);
    const fn = await dev.readFnLayer();
    expect(getKeyCode(fn, 78)).toBe(0xe9000004); // Fn+F12 = Volume+ in the wired view
    expect(getKeyCode(fn, 88)).toBe(0x00010308); // lighting cell passes through raw
    const lighting = getKeyCode(fn, 88);
    // F12 → Play/Pause, Up → B
    let m = setKeyCode(fn, 78, encodeAction({ kind: 'consumer', usage: 0xcd }));
    m = setKeyCode(m, 88, encodeAction({ kind: 'key', usage: 0x05, mods: 0 }));
    await dev.writeFnLayer(m);
    const v = new DataView(io.layers[1].buffer);
    expect(v.getUint32(78 * 4, true)).toBe(0xcd000002);
    expect(v.getUint32(88 * 4, true)).toBe(0x05000000);
    expect(v.getUint32(8 * 4, true)).toBe(0x16000007); // Fn+Q untouched
    expect(io.layers[0]).toEqual(base);
    // restoring the lighting cell from the saved view writes the raw code back
    await dev.writeFnLayer(setKeyCode(await dev.readFnLayer(), 88, lighting));
    expect(new DataView(io.layers[1].buffer).getUint32(88 * 4, true)).toBe(0x00010308);
    // device functions and the Fn key are refused
    const before = new Uint8Array(io.layers[1]);
    await expect(dev.writeFnLayer(setKeyCode(await dev.readFnLayer(), 8, 0x05000000))).rejects.toThrow(/keyboard function/);
    expect(io.layers[1]).toEqual(before);
  });

  it('stock do-nothing macro cells (mode 0) and repeat counts stay raw', () => {
    expect(wirelessToWired(0x00000003)).toBeNull();
    expect(wirelessToWired(0x01000003)).toBeNull();
    expect(wirelessToWired(0x00020103)).toBeNull(); // count 2
    expect(wiredToWireless(0x00000010)).toBeNull(); // wired mode 0
  });

  it('palette keeps wired offsets and gets the 5A A5 signature', async () => {
    const { io, dev } = make();
    const t = await dev.readRgbTable();
    const pal = parseRgbTable(t);
    expect(pal[0][0]).toEqual([255, 0, 0]);
    pal[0][0] = [1, 2, 3];
    await dev.writeRgbTable(patchRgbTable(t, pal));
    expect([...io.palette.slice(0x15, 0x18)]).toEqual([1, 2, 3]);
    expect([io.palette[0x1fa], io.palette[0x1fb]]).toEqual([0x5a, 0xa5]);
  });

  it('live frames are colour groups within 200 bytes', async () => {
    const { io, dev } = make();
    const rgb = new Uint8Array(378);
    for (const k of MK75_KEYS) rgb.set([k.index * 2, 255 - k.index, (k.index * 7) % 256], 3 * k.index);
    await dev.sendLiveFrame(rgb);
    expect(io.live!.length).toBeLessThanOrEqual(200);
    // every key appears exactly once across the groups
    const seen: number[] = [];
    for (let p = 0; p < io.live!.length; ) {
      const n = io.live![p + 3];
      seen.push(...io.live!.slice(p + 4, p + 4 + n));
      p += 4 + n;
    }
    expect(seen.sort((a, b) => a - b)).toEqual(MK75_KEYS.map((k) => k.index).sort((a, b) => a - b));
  });
});
