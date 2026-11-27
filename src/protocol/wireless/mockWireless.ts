/** In-memory MK75 behind a 2.4 GHz receiver, speaking the 20-byte packet protocol. */
import { MK75_KEYS } from '../../device/mk75Layout';
import { CUSTOM_GROUP } from '../lighting';
import { vkToHid } from '../mock';
import type { ReportIO } from './link';
import { buildPacket, chunk, checksum, parsePacket, WCmd } from './packet';

const REPLY_ID = 0x13;
const FN_KEY = MK75_KEYS.find((k) => k.vk === 0xfa)!.index;
/** Palette bytes 483..511 from a cable read of a real MK75 (issue #29): model id copy, 00 00 10, zeros, 5A A5 00 10 00 00. */
export const PALETTE_TAIL = Uint8Array.from([3, 0, 0, 0, 0, 0xc6, 0, 0, 0x10, ...new Array(14).fill(0), 0x5a, 0xa5, 0, 0x10, 0, 0]);

export class MockWirelessIO implements ReportIO {
  readonly name = 'Simulated MK75 (2.4 GHz)';
  led = new Uint8Array(128);
  layers = [0, 1, 2, 3].map(() => new Uint8Array(512));
  palette = new Uint8Array(0x200);
  colors = new Uint8Array(0x17a);
  macroBlocks: Uint8Array[] = [];
  live: Uint8Array | null = null;
  liveFrames = 0;
  badChecksums = 0;
  online = true;
  /** LED-profile reads still to answer like a sleeping keyboard: zeros, only 5A A5 kept. */
  asleepReads = 0;
  /** Lose a read-reply packet on its way to the host, like Bluetooth does (issue #32). `round` counts requests per cmd from 1. */
  dropReply?: (cmd: number, round: number, index: number) => boolean;
  private readRounds = new Map<number, number>();
  private subs = new Set<(id: number, body: Uint8Array) => void>();
  private incoming = new Map<number, Uint8Array[]>();

  constructor() {
    this.led[0x0a] = 1; // Fixed on
    this.led[0x0b] = CUSTOM_GROUP;
    this.led[0x03] = 2; // debounce (factory value, issue #4)
    this.led[0x18] = 4; // sleep 120 s
    this.led[0x12] = 3; // side lights steady (real MK75, side-light probe)
    this.led[0x38] = this.led[0x39] = 0xff;
    for (let i = 0; i < 19; i++) {
      this.led[0x3a + 2 * i] = 4;
      this.led[0x3b + 2 * i] = 2 << 4;
    }
    this.led[0x7e] = 0x5a;
    this.led[0x7f] = 0xa5;
    const v = new DataView(this.layers[0].buffer);
    for (const k of MK75_KEYS) {
      const hid = vkToHid(k.vk);
      if (hid !== undefined) v.setUint32(k.index * 4, (hid << 24) >>> 0, true);
    }
    // Part of the factory Fn layer (cell format from hw-re-docs): F12 Volume+, Q/W/E Android/Windows/macOS,
    // B battery display, Up brightness+, the Fn key itself.
    const fn = new DataView(this.layers[1].buffer);
    const FN_CELLS: [number, number][] = [[78, 0xe9000002], [8, 0x16000007], [14, 0x0e000007], [20, 0x0f000007], [34, 0x11000007], [88, 0x00010308], [FN_KEY, 0x0000000d]];
    for (const [i, c] of FN_CELLS) fn.setUint32(i * 4, c, true);
    for (const l of this.layers) new DataView(l.buffer).setUint32(508, 0xa55a0000, true);
    const pal = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0], [0, 255, 255], [255, 0, 255], [255, 255, 255]];
    for (let hw = 1; hw <= 19; hw++) pal.forEach((c, k) => this.palette.set(c, 0x15 * hw + 3 * k));
    this.palette.set(PALETTE_TAIL, 483);
  }

  private emit(body: Uint8Array) {
    setTimeout(() => this.subs.forEach((f) => f(REPLY_ID, body)), 1);
  }

  private reply(cmd: number, data: Uint8Array) {
    const round = (this.readRounds.get(cmd) ?? 0) + 1;
    this.readRounds.set(cmd, round);
    for (const p of chunk(REPLY_ID, cmd, 0, data)) if (!this.dropReply?.(cmd, round, p[2])) this.emit(p);
  }

  async send(reportId: number, body: Uint8Array) {
    if (checksum(reportId, body) !== body[18]) {
      this.badChecksums++;
      return;
    }
    const p = parsePacket(body);
    const sources: Record<number, () => Uint8Array> = {
      [WCmd.GetLed]: () => {
        if (this.asleepReads <= 0) return this.led;
        this.asleepReads--;
        const z = new Uint8Array(128);
        z[0x7e] = 0x5a;
        z[0x7f] = 0xa5;
        return z;
      },
      // Real receivers return short reads: matrix 504 of 512, palette 490 of 512 (hw-re-docs, Wireless → Reading).
      [WCmd.GetMatrix]: () => (this.layers[p.sub] ?? new Uint8Array(512)).subarray(0, 504),
      [WCmd.GetPalette]: () => this.palette.subarray(0, 490),
      [WCmd.GetColors]: () => this.colors,
      [WCmd.Online]: () => Uint8Array.of(this.online ? 1 : 0, 0),
      [WCmd.GetOnBoard]: () => Uint8Array.of(80, 0x01), // 80 %, on battery
    };
    if (sources[p.cmd]) return this.reply(p.cmd, sources[p.cmd]());

    const parts = this.incoming.get(p.cmd) ?? [];
    parts[p.index] = p.data;
    this.incoming.set(p.cmd, parts);
    if (!(p.cmd & 0x80)) this.emit(buildPacket(REPLY_ID, p.cmd, p.total, p.index, 0, new Uint8Array(0))); // per-packet ack
    if (p.index + 1 < p.total) return;
    const all = new Uint8Array(parts.reduce((n, d) => n + (d?.length ?? 0), 0));
    let o = 0;
    for (const d of parts) {
      all.set(d, o);
      o += d.length;
    }
    this.incoming.delete(p.cmd);
    if (p.cmd === WCmd.SetLed) this.led = all.slice(0, 128);
    else if (p.cmd === WCmd.SetMatrix) this.layers[p.sub] = all.slice(0, 512);
    else if (p.cmd === WCmd.SetPalette) this.palette = all.slice(0, 0x200);
    else if (p.cmd === WCmd.SetColors) this.colors = all.slice(0, 0x17a);
    else if (p.cmd === WCmd.SetMacro) this.macroBlocks[p.sub] = all.slice(0, 512);
    else if (p.cmd === WCmd.Live) {
      this.live = all;
      this.liveFrames++;
    }
  }

  onInput(cb: (id: number, body: Uint8Array) => void) {
    this.subs.add(cb);
    return () => this.subs.delete(cb);
  }

  async close() {}
}
