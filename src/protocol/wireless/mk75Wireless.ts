/**
 * MK75 over the 2.4 GHz receiver or Bluetooth (vendor CDevComboFilm / CDev3632 + CDevG5KB logic).
 * Presents the wired data formats to the UI and converts to the wireless layouts:
 *
 *  LED profile (cmd 0x44 / 0x04), 128 B, "layout B", signature 5A A5 at 0x7E:
 *    0x03 debounce 0..4 · 0x09 custom flag · 0x0A hw effect · 0x0B colour group · 0x16 tap/hold threshold · 0x18 sleep (0 = never) · 0x1A knob 0 media / 1 lighting
 *    0x12 side-light mode 0..4 · 0x13 colour 0..6 · 0x14 brightness 0..4 · 0x15 speed 0..4
 *    0x38/0x39 = FF · 0x3A+2i brightness · 0x3B+2i speed<<4 | (colourful ? 7 : 0)   (i < 19)
 *  Key matrix (cmd 0x41 / 0x01, sub = layer: 0 base, 1 Fn, 2 unused, 3 tap/hold), 512 B = 128 u32, last u32 = 0xA55A0000.
 *  Palette (cmd 0x49 / 0x09), 0x200 B: same offsets as wired (0x15*hw), 5A A5 at 0x1FA.
 *  Per-key colours (cmd 0x02, sub = group), 0x17A B: R/G/B planes of 126.
 *  Live stream (cmd 0x88, no ack): groups [R,G,B,count,led...], <= 200 bytes.
 */
import { SIDE_LIGHT_FIELDS, type DeviceCaps, type KeyboardSettings, type Mk75Device, type SideLights } from '../device';
import { PROFILE_LEN } from '../mk75';
import { LED_GROUP_LEN, PER_MODE_SLOTS } from '../lighting';
import { STORE_BLOCK, STORE_BLOCKS } from '../macro';
import { wiredToWireless, wirelessToWired } from './codes';
import { WCmd } from './packet';

const LED_LEN = 128;
const LAYER_LEN = 512;
/** Real receivers answer 504 of 512 keymap and 490 of 512 palette bytes (hw-re-docs, Wireless → Reading). */
const LAYER_READ_MIN = 504;
const LAYER_SLOTS = LAYER_LEN / 4;
const LAYER_TRAILER = 0xa55a0000;
const PALETTE_LEN = 0x200;
const PALETTE_READ_MIN = 490;
const PALETTE_DATA = 0x1a4;
/**
 * Palette bytes 483..511 as a cable read of a real MK75 returns them (issue #29): a copy of the model id
 * (03 00 00 00 00 C6), then 00 00 10, zeros, 5A A5 00 10 00 00. 2.4 GHz reads stop at byte 490 (issue #31, same
 * keyboard), so a save restores the missing bytes from here instead of zeroing them.
 */
export const PALETTE_TAIL_AT = 483;
export const MK75_PALETTE_TAIL = Uint8Array.from([3, 0, 0, 0, 0, 0xc6, 0, 0, 0x10, ...new Array(14).fill(0), 0x5a, 0xa5, 0, 0x10, 0, 0]);
const WL_MODES = 19;
const LIVE_MAX = 200;
const OP_USB_MACRO = 0x05;
/** Layout-B cell types: 07 device function, 0D Fn key (never changed); 03 macro, 08 lighting (kept raw). */
const PROTECTED_TYPES = [0x07, 0x0d];
const RAW_TYPES = [0x03, 0x08];

const u32 = (b: Uint8Array, i: number) => new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(i * 4, true);
const setU32 = (b: Uint8Array, i: number, v: number) => new DataView(b.buffer, b.byteOffset, b.byteLength).setUint32(i * 4, v >>> 0, true);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class UnsupportedOverWireless extends Error {}

/**
 * Fill palette bytes 490..511 that a short 2.4 GHz read left as zeros with the MK75's own values, but only when
 * the bytes that did arrive (483..489) are the MK75 identity copy. Full reads (cable) are left untouched.
 */
function restorePaletteTail(buf: Uint8Array) {
  const got = PALETTE_READ_MIN - PALETTE_TAIL_AT;
  const seen = buf.subarray(PALETTE_TAIL_AT, PALETTE_READ_MIN);
  if (!seen.every((b, i) => b === MK75_PALETTE_TAIL[i])) return;
  if (buf.subarray(PALETTE_READ_MIN).some((b) => b !== 0)) return;
  buf.set(MK75_PALETTE_TAIL.subarray(got), PALETTE_READ_MIN);
}

/** What the adapter needs from its link: WirelessLink (2.4 GHz / BT) or G5WiredLink (USB, IC2481 boards). */
export interface LayoutBLink {
  readonly io: { readonly name: string };
  read(cmd: number, sub: number, len: number, min?: number): Promise<Uint8Array>;
  write(cmd: number, sub: number, data: Uint8Array): Promise<void>;
  /**
   * Input reports the keyboard sends unasked (diagnostics). Only links whose protocol doesn't itself use input
   * reports can offer this; 2.4 GHz / Bluetooth replies arrive as input reports, so WirelessLink leaves it out.
   */
  onUnsolicited?(cb: (reportId: number, data: Uint8Array) => void): (() => void) | null;
  close(): Promise<void>;
}

/** Layout B opcodes. The same CDevG5KB blocks use different command bytes over USB (see g5Wired.ts). */
export interface LayoutBOps {
  getLed: number;
  setLed: number;
  getMatrix: number;
  setMatrix: number;
  getPalette: number;
  setPalette: number;
  setColors: number;
}

const WIRELESS_OPS: LayoutBOps = {
  getLed: WCmd.GetLed,
  setLed: WCmd.SetLed,
  getMatrix: WCmd.GetMatrix,
  setMatrix: WCmd.SetMatrix,
  getPalette: WCmd.GetPalette,
  setPalette: WCmd.SetPalette,
  setColors: WCmd.SetColors,
};

export class Mk75Wireless implements Mk75Device {
  readonly kind: 'wired' | 'wireless';
  readonly caps: DeviceCaps;
  readonly canStream = true;
  readonly transport: { name: string; close(): Promise<void> };
  readonly simulated: boolean;

  private ledView: Uint8Array | null = null;
  /** Last read/written layer bytes (layout B) and their wired view, by layer. */
  private layers = new Map<number, { raw: Uint8Array; view: Uint8Array }>();
  private paletteRaw: Uint8Array | null = null;
  private chain: Promise<unknown> = Promise.resolve();

  /** Read-modify-write sequences must not interleave: the link only queues single transfers. */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => undefined);
    return run;
  }

  constructor(
    protected link: LayoutBLink,
    /** 'combo' = report ID 0x15 receiver; '3632' = report ID 0x13 (has battery + reset); 'g5wired' = USB cable. */
    readonly flavour: 'combo' | '3632' | 'g5wired',
    private ops: LayoutBOps = WIRELESS_OPS,
  ) {
    this.kind = flavour === 'g5wired' ? 'wired' : 'wireless';
    this.caps = { macros: flavour === 'combo' ? false : 'store', paletteIndex: flavour === 'g5wired', battery: flavour !== 'combo' };
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
    let signed = false;
    for (let i = 0; i < 5; i++) {
      const r = await this.link.read(this.ops.getLed, 0, LED_LEN);
      signed = r[0x7e] === 0x5a && r[0x7f] === 0xa5;
      // A sleeping keyboard keeps 5A A5 but zeroes the rest (no FF FF at 0x38); writing that back wipes the config.
      if (signed && r[0x38] === 0xff && r[0x39] === 0xff) return r;
      await sleep(100);
    }
    throw new Error(
      signed
        ? 'The keyboard is asleep. Press any key on it, then try again.'
        : 'Keyboard returned an invalid lighting block (no 5A A5 signature)',
    );
  }

  async readProfile(): Promise<Uint8Array> {
    const raw = await this.readLedRaw();
    const p = new Uint8Array(PROFILE_LEN);
    p[0x04] = raw[0x09];
    p[0x05] = raw[0x0a];
    p[0x06] = raw[0x0b];
    p[0x11] = raw[0x18] === 0 ? 0xff : raw[0x18];
    p[0x14] = p[0x15] = 0xff;
    for (let i = 0; i < WL_MODES; i++) {
      const bright = raw[0x3a + 2 * i] & 0x0f;
      const b = raw[0x3b + 2 * i];
      p[0x16 + 2 * i] = this.colour(b & 0x0f);
      p[0x17 + 2 * i] = (b & 0xf0) | bright;
    }
    this.ledView = p;
    return new Uint8Array(p);
  }

  /** Colour nibble: palette index 0..6 or 7 = colourful; wireless only honours colourful or colour 0. */
  private colour(c: number): number {
    if (this.caps.paletteIndex) return Math.min(c, 7);
    return c === 7 ? 7 : 0;
  }

  writeProfile(p: Uint8Array): Promise<void> {
    return this.exclusive(() => this.writeProfileNow(p));
  }

  private async writeProfileNow(p: Uint8Array): Promise<void> {
    // Vendor: read the live block first, patch, write back.
    const raw = await this.readLedRaw();
    const prev = this.ledView ?? (await this.readProfile());
    const changed = (o: number) => p[o] !== prev[o];
    raw[0x09] = p[0x04];
    raw[0x0a] = p[0x05];
    raw[0x0b] = p[0x06];
    // Byte 0x18 alone is the sleep timer (0 = never); 0x16 is the tap/hold threshold (hw-re-docs, real MK75).
    if (changed(0x11)) raw[0x18] = p[0x11] === 0xff ? 0 : p[0x11];
    raw[0x38] = raw[0x39] = 0xff;
    for (let i = 0; i < PER_MODE_SLOTS; i++) {
      if (!changed(0x16 + 2 * i) && !changed(0x17 + 2 * i)) continue;
      raw[0x3a + 2 * i] = p[0x17 + 2 * i] & 0x0f;
      raw[0x3b + 2 * i] = (p[0x17 + 2 * i] & 0xf0) | this.colour(p[0x16 + 2 * i] & 0x0f);
    }
    raw[0x7e] = 0x5a;
    raw[0x7f] = 0xa5;
    await sleep(60);
    await this.link.write(this.ops.setLed, 0, raw);
    this.ledView = new Uint8Array(p);
  }

  // ---------------------------------------------------------------- settings outside the wired profile
  onRawInput(cb: (reportId: number, data: Uint8Array) => void): (() => void) | null {
    return this.link.onUnsolicited?.(cb) ?? null;
  }

  /** All readable blocks, unchanged, without touching the adapter's caches. Waits for any write in progress. */
  readRawBlocks(): Promise<Record<string, Uint8Array>> {
    return this.exclusive(async () => {
      const out: Record<string, Uint8Array> = { led: new Uint8Array(await this.readLedRaw()) };
      out.palette = new Uint8Array(await this.link.read(this.ops.getPalette, 0, PALETTE_LEN, PALETTE_READ_MIN));
      for (let l = 0; l < 4; l++) out[`keymap ${l}`] = new Uint8Array(await this.link.read(this.ops.getMatrix, l, LAYER_LEN, LAYER_READ_MIN));
      return out;
    });
  }

  async readSettings(): Promise<KeyboardSettings> {
    const raw = await this.readLedRaw();
    return { debounce: raw[0x03], knob: raw[0x1a] };
  }

  writeSettings(s: Partial<KeyboardSettings>): Promise<void> {
    return this.exclusive(() => this.writeSettingsNow(s));
  }

  private async writeSettingsNow(s: Partial<KeyboardSettings>): Promise<void> {
    const raw = await this.readLedRaw();
    if (s.debounce !== undefined) {
      if (!Number.isInteger(s.debounce) || s.debounce < 0 || s.debounce > 4) throw new RangeError('Debounce level must be 0..4');
      raw[0x03] = s.debounce;
    }
    if (s.knob !== undefined) {
      if (s.knob !== 0 && s.knob !== 1) throw new RangeError('Knob mode must be 0 or 1');
      raw[0x1a] = s.knob;
    }
    await sleep(60);
    await this.link.write(this.ops.setLed, 0, raw);
  }

  // ---------------------------------------------------------------- side light bars
  async readSideLights(): Promise<SideLights> {
    const raw = await this.readLedRaw();
    const f = SIDE_LIGHT_FIELDS;
    return { mode: raw[f.mode.at], colour: raw[f.colour.at], brightness: raw[f.brightness.at], speed: raw[f.speed.at] };
  }

  writeSideLights(s: Partial<SideLights>): Promise<void> {
    return this.exclusive(async () => {
      const fields = (Object.keys(SIDE_LIGHT_FIELDS) as (keyof SideLights)[]).filter((k) => s[k] !== undefined);
      // Check before reading, so a bad value never leads to a write.
      for (const k of fields) {
        const v = s[k]!;
        const { count } = SIDE_LIGHT_FIELDS[k];
        if (!Number.isInteger(v) || v < 0 || v >= count) throw new RangeError(`Side-light ${k} must be 0..${count - 1}`);
      }
      if (!fields.length) return;
      const raw = await this.readLedRaw();
      for (const k of fields) raw[SIDE_LIGHT_FIELDS[k].at] = s[k]!;
      await sleep(60);
      await this.link.write(this.ops.setLed, 0, raw);
    });
  }

  // ---------------------------------------------------------------- key layers (0 base, 1 Fn)
  private async readLayer(layer: number): Promise<Uint8Array> {
    const raw = await this.link.read(this.ops.getMatrix, layer, LAYER_LEN, LAYER_READ_MIN);
    const view = new Uint8Array(1024);
    for (let i = 0; i < LAYER_SLOTS - 1; i++) {
      const c = u32(raw, i);
      setU32(view, i, wirelessToWired(c) ?? c);
    }
    this.layers.set(layer, { raw, view });
    return new Uint8Array(view);
  }

  /** Layout-B bytes for a wired-view layer. Throws, without writing, on a protected cell or a code with no layout-B form. */
  private async encodeLayer(layer: number, m: Uint8Array): Promise<Uint8Array> {
    if (!this.layers.has(layer)) await this.readLayer(layer);
    const prev = this.layers.get(layer)!;
    const raw = new Uint8Array(prev.raw);
    for (let i = 0; i < LAYER_SLOTS - 1; i++) {
      const next = u32(m, i);
      if (next === u32(prev.view, i)) continue; // untouched: keep the keyboard's own code
      // Firmware functions (mode switch, pairing, battery, Win lock) and the Fn key are never overwritten.
      if (PROTECTED_TYPES.includes(raw[4 * i])) throw new Error('That key holds a keyboard function (Fn, mode or pairing) and cannot be remapped.');
      // A layout-B code with no wired form (e.g. a lighting function) is written back as it is.
      const wl = wiredToWireless(next) ?? (wirelessToWired(next) === null && RAW_TYPES.includes(next & 0xff) ? next : null);
      if (wl === null) {
        throw new UnsupportedOverWireless(
          this.kind === 'wired'
            ? 'That key function is not supported on this keyboard revision yet.'
            : 'That key function is not supported over 2.4 GHz / Bluetooth. Connect the cable.',
        );
      }
      setU32(raw, i, wl);
    }
    setU32(raw, LAYER_SLOTS - 1, LAYER_TRAILER);
    return raw;
  }

  private writeLayer(layer: number, m: Uint8Array): Promise<void> {
    return this.exclusive(() => this.writeLayerNow(layer, m));
  }

  private async writeLayerNow(layer: number, m: Uint8Array): Promise<void> {
    const raw = await this.encodeLayer(layer, m);
    await this.link.write(this.ops.setMatrix, layer, raw);
    this.layers.set(layer, { raw, view: new Uint8Array(m) });
    await sleep(50);
  }

  readKeyMatrix(): Promise<Uint8Array> {
    return this.readLayer(0);
  }
  writeKeyMatrix(m: Uint8Array): Promise<void> {
    return this.writeLayer(0, m);
  }
  /** Dry run of writeKeyMatrix, so callers fail before the macro store is on flash. */
  async checkKeyMatrix(m: Uint8Array): Promise<void> {
    await this.encodeLayer(0, m);
  }
  /** Keymap layer 1: what each key does while Fn is held (hw-re-docs, real MK75). */
  readFnLayer(): Promise<Uint8Array> {
    return this.readLayer(1);
  }
  writeFnLayer(m: Uint8Array): Promise<void> {
    return this.writeLayer(1, m);
  }

  // ---------------------------------------------------------------- palette / per-key
  private async readPaletteRaw(): Promise<Uint8Array> {
    const raw = await this.link.read(this.ops.getPalette, 0, PALETTE_LEN, PALETTE_READ_MIN);
    this.paletteRaw = raw;
    return raw;
  }

  async readRgbTable(): Promise<Uint8Array> {
    const raw = await this.readPaletteRaw();
    const t = new Uint8Array(1024);
    t.set(raw.subarray(0, PALETTE_DATA));
    return t;
  }

  writeRgbTable(t: Uint8Array): Promise<void> {
    return this.exclusive(() => this.writeRgbTableNow(t));
  }

  private async writeRgbTableNow(t: Uint8Array): Promise<void> {
    const buf = new Uint8Array(this.paletteRaw ?? new Uint8Array(PALETTE_LEN));
    buf.set(t.subarray(0, PALETTE_DATA));
    restorePaletteTail(buf);
    buf[0x1fa] = 0x5a;
    buf[0x1fb] = 0xa5;
    await sleep(120);
    await this.link.write(this.ops.setPalette, 0, buf);
    this.paletteRaw = buf;
  }

  async writeLedMatrix(buf: Uint8Array): Promise<void> {
    await this.link.write(this.ops.setColors, 0, buf.subarray(0, LED_GROUP_LEN));
  }

  /** Macro store blocks from planMacros(…, 'store'): contiguous from block 0, 512 bytes each, never block 8+. */
  async writeMacroPages(pages: { sub: number; data: Uint8Array }[]): Promise<void> {
    if (!this.caps.macros) throw new UnsupportedOverWireless('Macros are not supported on this receiver type.');
    if (pages.length > STORE_BLOCKS || pages.some((p, i) => p.sub !== i || p.data.length !== STORE_BLOCK))
      throw new Error('Invalid macro store blocks');
    // The OEM app numbers macro ids across all layers; ours only plans the base layer, so rewriting the store
    // would point macro keys on the Fn (1) or tap/hold (3) layer at the wrong macro.
    for (const [layer, name] of [[1, 'Fn'], [3, 'tap/hold']] as const) {
      const raw = await this.link.read(this.ops.getMatrix, layer, LAYER_LEN, LAYER_READ_MIN);
      for (let i = 0; i < LAYER_SLOTS - 1; i++) {
        if (raw[4 * i] === 0x03 && raw[4 * i + 1] !== 0)
          throw new Error(`The ${name} layer has macro keys set by the official app. Remove them there first, or saving macros here would renumber them.`);
      }
    }
    if (this.kind === 'wired') {
      // Cable: one transfer, the block number in the frame addresses the sector.
      const all = new Uint8Array(pages.length * STORE_BLOCK);
      pages.forEach((p, i) => all.set(p.data, i * STORE_BLOCK));
      await this.link.write(OP_USB_MACRO, 0, all);
    } else {
      for (const p of pages) await this.link.write(WCmd.SetMacro, p.sub, p.data);
    }
    await sleep(50);
  }

  /** No model command over 2.4 GHz, but the palette holds a copy of the id at byte 483 (issues #29, #31). */
  async checkModel(): Promise<Uint8Array | null> {
    try {
      const id = (this.paletteRaw ?? (await this.readPaletteRaw())).slice(PALETTE_TAIL_AT, PALETTE_TAIL_AT + 6);
      return id.some((b) => b !== 0) ? id : null;
    } catch {
      return null;
    }
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

  /** [percent, flags]; flags 0x01 on battery, 0x10 charging (keys go dark), 0x11 charged (hw-re-docs). */
  async readBattery(): Promise<{ level: number; charging: boolean } | null> {
    if (this.flavour === 'combo') return null;
    const r = this.flavour === 'g5wired' ? await this.link.read(0x87, 2, 2) : await this.link.read(WCmd.GetOnBoard, 0, 2);
    if (r[0] > 100) return null; // not a percentage: unknown reply
    return { level: r[0], charging: (r[1] & 0xf0) !== 0 && (r[1] & 0x0f) === 0 };
  }
}
