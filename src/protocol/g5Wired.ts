/**
 * MK75 boards with an IC2481 controller (KB.ini `IC2481=1`, `Fw=24`) answer on the USB cable with the
 * vendor CDevG5KB logic instead of CDev916KB: one 520-byte feature report 0x06 (519 B without the ID)
 * carries every read and write. The data blocks are the same "layout B" as 2.4 GHz / Bluetooth, so
 * Mk75G5Wired reuses the Mk75Wireless adapter with USB opcodes. Verified against OemDrv.exe (MK75 v2.0):
 *
 *   frame = [cmd, sub, 0, total, index, lenLo, lenHi, payload (≤ 512)]      (AccessData 0x498F70)
 *   write: 20 ms (7 ms for live) before each chunk; 3 tries, 70 ms apart
 *   read:  20 ms, send the frame with cmd|0x80, 20 ms, get report 0x06, payload at offset 7
 *
 *   block       read  write  sub    len
 *   key matrix  83    03     layer  0x200   (GetMatrix 0x4991F0)
 *   LED profile 84    04     0      0x80
 *   macros      85    05     0      –       (format not verified yet, so macros stay off)
 *   per-key     86    06     group  0x17A
 *   live        –     08     0      0x17A   (126 × R,G,B by LED index)
 *   palette     8A    0A     0      0x200
 *   model id    82    –      1      6       (GetPassword 0x49A020 → 03 00 00 00 00 C6)
 *   battery     87    –      2      2       [percent, flags] (hw-re-docs, real MK75; not in the vendor app)
 */
import type { Mk75Options } from './mk75';
import { STREAM_LEN } from './mk75';
import type { FeatureTransport } from './transport';
import { Mk75Wireless, type LayoutBLink, type LayoutBOps } from './wireless/mk75Wireless';

export const G5_REPORT = 0x06;
/** Size of report 0x06 on IC2481 boards, excluding the report ID (CDev916KB boards use 0x407). */
export const G5_FRAME_LEN = 0x207;
const HEADER = 7;
const CHUNK = 0x200;
const OP_LIVE = 0x08;
const OP_MODEL = 0x82;

export const G5_OPS: LayoutBOps = {
  getLed: 0x84,
  setLed: 0x04,
  getMatrix: 0x83,
  setMatrix: 0x03,
  getPalette: 0x8a,
  setPalette: 0x0a,
  setColors: 0x06,
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class G5WiredLink implements LayoutBLink {
  private queue: Promise<unknown> = Promise.resolve();
  readonly io: { readonly name: string };

  constructor(
    private t: FeatureTransport,
    private log?: Mk75Options['onFrame'],
    private delayMs = 20,
  ) {
    this.io = { name: t.name };
  }

  /** The firmware handles one transaction at a time. */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private frame(cmd: number, sub: number, total: number, index: number, len: number): Uint8Array {
    const f = new Uint8Array(G5_FRAME_LEN);
    f.set([cmd, sub, 0, total, index, len & 0xff, len >> 8]);
    return f;
  }

  private async send(f: Uint8Array) {
    if (f[0] !== OP_LIVE) this.log?.('out', G5_REPORT, f);
    let err: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await this.t.sendFeature(G5_REPORT, f);
        return;
      } catch (e) {
        err = e;
        await sleep(70);
      }
    }
    throw new Error(`sendFeature(0x06) failed: ${String(err)}`);
  }

  write(cmd: number, sub: number, data: Uint8Array): Promise<void> {
    return this.exclusive(async () => {
      const total = Math.max(1, Math.ceil(data.length / CHUNK));
      for (let i = 0; i < total; i++) {
        const part = data.subarray(i * CHUNK, (i + 1) * CHUNK);
        const f = this.frame(cmd, sub, total, i, part.length);
        f.set(part, HEADER);
        await sleep(cmd === OP_LIVE ? 7 : this.delayMs);
        await this.send(f);
      }
      // On one IC2481 board an immediate palette read after a profile write
      // stopped the lighting; waiting here keeps later queued reads behind it.
      if (cmd === G5_OPS.setLed) await sleep(130);
    });
  }

  read(cmd: number, sub: number, len: number): Promise<Uint8Array> {
    return this.exclusive(async () => {
      const out = new Uint8Array(len);
      const total = Math.max(1, Math.ceil(len / CHUNK));
      for (let i = 0; i < total; i++) {
        const n = Math.min(CHUNK, len - i * CHUNK);
        // The vendor doesn't check the echo, but we write these blocks back, so never accept a stale reply.
        for (let attempt = 0; ; attempt++) {
          await sleep(this.delayMs);
          await this.send(this.frame(cmd, sub, total, i, n));
          await sleep(this.delayMs + attempt * 30);
          let r = await this.t.receiveFeature(G5_REPORT);
          this.log?.('in', G5_REPORT, r);
          // Linux may return the report ID on short responses even when the transport
          // has already normalized full-sized reports. G5 read opcodes are >= 0x80,
          // so matching both the ID and expected command avoids stripping payload.
          if (r[0] === G5_REPORT && r[1] === cmd) r = r.subarray(1);
          // Short HID reports are valid only when they still contain the complete requested payload.
          // Never turn a truncated reply into a zero-padded block that may later be written to flash.
          if (r[0] === cmd && r.length >= HEADER + n) {
            out.set(r.subarray(HEADER, HEADER + n), i * CHUNK);
            break;
          }
          if (attempt === 2) throw new Error(`Device did not answer read 0x${cmd.toString(16)} with a complete payload`);
        }
      }
      return out;
    });
  }

  close() {
    return this.t.close();
  }
}

export class Mk75G5Wired extends Mk75Wireless {
  constructor(transport: FeatureTransport, opts: Mk75Options = {}) {
    super(new G5WiredLink(transport, opts.onFrame), 'g5wired', G5_OPS);
  }

  override async checkModel(): Promise<Uint8Array | null> {
    try {
      return await this.link.read(OP_MODEL, 1, 6);
    } catch {
      return null;
    }
  }

  override async sendLiveFrame(rgb: Uint8Array): Promise<void> {
    await this.link.write(OP_LIVE, 0, rgb.subarray(0, STREAM_LEN));
  }
}
