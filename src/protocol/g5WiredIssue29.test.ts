/**
 * Replays the device data from issue #29: a real IC2481 MK75 (258A:010C) on the USB cable, Chrome on Windows.
 * The captured replies go through Mk75G5Wired unchanged, so this pins the decoding of real firmware data and
 * proves that writing the blocks back unchanged sends exactly what the keyboard holds.
 */
import { describe, expect, it } from 'vitest';
import { MK75_KEYS, MK75_KNOB } from '../device/mk75Layout';
import fixture from './fixtures/issue29-g5wired.json?raw';
import { Mk75G5Wired } from './g5Wired';
import { decodeAction, getKeyCode } from './keycodes';
import { modeByHw } from './lighting';
import type { FeatureTransport } from './transport';

interface LogLine {
  dir: string;
  hex?: string;
}
const data = JSON.parse(fixture) as {
  modelId: string;
  snapshot: { profile: string; keyMatrix: string; rgbTable: string };
  log: LogLine[];
};

const unhex = (h: string) => Uint8Array.from(h.match(/../g)!.map((x) => parseInt(x, 16)));
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
const key = (cmd: number, sub: number) => `${cmd}/${sub}`;

/** Reply bytes as the transport returned them (the log keeps the report ID in front), by request cmd/sub. */
const replies = new Map<string, Uint8Array>();
const frames = data.log.filter((l) => l.hex);
for (let i = 0; i + 1 < frames.length; i++) {
  if (frames[i].dir !== 'out' || frames[i + 1].dir !== 'in') continue;
  const req = unhex(frames[i].hex!).subarray(1);
  replies.set(key(req[0], req[1]), unhex(frames[i + 1].hex!).subarray(1));
}

/** Payload of a captured read reply, without the extra report ID that short replies carry. */
function payload(cmd: number, sub: number, len: number): Uint8Array {
  let r = replies.get(key(cmd, sub))!;
  if (r[0] === 0x06 && r[1] === cmd) r = r.subarray(1);
  return r.subarray(7, 7 + len);
}

class Replay implements FeatureTransport {
  readonly name = 'Replay of issue #29';
  /** Written payloads by cmd/sub; a block written twice, or more than one chunk, fails the test. */
  writes = new Map<string, Uint8Array>();
  private next: Uint8Array = new Uint8Array(0);

  featureSize(id: number) {
    return id === 0x06 ? 0x207 : undefined;
  }
  async sendFeature(id: number, f: Uint8Array) {
    expect(id).toBe(0x06);
    if (f[0] & 0x80) {
      const r = replies.get(key(f[0], f[1]));
      if (!r) throw new Error(`No captured reply for 0x${f[0].toString(16)} sub ${f[1]}`);
      this.next = r;
    } else {
      const k = key(f[0], f[1]);
      expect(this.writes.has(k), `second write to ${k}`).toBe(false);
      expect([f[3], f[4]], `chunk header of ${k}`).toEqual([1, 0]);
      this.writes.set(k, f.slice(7, 7 + (f[5] | (f[6] << 8))));
    }
  }
  async receiveFeature() {
    return new Uint8Array(this.next);
  }
  async close() {}
}

describe('IC2481 USB capture from issue #29', () => {
  it('short replies carry an extra report ID on Windows; full-size ones do not', () => {
    for (const [cmd, sub] of [[0x82, 1], [0x84, 0], [0x87, 2]]) {
      const r = replies.get(key(cmd, sub))!;
      expect([r[0], r[1]]).toEqual([0x06, cmd]);
    }
    for (const [cmd, sub] of [[0x83, 0], [0x8a, 0]]) expect(replies.get(key(cmd, sub))!.length).toBe(0x207);
  });

  it('decodes every block exactly like the snapshot the app saved', async () => {
    const dev = new Mk75G5Wired(new Replay());
    expect(hex((await dev.checkModel())!)).toBe(data.modelId);
    expect(hex(await dev.readProfile())).toBe(data.snapshot.profile);
    expect(hex(await dev.readKeyMatrix())).toBe(data.snapshot.keyMatrix);
    expect(hex(await dev.readRgbTable())).toBe(data.snapshot.rgbTable);
  });

  it('reads the settings, battery and lighting this board reported', async () => {
    const dev = new Mk75G5Wired(new Replay());
    expect(await dev.readSettings()).toEqual({ debounce: 2, knob: 0 });
    expect(await dev.readSideLights()).toEqual({ mode: 1, colour: 0, brightness: 4, speed: 4 }); // flow, red, top levels
    expect(await dev.readBattery()).toEqual({ level: 100, charging: true });
    const p = await dev.readProfile();
    expect(modeByHw(p[0x05], p[0x04] === 1)?.name).toBe('Neon stream');
    expect(p[0x11]).toBe(0x02); // sleep code; its layout-B unit is still unconfirmed
    for (let i = 0; i < 19; i++) expect([p[0x16 + 2 * i], p[0x17 + 2 * i]]).toEqual([0x07, 0x44]);
  });

  it('maps every key of the factory key map, keeping Fn and the knob as firmware codes', async () => {
    const m = await new Mk75G5Wired(new Replay()).readKeyMatrix();
    for (const k of MK75_KEYS) {
      const code = getKeyCode(m, k.index);
      if (k.label === 'FN') expect(code).toBe(0x0000000d);
      else expect(decodeAction(code).kind, `${k.label} (${code.toString(16)})`).not.toBe('raw');
    }
    expect(getKeyCode(m, MK75_KNOB.index)).toBe(0x14000007);
  });

  it('writing the blocks back unchanged sends exactly the bytes the keyboard holds', async () => {
    const t = new Replay();
    const dev = new Mk75G5Wired(t);
    await dev.writeProfile(await dev.readProfile());
    await dev.writeKeyMatrix(await dev.readKeyMatrix());
    await dev.writeRgbTable(await dev.readRgbTable());
    expect([...t.writes.keys()].sort()).toEqual([key(0x03, 0), key(0x04, 0), key(0x0a, 0)].sort());
    expect(hex(t.writes.get(key(0x04, 0))!)).toBe(hex(payload(0x84, 0, 0x80)));
    expect(hex(t.writes.get(key(0x03, 0))!)).toBe(hex(payload(0x83, 0, 0x200)));
    expect(hex(t.writes.get(key(0x0a, 0))!)).toBe(hex(payload(0x8a, 0, 0x200)));
  });
});
