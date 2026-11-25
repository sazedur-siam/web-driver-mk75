import { describe, expect, it } from 'vitest';
import { MK75_KEYS } from '../device/mk75Layout';
import { keyIndexByName, parseColumns, parseUnits, UNIT_FILES } from '../device/mk75Units';
import { decodeAction, getKeyCode } from './keycodes';
import { compose, MusicVisualizer, RtEffect } from './live';
import { encodeMacroSlot, macroRefCode, planMacros, type Macro } from './macro';
import { MockMk75 } from './mock';
import { Mk75 } from './mk75';

const hex = (b: Uint8Array, n: number) => [...b.slice(0, n)].map((x) => x.toString(16).padStart(2, '0')).join(' ');
const A = 0x04;

// Expected bytes = StMacro_To_HdMacro output captured by emulating the vendor MK75 driver.
describe('macro encoding matches vendor', () => {
  it('A down 50ms, A up 50ms', () => {
    expect(hex(encodeMacroSlot([{ usage: A, down: true, delay: 50 }, { usage: A, down: false, delay: 50 }]).slot, 6)).toBe('00 01 b2 04 32 04');
  });
  it('minimum delay is 3 ms', () => {
    expect(hex(encodeMacroSlot([{ usage: A, down: true, delay: 0 }, { usage: A, down: false, delay: 3 }]).slot, 6)).toBe('00 01 83 04 03 04');
  });
  it('long delays use the 100 ms extension', () => {
    expect(hex(encodeMacroSlot([{ usage: A, down: true, delay: 127 }, { usage: A, down: false, delay: 128 }]).slot, 10)).toBe(
      '00 01 ff 04 1c 04 00 03 00 01',
    );
    expect(hex(encodeMacroSlot([{ usage: A, down: true, delay: 1234 }, { usage: A, down: false, delay: 6553500 }]).slot, 14)).toBe(
      '00 01 a2 04 00 03 00 0c 03 04 00 03 ff ff',
    );
  });
  it('modifiers and mouse buttons', () => {
    const ev = [0xe0, 0xe1, 0xe5, 0xe3].map((u) => ({ usage: u, down: true, delay: 10 }));
    expect(hex(encodeMacroSlot(ev).slot, 10)).toBe('00 01 8a e0 8a e1 8a e5 8a e3');
    const m = encodeMacroSlot([
      { usage: 0xf0, down: true, delay: 10 },
      { usage: 0xf1, down: false, delay: 10 },
      { usage: 0xf2, down: true, delay: 10 },
    ]);
    expect(hex(m.slot, 8)).toBe('00 01 8a f0 0a f1 8a f2');
  });
  it('caps at 62 short events', () => {
    const ev = Array.from({ length: 70 }, () => ({ usage: A, down: true, delay: 5 }));
    expect(encodeMacroSlot(ev).encoded).toBe(62);
  });
  it('ref code = [10 00 mode id-1]', () => {
    expect(macroRefCode(1, 1)).toBe(0x00010010);
    expect(macroRefCode(3, 4)).toBe(0x02040010);
  });
  it('plans ids in key order and pages DC/E0', () => {
    const lib: Macro[] = Array.from({ length: 9 }, (_, i) => ({ id: `m${i}`, name: `M${i}`, events: [{ usage: A + i, down: true, delay: 10 }] }));
    const asg = new Map(lib.map((m, i) => [50 - i, { macroId: m.id, mode: 1 as const }]));
    const plan = planMacros(asg, lib);
    expect(plan.pages.map((p) => p.sub)).toEqual([0xdc, 0xe0]);
    // lowest key index (42) holds m8 → id 1
    expect(plan.codes.get(42)).toBe(macroRefCode(1, 1));
    expect(plan.pages[0].data[3]).toBe(A + 8);
    expect(plan.pages[1].data[3]).toBe(A + 0); // 9th macro (key 50, m0) in page E0 slot 0
  });
});

describe('unit files', () => {
  it('resolves vendor key names', () => {
    expect(keyIndexByName('esc')).toBe(0);
    expect(keyIndexByName('~')).toBe(1);
    expect(keyIndexByName('|')).toBe(MK75_KEYS.find((k) => k.label === '\\')!.index);
    expect(keyIndexByName('k45')).toBeUndefined();
  });
  it('every MK75 key is covered by the stream and wheel groups', () => {
    for (const f of [UNIT_FILES.stream, UNIT_FILES.wheel]) {
      const covered = new Set(parseUnits(f).flatMap((u) => u.keys));
      const missing = MK75_KEYS.filter((k) => !covered.has(k.index)).map((k) => k.label);
      expect(missing).toEqual([]);
    }
    expect(parseColumns(UNIT_FILES.audiobar)).toHaveLength(10);
  });
});

describe('live frames', () => {
  it('RGB triplets at 3*ledIndex', () => {
    const f = compose(new Map([[12, 1]]), { kind: 'solid', color: [10, 20, 30] }, 0);
    expect(f.length).toBe(378);
    expect([...f.slice(36, 39)]).toEqual([10, 20, 30]);
    expect(f[0]).toBe(0);
  });
  it('effects produce bounded intensities', () => {
    for (const mode of ['Breathing', 'Stars', 'Snow', 'Rotating', 'Shrink', 'Aspect', 'Follow', 'Static'] as const) {
      const e = new RtEffect(mode);
      e.press(0);
      for (let t = 0; t < 2; t += 0.05) for (const v of e.intensities(t).values()) expect(v).toBeGreaterThanOrEqual(0);
    }
    const mv = new MusicVisualizer('Spectrum bars');
    const m = mv.intensities(new Uint8Array(128).fill(200), 0);
    expect(m.size).toBeGreaterThan(30);
  });
  it('sends report 08 with 0A 7A 01 header; model check', async () => {
    const mock = new MockMk75();
    const d = new Mk75(mock, { readDelayMs: 0, writeDelayMs: 0 });
    expect(d.canStream).toBe(true);
    const f = new Uint8Array(378);
    f[3] = 99;
    await d.sendLiveFrame(f);
    expect(mock.liveFrame?.[3]).toBe(99);
    expect([...(await d.checkModel())!]).toEqual([0x03, 0, 0, 0, 0, 0xc6]);
  });
  it('macro pages + matrix refs round-trip through the simulator', async () => {
    const mock = new MockMk75();
    const d = new Mk75(mock, { readDelayMs: 0, writeDelayMs: 0 });
    const plan = planMacros(new Map([[46, { macroId: 'x', mode: 2 as const }]]), [{ id: 'x', name: 'x', events: [{ usage: A, down: true, delay: 9 }] }]);
    await d.writeMacroPages(plan.pages);
    expect(mock.macroPages.get(0xdc)?.slice(0, 4)).toEqual(Uint8Array.of(0, 1, 0x89, A));
    expect(decodeAction(plan.codes.get(46)!)).toEqual({ kind: 'macro', slot: 0, mode: 2 });
    expect(getKeyCode(mock.matrix, 46)).not.toBe(plan.codes.get(46)); // matrix untouched until written
  });
});
