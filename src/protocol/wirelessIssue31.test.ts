/**
 * Replays the device data from issue #31: a real MK75 on its 2.4 GHz receiver (3554:FA09, report ID 0x13,
 * CDev3632), Chrome on Windows. It is the same keyboard as issue #29 (cable), captured 40 minutes later, so the
 * wireless decoding can be checked against the cable read of the same flash.
 */
import { describe, expect, it } from 'vitest';
import fixture29 from './fixtures/issue29-g5wired.json?raw';
import fixture from './fixtures/issue31-wireless.json?raw';
import { modeByHw } from './lighting';
import { WirelessLink, type ReportIO } from './wireless/link';
import { Mk75Wireless } from './wireless/mk75Wireless';
import { buildPacket, parsePacket } from './wireless/packet';

interface LogLine {
  dir: string;
  hex?: string;
}
interface DeviceData {
  modelId: string | null;
  snapshot: { profile: string; keyMatrix: string; rgbTable: string };
  log: LogLine[];
}
const data = JSON.parse(fixture) as DeviceData;
const cable = JSON.parse(fixture29) as DeviceData;

const unhex = (h: string) => Uint8Array.from(h.match(/../g)!.map((x) => parseInt(x, 16)));
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
const key = (cmd: number, sub: number) => `${cmd}/${sub}`;
const REPORT_ID = 0x13;

/** Captured reply packets (19 bytes, no report ID) for each request, by cmd/sub. */
const replies = new Map<string, Uint8Array[]>();
let current: Uint8Array[] | null = null;
for (const l of data.log) {
  if (!l.hex) continue;
  const b = unhex(l.hex);
  if (l.dir === 'out') {
    const p = parsePacket(b);
    replies.set(key(p.cmd, p.sub), (current = []));
  } else if (l.dir === 'in' && current) current.push(b);
}

/** The bytes a captured read returned, packet data joined in order. */
function block(cmd: number, sub = 0): Uint8Array {
  const parts = replies.get(key(cmd, sub))!.map(parsePacket);
  const out = new Uint8Array(parts.reduce((n, p) => n + p.len, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p.data, o);
    o += p.len;
  }
  return out;
}

/** Answers reads with the captured packets and acks writes like the receiver, collecting what was written. */
class Replay implements ReportIO {
  readonly name = 'Replay of issue #31';
  writes = new Map<string, Uint8Array>();
  private subs = new Set<(id: number, body: Uint8Array) => void>();
  private parts = new Map<string, Uint8Array[]>();

  async send(reportId: number, body: Uint8Array) {
    expect(reportId).toBe(REPORT_ID);
    const p = parsePacket(body);
    if (p.cmd & 0x40) {
      const r = replies.get(key(p.cmd, p.sub));
      if (!r) throw new Error(`No captured reply for 0x${p.cmd.toString(16)} sub ${p.sub}`);
      for (const pkt of r) this.emit(pkt);
      return;
    }
    const k = key(p.cmd, p.sub);
    expect(this.writes.has(k), `second write to ${k}`).toBe(false);
    const parts = this.parts.get(k) ?? [];
    parts[p.index] = p.data;
    this.parts.set(k, parts);
    this.emit(buildPacket(REPORT_ID, p.cmd, p.total, p.index, 0, new Uint8Array(0)));
    if (p.index + 1 < p.total) return;
    const all = new Uint8Array(parts.reduce((n, d) => n + d.length, 0));
    parts.reduce((o, d) => (all.set(d, o), o + d.length), 0);
    this.writes.set(k, all);
  }

  private emit(body: Uint8Array) {
    setTimeout(() => this.subs.forEach((f) => f(REPORT_ID, body)), 0);
  }
  onInput(cb: (id: number, body: Uint8Array) => void) {
    this.subs.add(cb);
    return () => this.subs.delete(cb);
  }
  async close() {}
}

function open(io = new Replay()) {
  return { io, dev: new Mk75Wireless(new WirelessLink(io, REPORT_ID, undefined, { pace: 0, livePace: 0, ackMs: 300, readMs: 300 }), '3632') };
}

/** A full 512-byte block as the cable read of issue #29 returned it (0x83 keymap layer 0, 0x8A palette). */
function cableBlock(cmd: number): Uint8Array {
  const frames = cable.log.filter((l) => l.hex);
  const i = frames.findIndex((l) => l.dir === 'out' && unhex(l.hex!)[1] === cmd);
  return unhex(frames[i + 1].hex!).subarray(8, 8 + 0x200);
}

describe('2.4 GHz capture from issue #31', () => {
  it('receiver replies are the known short reads: LED 128, keymap 504, palette 490 bytes', () => {
    expect(block(0x44).length).toBe(128);
    expect(block(0x41).length).toBe(504);
    expect(block(0x49).length).toBe(490);
  });

  it('decodes every block exactly like the snapshot the app saved', async () => {
    const { dev } = open();
    expect(hex(await dev.readProfile())).toBe(data.snapshot.profile);
    expect(hex(await dev.readKeyMatrix())).toBe(data.snapshot.keyMatrix);
    expect(hex(await dev.readRgbTable())).toBe(data.snapshot.rgbTable);
  });

  it('decodes to the same key map and palette as the cable read of the same keyboard (issue #29)', async () => {
    const { dev } = open();
    expect(hex(await dev.readKeyMatrix())).toBe(cable.snapshot.keyMatrix);
    expect(hex(await dev.readRgbTable())).toBe(cable.snapshot.rgbTable);
    // Lighting: only the effect and one brightness changed between the two captures.
    const p = await dev.readProfile();
    const c = unhex(cable.snapshot.profile);
    const diff = [...p.keys()].filter((i) => p[i] !== c[i]);
    expect(diff).toEqual([0x05, 0x35]);
  });

  it('reads the model id copy, settings, battery and lighting this keyboard reported', async () => {
    const { dev } = open();
    expect(hex((await dev.checkModel())!)).toBe(cable.modelId);
    expect(await dev.readSettings()).toEqual({ debounce: 2, knob: 0 });
    expect(await dev.readBattery()).toEqual({ level: 100, charging: false }); // 64 01: on battery
    const p = await dev.readProfile();
    expect(p[0x04]).toBe(0);
    expect(modeByHw(p[0x05], false)?.name).toBe('Colorful waterfall'); // was Neon stream on the cable
    expect(p[0x11]).toBe(0x02);
  });

  it('writing the blocks back unchanged sends exactly the bytes the keyboard holds', async () => {
    const { io, dev } = open();
    await dev.writeProfile(await dev.readProfile());
    await dev.writeKeyMatrix(await dev.readKeyMatrix());
    await dev.writeRgbTable(await dev.readRgbTable());
    expect([...io.writes.keys()].sort()).toEqual([key(0x01, 0), key(0x04, 0), key(0x09, 0)].sort());
    expect(hex(io.writes.get(key(0x04, 0))!)).toBe(hex(block(0x44)));
    // keymap: the 504 bytes read, slot 126 zero and trailer A55A0000, which is the whole layer the cable read shows
    expect(hex(io.writes.get(key(0x01, 0))!)).toBe(hex(block(0x41)) + '00000000' + '00005aa5');
    expect(hex(io.writes.get(key(0x01, 0))!)).toBe(hex(cableBlock(0x83)));
    // palette: the 22 bytes the receiver never sends are restored to what the cable read shows
    expect(hex(io.writes.get(key(0x09, 0))!)).toBe(hex(cableBlock(0x8a)));
  });
});
