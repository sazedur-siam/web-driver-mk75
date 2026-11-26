/**
 * AU75 (Sinowealth "BY Combo" / CDev916KB) wired protocol, reverse-engineered from the vendor
 * Windows driver OemDrv.exe v2.0 (2025-08-05). See PROTOCOL.md for the derivation.
 *
 * Command channel (feature report 0x05, 6 bytes):   [op, sub, 0, 0, 0, 0]
 * Data channel    (feature report 0x06, 1031 bytes): [op, sub, a, b, 0, 0, 0, payload...]
 *
 * A read sends `op | 0x80` on the command channel, waits, then fetches report 0x06; the reply
 * echoes the op byte and carries the payload from offset 7. A write sends the whole frame on 0x06.
 */
import type { DeviceCaps, Mk75Device } from './device';
import type { FeatureTransport } from './transport';

export const REPORT_CMD = 0x05;
export const REPORT_DATA = 0x06;
/** Live LED stream (vendor "hMusic" collection, 0x17E bytes incl. ID). */
export const REPORT_STREAM = 0x08;
export const STREAM_LEN = 0x17a; // 126 LEDs x RGB
export const DATA_FRAME_LEN = 0x407; // 1031 bytes, excluding report ID
export const DATA_HEADER_LEN = 7;
export const PAGE_LEN = 0x400; // 1024-byte payload pages

export const PROFILE_LEN = 254;

/** Opcodes as observed in OemDrv.exe. Read variants are `op | 0x80`. */
export const Op = {
  /** Lighting/profile block, 254 bytes. Read 0x83, write 0x03. Sub 0xB6. */
  Profile: { op: 0x03, sub: 0xb6, flag: 0x00 },
  /** Key matrix (base layer + Fn slots), 1024 bytes. Read 0x84, write 0x04. Sub 0xD4. */
  KeyMatrix: { op: 0x04, sub: 0xd4, flag: 0x40 },
  /** Per-mode colour palette (7 colours x 3 bytes per mode). Read 0x88, write 0x08. Sub 0xB8. */
  RgbTable: { op: 0x08, sub: 0xb8, flag: 0x40 },
} as const;

/** Macro pages: write-only, op 0x05, sub = page id. */
export const OP_MACRO = 0x05;
/** Per-key "Self-define" colour pages: write-only, op 0x09, sub = 0xBC then 0xC0. */
export const OP_LED_MATRIX = 0x09;
export const LED_MATRIX_PAGES = [0xbc, 0xc0] as const;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class ProtocolError extends Error {}

export interface Mk75Options {
  /** Delay between the read command and fetching the reply (vendor uses a per-device value). */
  readDelayMs?: number;
  /** Delay after each write so the MCU can commit to flash. Vendor uses 30-50 ms. */
  writeDelayMs?: number;
  /** Optional wire logger for debugging. */
  onFrame?: (dir: 'out' | 'in', reportId: number, data: Uint8Array) => void;
}

export class Mk75 implements Mk75Device {
  readonly kind = 'wired' as const;
  readonly caps: DeviceCaps = { macros: 'slots', paletteIndex: true, battery: false };
  readonly simulated: boolean;
  private queue: Promise<unknown> = Promise.resolve();
  private readDelay: number;
  private writeDelay: number;

  constructor(
    readonly transport: FeatureTransport,
    private opts: Mk75Options = {},
  ) {
    this.readDelay = opts.readDelayMs ?? 25; // vendor ctor: obj+0x2A0 = 0x19
    this.simulated = transport.name.startsWith('Simulated');
    this.writeDelay = opts.writeDelayMs ?? 50;
  }

  /** Serialise all device I/O; the firmware handles one transaction at a time. */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async send(reportId: number, data: Uint8Array) {
    this.opts.onFrame?.('out', reportId, data);
    let lastErr: unknown;
    // Vendor driver retries 3 times with a 200 ms back-off.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await this.transport.sendFeature(reportId, data);
        return;
      } catch (e) {
        lastErr = e;
        await sleep(200);
      }
    }
    throw new ProtocolError(`sendFeature(0x${reportId.toString(16)}) failed: ${String(lastErr)}`);
  }

  private async receive(reportId: number): Promise<Uint8Array> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const d = await this.transport.receiveFeature(reportId);
        this.opts.onFrame?.('in', reportId, d);
        return d;
      } catch (e) {
        lastErr = e;
        await sleep(200);
      }
    }
    throw new ProtocolError(`receiveFeature(0x${reportId.toString(16)}) failed: ${String(lastErr)}`);
  }

  /**
   * @param requireEcho The vendor checks the echoed op for profile (0x83) and RGB table (0x88)
   *   reads but not for the key matrix (0x84), so only enforce it where the vendor does.
   */
  private async readBlock(op: number, sub: number, len: number, requireEcho = true): Promise<Uint8Array> {
    const readOp = op | 0x80;
    for (let attempt = 0; attempt < 3; attempt++) {
      await this.send(REPORT_CMD, Uint8Array.of(readOp, sub, 0, 0, 0, 0));
      await sleep(this.readDelay + attempt * 30);
      let reply = await this.receive(REPORT_DATA);
      // Some platforms keep the report ID on a reply that isn't exactly the descriptor size (see g5Wired.ts).
      if (reply[0] === REPORT_DATA && reply[1] === readOp) reply = reply.subarray(1);
      // A short block would be zero-padded and written back on the next save: retry instead.
      if (reply.length < DATA_HEADER_LEN + len) continue;
      if (!requireEcho || reply[0] === readOp) return reply.slice(DATA_HEADER_LEN, DATA_HEADER_LEN + len);
    }
    throw new ProtocolError(`Device did not answer read 0x${readOp.toString(16)}/0x${sub.toString(16)}`);
  }

  private async writeBlock(op: number, sub: number, flag: number, payload: Uint8Array) {
    if (payload.length > DATA_FRAME_LEN - DATA_HEADER_LEN) throw new ProtocolError('payload too large');
    const frame = new Uint8Array(DATA_FRAME_LEN);
    frame.set([op, sub, 0x00, flag, 0x00, 0x00, 0x00]);
    frame.set(payload, DATA_HEADER_LEN);
    await this.send(REPORT_DATA, frame);
    await sleep(this.writeDelay);
  }

  readProfile() {
    return this.exclusive(() => this.readBlock(Op.Profile.op, Op.Profile.sub, PROFILE_LEN));
  }
  writeProfile(data: Uint8Array) {
    if (data.length !== PROFILE_LEN) throw new ProtocolError(`profile must be ${PROFILE_LEN} bytes`);
    return this.exclusive(() => this.writeBlock(Op.Profile.op, Op.Profile.sub, Op.Profile.flag, data));
  }

  readKeyMatrix() {
    return this.exclusive(() => this.readBlock(Op.KeyMatrix.op, Op.KeyMatrix.sub, PAGE_LEN, false));
  }
  writeKeyMatrix(data: Uint8Array) {
    if (data.length !== PAGE_LEN) throw new ProtocolError(`key matrix must be ${PAGE_LEN} bytes`);
    return this.exclusive(() => this.writeBlock(Op.KeyMatrix.op, Op.KeyMatrix.sub, Op.KeyMatrix.flag, data));
  }

  readRgbTable() {
    return this.exclusive(() => this.readBlock(Op.RgbTable.op, Op.RgbTable.sub, PAGE_LEN));
  }
  writeRgbTable(data: Uint8Array) {
    if (data.length > PAGE_LEN) throw new ProtocolError('rgb table too large');
    return this.exclusive(() => this.writeBlock(Op.RgbTable.op, Op.RgbTable.sub, Op.RgbTable.flag, data));
  }

  /** Write macro pages (op 0x05, sub 0xDC/0xE0/0xE4/0xE8), 50 ms apart like the vendor. */
  writeMacroPages(pages: { sub: number; data: Uint8Array }[]) {
    return this.exclusive(async () => {
      for (const p of pages) {
        const page = new Uint8Array(PAGE_LEN);
        page.set(p.data.subarray(0, PAGE_LEN));
        await this.writeBlock(OP_MACRO, p.sub, 0x40, page);
      }
    });
  }

  /**
   * Model check used by the vendor on open (Psd): report 05 [05 81 ...] → report 05 reply
   * [01, 03, 00, 00, 00, 00, C6] for the MK75. Returns the 6 id bytes, or null if unsupported.
   */
  checkModel() {
    return this.exclusive(async () => {
      try {
        await this.transport.sendFeature(REPORT_CMD, Uint8Array.of(0x05, 0x81, 0, 0, 0, 0, 0, 0));
        await sleep(this.readDelay);
        const r = await this.transport.receiveFeature(REPORT_CMD);
        this.opts.onFrame?.('in', REPORT_CMD, r);
        return r[0] === 0x01 ? r.slice(1, 7) : null;
      } catch {
        return null;
      }
    });
  }

  /** True if the keyboard exposes the live-stream report (0x08). */
  get canStream(): boolean {
    return (this.transport.featureSize(REPORT_STREAM) ?? 0) > 0;
  }

  /**
   * Send one live frame (music / real-time effects): report 0x08 = [0A 7A 01] + 378 bytes of
   * R,G,B triplets indexed by LED index (126 LEDs). Not queued behind config I/O, not logged.
   */
  async sendLiveFrame(rgb: Uint8Array) {
    const frame = new Uint8Array(3 + STREAM_LEN);
    frame.set([0x0a, 0x7a, 0x01]);
    frame.set(rgb.subarray(0, STREAM_LEN), 3);
    await this.transport.sendFeature(REPORT_STREAM, frame);
  }

  /** Write the per-key "Self-define" colour buffer (split into two 1 KiB pages, as the vendor does). */
  writeLedMatrix(buffer: Uint8Array) {
    return this.exclusive(async () => {
      for (let i = 0; i < LED_MATRIX_PAGES.length; i++) {
        const page = new Uint8Array(PAGE_LEN);
        page.set(buffer.subarray(i * PAGE_LEN, (i + 1) * PAGE_LEN));
        await this.writeBlock(OP_LED_MATRIX, LED_MATRIX_PAGES[i], 0x40, page);
      }
    });
  }
}
