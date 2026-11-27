/**
 * Replays the device data from issue #35: a real MK75 over Bluetooth (3554:FA07, report ID 0x13, CDev3632), Chrome on
 * Windows. Bluetooth delivers only about half of each reply, a different half on every request, so every read below
 * needs several requests and none would pass on its own (issue #32).
 */
import { describe, expect, it } from 'vitest';
import fixture from './fixtures/issue35-bluetooth.json?raw';
import { WirelessLink, type ReportIO } from './wireless/link';
import { Mk75Wireless } from './wireless/mk75Wireless';
import { parsePacket } from './wireless/packet';

interface DeviceData {
  hid: { vendorId: number; productId: number }[];
  snapshot: { profile: string; keyMatrix: string; rgbTable: string };
  log: { dir: string; hex: string }[];
}
const data = JSON.parse(fixture) as DeviceData;

const unhex = (h: string) => Uint8Array.from(h.match(/../g)!.map((x) => parseInt(x, 16)));
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
const key = (cmd: number, sub: number) => `${cmd}/${sub}`;
const REPORT_ID = 0x13;

/**
 * Reply packets (19 bytes, no report ID) as they reached the browser, one list per request, by cmd/sub. The log starts
 * in the middle of a palette read, so the packets before the first request are that request's (partial) reply.
 */
const rounds = new Map<string, Uint8Array[][]>();
let current: Uint8Array[] | null = null;
for (const l of data.log) {
  const b = unhex(l.hex);
  const p = parsePacket(b);
  if (l.dir === 'out' || !current) {
    const k = key(p.cmd, p.sub);
    rounds.set(k, [...(rounds.get(k) ?? []), (current = [])]);
  }
  if (l.dir === 'in') current.push(b);
}

/** Answers each read with the next captured reply for it, losing what Bluetooth lost; silence once they run out. */
class Replay implements ReportIO {
  readonly name = 'Replay of issue #35';
  private subs = new Set<(id: number, body: Uint8Array) => void>();
  private used = new Map<string, number>();

  async send(reportId: number, body: Uint8Array) {
    expect(reportId).toBe(REPORT_ID);
    const p = parsePacket(body);
    expect(p.cmd & 0x40, `write 0x${p.cmd.toString(16)} in a read-only replay`).toBeTruthy();
    const k = key(p.cmd, p.sub);
    const n = this.used.get(k) ?? 0;
    this.used.set(k, n + 1);
    for (const pkt of rounds.get(k)?.[n] ?? []) setTimeout(() => this.subs.forEach((f) => f(REPORT_ID, pkt)), 0);
  }
  onInput(cb: (id: number, body: Uint8Array) => void) {
    this.subs.add(cb);
    return () => this.subs.delete(cb);
  }
  async close() {}
}

const fast = { pace: 0, livePace: 0, ackMs: 300, readMs: 300, gapMs: 50 };
const make = () => new Mk75Wireless(new WirelessLink(new Replay(), REPORT_ID, undefined, fast), '3632');

describe('issue #35: Bluetooth replay', () => {
  it('is the Bluetooth enumeration of the keyboard: 3554:FA07', () => {
    expect([data.hid[0].vendorId, data.hid[0].productId]).toEqual([0x3554, 0xfa07]);
  });

  it('no captured request delivered a whole block', () => {
    for (const cmd of [0x41, 0x44, 0x49]) {
      const rs = rounds.get(key(cmd, 0))!;
      expect(rs.length).toBeGreaterThanOrEqual(4);
      for (const r of rs) {
        const total = parsePacket(r[0]).total;
        expect(new Set(r.map((b) => parsePacket(b).index)).size).toBeLessThan(total);
      }
    }
  });

  it('LED profile, key map and palette read whole and match what the app showed', async () => {
    const dev = make();
    expect(hex(await dev.readProfile())).toBe(data.snapshot.profile);
    expect(hex(await dev.readKeyMatrix())).toBe(data.snapshot.keyMatrix);
    expect(hex(await dev.readRgbTable())).toBe(data.snapshot.rgbTable);
  });
});
