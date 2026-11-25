/**
 * MK75 over the 2.4 GHz receiver or Bluetooth (vendor CDevComboFilm / CDev3632 + CDevG5KB logic).
 * Presents the wired data formats to the UI and converts to the wireless layouts:
 *
 *  LED profile (cmd 0x44 / 0x04), 128 B, "layout B", signature 5A A5 at 0x7E:
 *    0x09 custom flag · 0x0A hw effect · 0x0B colour group · 0x16 sleep on/off · 0x18 sleep code
 *    0x38/0x39 = FF · 0x3A+2i brightness · 0x3B+2i speed<<4 | (colourful ? 7 : 0)   (i < 19)
 *  Key matrix (cmd 0x41 / 0x01, sub = layer 0..3), 512 B = 128 u32, last u32 = 0xA55A0000.
 *  Palette (cmd 0x49 / 0x09), 0x200 B: same offsets as wired (0x15*hw), 5A A5 at 0x1FA.
 *  Per-key colours (cmd 0x02, sub = group), 0x17A B: R/G/B planes of 126.
 *  Live stream (cmd 0x88, no ack): groups [R,G,B,count,led...], <= 200 bytes.
 */
import type { DeviceCaps, Mk75Device } from '../device';
import { PROFILE_LEN } from '../mk75';
import { LED_GROUP_LEN } from '../lighting';
import { wiredToWireless, wirelessToWired } from './codes';
import type { WirelessLink } from './link';
import { WCmd } from './packet';

const LED_LEN = 128;
const LAYER_LEN = 512;
const LAYER_SLOTS = LAYER_LEN / 4;
const LAYER_TRAILER = 0xa55a0000;
const PALETTE_LEN = 0x200;
const PALETTE_DATA = 0x1a4;
const WL_MODES = 19;
const LIVE_MAX = 200;

const u32 = (b: Uint8Array, i: number) => new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(i * 4, true);
const setU32 = (b: Uint8Array, i: number, v: number) => new DataView(b.buffer, b.byteOffset, b.byteLength).setUint32(i * 4, v >>> 0, true);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class UnsupportedOverWireless extends Error {}

export class Mk75Wireless implements Mk75Device {
  readonly kind = 'wireless' as const;
  readonly caps: DeviceCaps;
  readonly canStream = true;
  readonly transport: { name: string; close(): Promise<void> };
  readonly simulated: boolean;

  private ledView: Uint8Array | null = null;
  private layerRaw: Uint8Array | null = null;
  private matrixView: Uint8Array | null = null;
  private paletteRaw: Uint8Array | null = null;

  constructor(
    private link: WirelessLink,
    /** 'combo' = report ID 0x15 receiver; '3632' = report ID 0x13 (has battery + reset). */
    readonly flavour: 'combo' | '3632',
  ) {
    this.caps = { macros: false, paletteIndex: false, battery: flavour === '3632' };
    this.simulated = link.io.name.startsWith('Simulated');
    this.transport = { name: `${link.io.name}`, close: () => link.close() };
  }

  /** Online query (cmd 0x07). Combo: byte0 = keyboard connected to the receiver. */
  async online(): Promise<boolean> {
    const r = await this.link.read(WCmd.Online, 0, this.flavour === 'combo' ? 2 : 1);
    return r[0] !== 0;
  }

  // ---------------------------------------------------------------- LED profile
  private async readLedRaw(): Promise<Uint8Array> {
    for (let i = 0; i < 5; i++) {
      const r = await this.link.read(WCmd.GetLed, 0, LED_LEN);
      if (r[0x7e] === 0x5a && r[0x7f] === 0xa5) return r;
      await sleep(100);
    }
    throw new Error('Keyboard returned an invalid lighting block (no 5A A5 signature)');
  }

  async readProfile(): Promise<Uint8Array> {
    const raw = await this.readLedRaw();
    const p = new Uint8Array(PROFILE_LEN);
    p[0x04] = raw[0x09];
    p[0x05] = raw[0x0a];
    p[0x06] = raw[0x0b];
    p[0x11] = raw[0x16] === 0 ? 0xff : raw[0x18];
    p[0x14] = p[0x15] = 0xff;
    for (let i = 0; i < WL_MODES; i++) {
      const bright = raw[0x3a + 2 * i] & 0x0f;
      const b = raw[0x3b + 2 * i];
      p[0x16 + 2 * i] = (b & 0x0f) === 7 ? 7 : 0;
      p[0x17 + 2 * i] = (b & 0xf0) | bright;
    }
    this.ledView = p;
    return new Uint8Array(p);
  }

  async writeProfile(p: Uint8Array): Promise<void> {
    // Vendor: read the live block first, patch, write back.
    const raw = await this.readLedRaw();
    const prev = this.ledView ?? (await this.readProfile());
    const changed = (o: number) => p[o] !== prev[o];
    raw[0x09] = p[0x04];
    raw[0x0a] = p[0x05];
    raw[0x0b] = p[0x06];
    if (changed(0x11)) {
      if (p[0x11] === 0xff) {
        raw[0x16] = 0;
        raw[0x18] = 0;
      } else {
        raw[0x16] = raw[0x16] || 1;
        raw[0x18] = p[0x11];
      }
    }
    raw[0x38] = raw[0x39] = 0xff;
    for (let i = 0; i < WL_MODES; i++) {
      if (!changed(0x16 + 2 * i) && !changed(0x17 + 2 * i)) continue;
      raw[0x3a + 2 * i] = p[0x17 + 2 * i] & 0x0f;
      raw[0x3b + 2 * i] = (p[0x17 + 2 * i] & 0xf0) | ((p[0x16 + 2 * i] & 0x0f) === 7 ? 7 : 0);
    }
    raw[0x7e] = 0x5a;
    raw[0x7f] = 0xa5;
    await sleep(60);
    await this.link.write(WCmd.SetLed, 0, raw);
    this.ledView = new Uint8Array(p);
  }

  // ---------------------------------------------------------------- key matrix (base layer)
  async readKeyMatrix(): Promise<Uint8Array> {
    const raw = await this.link.read(WCmd.GetMatrix, 0, LAYER_LEN);
    const view = new Uint8Array(1024);
    for (let i = 0; i < LAYER_SLOTS - 1; i++) {
      const c = u32(raw, i);
      setU32(view, i, wirelessToWired(c) ?? c);
    }
    this.layerRaw = raw;
    this.matrixView = view;
    return new Uint8Array(view);
  }

  async writeKeyMatrix(m: Uint8Array): Promise<void> {
    if (!this.layerRaw || !this.matrixView) await this.readKeyMatrix();
    const raw = new Uint8Array(this.layerRaw!);
    for (let i = 0; i < LAYER_SLOTS - 1; i++) {
      const next = u32(m, i);
      if (next === u32(this.matrixView!, i)) continue; // untouched: keep the keyboard's own code
      const wl = wiredToWireless(next);
      if (wl === null) throw new UnsupportedOverWireless('That key function is not supported over 2.4 GHz / Bluetooth. Connect the cable.');
      setU32(raw, i, wl);
    }
    setU32(raw, LAYER_SLOTS - 1, LAYER_TRAILER);
    await this.link.write(WCmd.SetMatrix, 0, raw);
    this.layerRaw = raw;
    await sleep(50);
  }

  // ---------------------------------------------------------------- palette / per-key
  async readRgbTable(): Promise<Uint8Array> {
    const raw = await this.link.read(WCmd.GetPalette, 0, PALETTE_LEN);
    this.paletteRaw = raw;
    const t = new Uint8Array(1024);
    t.set(raw.subarray(0, PALETTE_DATA));
    return t;
  }

  async writeRgbTable(t: Uint8Array): Promise<void> {
    const buf = new Uint8Array(this.paletteRaw ?? new Uint8Array(PALETTE_LEN));
    buf.set(t.subarray(0, PALETTE_DATA));
    buf[0x1fa] = 0x5a;
    buf[0x1fb] = 0xa5;
    await sleep(120);
    await this.link.write(WCmd.SetPalette, 0, buf);
    this.paletteRaw = buf;
  }

  async writeLedMatrix(buf: Uint8Array): Promise<void> {
    await this.link.write(WCmd.SetColors, 0, buf.subarray(0, LED_GROUP_LEN));
  }

  async writeMacroPages(): Promise<void> {
    throw new UnsupportedOverWireless('Macros can only be written over the USB cable for now.');
  }

  async checkModel(): Promise<Uint8Array | null> {
    return null;
  }

  // ---------------------------------------------------------------- live stream
  /** Encode a 126×RGB frame into colour groups [R,G,B,count,leds...] (≤ 200 bytes). */
  static encodeLive(rgb: Uint8Array, leds: number[]): Uint8Array {
    for (const bits of [8, 5, 4, 3, 2, 1]) {
      const shift = 8 - bits;
      const groups = new Map<number, number[]>();
      for (const idx of leds) {
        const q = (v: number) => (v >> shift) << shift;
        const key = (q(rgb[3 * idx]) << 16) | (q(rgb[3 * idx + 1]) << 8) | q(rgb[3 * idx + 2]);
        const g = groups.get(key);
        if (g) g.push(idx);
        else groups.set(key, [idx]);
      }
      const size = [...groups.values()].reduce((n, g) => n + 4 + g.length, 0);
      if (groups.size <= 64 && size <= LIVE_MAX) {
        const out = new Uint8Array(size);
        let p = 0;
        for (const [key, g] of groups) {
          // Use the group's average real colour, not the quantised bucket.
          const avg = [0, 1, 2].map((c) => Math.round(g.reduce((s, i) => s + rgb[3 * i + c], 0) / g.length));
          out.set([avg[0], avg[1], avg[2], g.length, ...g], p);
          p += 4 + g.length;
          void key;
        }
        return out;
      }
    }
    return new Uint8Array(0);
  }

  private liveLeds: number[] | null = null;
  setLiveLeds(leds: number[]) {
    this.liveLeds = leds;
  }

  async sendLiveFrame(rgb: Uint8Array): Promise<void> {
    const payload = Mk75Wireless.encodeLive(rgb, this.liveLeds ?? []);
    // sub 1 = per-key colour groups (matches captured vendor traffic: 13 88 01 00 15 …).
    await this.link.write(WCmd.Live, 1, payload);
  }

  async readBattery(): Promise<{ level: number; charging: boolean } | null> {
    if (this.flavour !== '3632') return null;
    const r = await this.link.read(WCmd.GetOnBoard, 0, 2);
    return { level: r[0], charging: (r[1] & 0xf0) !== 0 && (r[1] & 0x0f) === 0 };
  }
}
