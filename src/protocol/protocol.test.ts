import { describe, expect, it } from 'vitest';
import { Mk75, DATA_FRAME_LEN } from './mk75';
import { decodeAction, encodeAction, getKeyCode, setKeyCode, resolveSlot } from './keycodes';
import { buildLedMatrix, CUSTOM_GROUP, CUSTOM_MODE_INDEX, LED_MODES, parseProfile, parseRgbTable, patchProfile, patchRgbTable, PER_MODE_SLOTS } from './lighting';
import { MockMk75 } from './mock';
import type { FeatureTransport } from './transport';

/** Records frames; answers reads with an echo of the op so readBlock succeeds. */
class Recorder implements FeatureTransport {
  name = 'rec';
  frames: { id: number; data: number[] }[] = [];
  private lastCmd = 0;
  featureSize() {
    return undefined;
  }
  async sendFeature(id: number, data: Uint8Array) {
    this.frames.push({ id, data: [...data] });
    if (id === 5) this.lastCmd = data[0];
  }
  async receiveFeature() {
    const r = new Uint8Array(DATA_FRAME_LEN);
    r[0] = this.lastCmd;
    return r;
  }
  async close() {}
}

const fast = { readDelayMs: 0, writeDelayMs: 0 };
const hex = (a: number[], n: number) => a.slice(0, n).map((b) => b.toString(16).padStart(2, '0')).join(' ');

// Expected bytes below were captured by emulating OemDrv.exe's own functions (Unicorn) and
// hooking HidD_SetFeature; they exclude the report-ID byte, which WebHID passes separately.
describe('wire format matches vendor driver', () => {
  it('read profile = report 5 [83 b6 00 00 00 00]', async () => {
    const t = new Recorder();
    await new Mk75(t, fast).readProfile();
    expect(t.frames[0].id).toBe(5);
    expect(hex(t.frames[0].data, 6)).toBe('83 b6 00 00 00 00');
  });
  it('write profile = report 6 [03 b6 00 00 00 00 00 | 254 bytes]', async () => {
    const t = new Recorder();
    const p = new Uint8Array(254).map((_, i) => i);
    await new Mk75(t, fast).writeProfile(p);
    expect(t.frames[0].id).toBe(6);
    expect(t.frames[0].data.length).toBe(1031);
    expect(hex(t.frames[0].data, 10)).toBe('03 b6 00 00 00 00 00 00 01 02');
  });
  it('write key matrix = [04 d4 00 40 00 00 00 | 1024]', async () => {
    const t = new Recorder();
    await new Mk75(t, fast).writeKeyMatrix(new Uint8Array(1024).fill(0xaa));
    expect(hex(t.frames[0].data, 8)).toBe('04 d4 00 40 00 00 00 aa');
    expect(t.frames[0].data.length).toBe(1031);
  });
  it('read key matrix = report 5 [84 d4 ...]', async () => {
    const t = new Recorder();
    await new Mk75(t, fast).readKeyMatrix();
    expect(hex(t.frames[0].data, 6)).toBe('84 d4 00 00 00 00');
  });
  it('rgb table read/write = 88 b8 / 08 b8 00 40', async () => {
    const t = new Recorder();
    const d = new Mk75(t, fast);
    await d.readRgbTable();
    await d.writeRgbTable(new Uint8Array(1024));
    expect(hex(t.frames[0].data, 6)).toBe('88 b8 00 00 00 00');
    expect(t.frames[1].id).toBe(6);
    expect(hex(t.frames[1].data, 7)).toBe('08 b8 00 40 00 00 00');
  });
  it('led matrix = two pages 09 bc / 09 c0 with 00 40', async () => {
    const t = new Recorder();
    const buf = new Uint8Array(0x762);
    buf[0] = 1;
    buf[0x400] = 2;
    await new Mk75(t, fast).writeLedMatrix(buf);
    expect(hex(t.frames[0].data, 8)).toBe('09 bc 00 40 00 00 00 01');
    expect(hex(t.frames[1].data, 8)).toBe('09 c0 00 40 00 00 00 02');
  });
});

describe('key codes', () => {
  it('encodes like the vendor jump tables', () => {
    expect(encodeAction({ kind: 'key', usage: 0x3d, mods: 0x04 })).toBe(0x3d040000); // Alt+F4
    expect(encodeAction({ kind: 'key', usage: 0x4c, mods: 0x05 })).toBe(0x4c050000); // Ctrl+Alt+Del
    expect(encodeAction({ kind: 'consumer', usage: 0xcd })).toBe(0xcd000004);
    expect(encodeAction({ kind: 'consumer', usage: 0x18a })).toBe(0x8a010004);
    expect(encodeAction({ kind: 'consumer', usage: 0x223 })).toBe(0x23020004);
    expect(encodeAction({ kind: 'mouse', button: 0 })).toBe(0xf0000007);
    expect(encodeAction({ kind: 'modifier', usage: 0xe0 })).toBe(0xe0000006);
  });
  it('round-trips', () => {
    for (const code of [0x3d040000, 0xcd000004, 0x8a010004, 0xf3000007, 0xe2000006, 0]) {
      expect(encodeAction(decodeAction(code))).toBe(code >>> 0);
    }
  });
  it('writes through Fn redirect slots', () => {
    const m = new Uint8Array(1024);
    const v = new DataView(m.buffer);
    v.setUint32(3 * 4, 0x00000002, true); // index 3 -> slot 132
    v.setUint32(132 * 4, 0x39000000, true);
    expect(resolveSlot(m, 3)).toBe(132);
    expect(getKeyCode(m, 3)).toBe(0x39000000);
    const m2 = setKeyCode(m, 3, 0x29000000);
    expect(new DataView(m2.buffer).getUint32(132 * 4, true)).toBe(0x29000000);
    expect(new DataView(m2.buffer).getUint32(3 * 4, true)).toBe(0x00000002);
  });
});

describe('lighting', () => {
  it('patches only vendor-touched profile bytes', () => {
    const orig = new Uint8Array(254).fill(0x5a);
    const state = parseProfile(orig);
    state.activeIndex = 1; // Respire, hw 2
    state.perMode[1] = { speed: 3, brightness: 2, colorful: false, colorIndex: 4 };
    const p = patchProfile(orig, state);
    expect(p[5]).toBe(2);
    expect(p[4]).toBe(0);
    expect(p[0x16 + 2]).toBe(4);
    expect(p[0x17 + 2]).toBe(0x32);
    // untouched regions preserved
    expect(p[0]).toBe(0x5a);
    expect(p[0x10]).toBe(0x5a);
    expect(p[0x16 + 2 * PER_MODE_SLOTS]).toBe(0x5a);
    expect(p[200]).toBe(0x5a);
  });
  it('self-define sets custom flag and hw 21', () => {
    const p = patchProfile(new Uint8Array(254), { activeIndex: CUSTOM_MODE_INDEX, perMode: parseProfile(new Uint8Array(254)).perMode });
    expect(p[4]).toBe(1);
    expect(p[5]).toBe(21);
    expect(p[6]).toBe(CUSTOM_GROUP);
    expect(parseProfile(p).activeIndex).toBe(CUSTOM_MODE_INDEX);
  });
  it('rgb table stride 0x15 starting at mode+1', () => {
    const t = new Uint8Array(1024);
    const pal = parseRgbTable(t);
    pal[0][0] = [1, 2, 3];
    pal[2][6] = [7, 8, 9];
    const out = patchRgbTable(t, pal);
    expect([...out.slice(0x15, 0x18)]).toEqual([1, 2, 3]);
    expect([...out.slice(0x15 * 3 + 18, 0x15 * 3 + 21)]).toEqual([7, 8, 9]);
  });
  it('led matrix uses R/G/B planes of 126', () => {
    const b = buildLedMatrix(new Map([[12, [10, 20, 30]]]));
    expect(b[12]).toBe(10);
    expect(b[126 + 12]).toBe(20);
    expect(b[252 + 12]).toBe(30);
  });
  it('mode table matches KB.ini', () => {
    expect(LED_MODES.map((m) => m.hw)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 21, 0]);
    expect(LED_MODES.filter((m) => m.hidden).map((m) => m.name)).toEqual(['Rainbow wheel', 'Shadow disappear', 'Retinue scanning', 'Rotating storm']);
  });
});

describe('end to end against simulator', () => {
  it('read-modify-write profile and matrix', async () => {
    const mock = new MockMk75();
    const d = new Mk75(mock, fast);
    const prof = await d.readProfile();
    const st = parseProfile(prof);
    expect(st.activeIndex).toBe(0);
    st.activeIndex = 2;
    await d.writeProfile(patchProfile(prof, st));
    expect(mock.profile[5]).toBe(3);
    const m = await d.readKeyMatrix();
    expect(decodeAction(getKeyCode(m, 3))).toEqual({ kind: 'key', usage: 0x39, mods: 0 }); // CapsLock via redirect
    await d.writeKeyMatrix(setKeyCode(m, 3, encodeAction({ kind: 'modifier', usage: 0xe0 })));
    expect(new DataView(mock.matrix.buffer).getUint32(132 * 4, true)).toBe(0xe0000006);
  });
});
