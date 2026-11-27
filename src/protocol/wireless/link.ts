/**
 * Request/ack engine for the wireless protocol, modelled on the vendor SendData/ReadData:
 *  - writes: 14-byte chunks, 15 ms before each packet (10 ms for live 0x88/0x8E), wait for an ack
 *    with the same cmd (1.5 s), retry each packet up to 5x on busy/timeout; no ack for 0x88/0x8E/0x06.
 *  - reads: one request packet, then collect `total` reply packets. The vendor waits 1 s per packet and makes
 *    3 attempts. We keep packets across attempts and continue while attempts bring new ones (Bluetooth drops input
 *    reports, issues #32/#35), so we also stop waiting sooner once a burst has ended: 1 s for the first packet,
 *    250 ms between packets.
 */
import { chunk, parsePacket, PKT_DATA, type Packet } from './packet';

export interface ReportIO {
  /** Send an output report; `body` = 19 bytes after the report ID. */
  send(reportId: number, body: Uint8Array): Promise<void>;
  /** Subscribe to input reports (body after the report ID). Returns an unsubscribe function. */
  onInput(cb: (reportId: number, body: Uint8Array) => void): () => void;
  close(): Promise<void>;
  readonly name: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Most attempts per read. The vendor makes 3, but over Bluetooth each attempt delivers only about half the packets
 * (issue #35: up to 8 attempts for the 35-packet palette), so a read needs many attempts to fill every gap.
 */
const READ_ATTEMPTS = 20;
/** A read gives up after this many attempts in a row that brought no new packet (the vendor's 3 attempts). */
const READ_STALE_ATTEMPTS = 3;

export class LinkError extends Error {}

export class WirelessLink {
  private queue: Promise<unknown> = Promise.resolve();
  private waiters: ((p: Packet) => boolean)[] = [];
  private unsub: () => void;

  constructor(
    readonly io: ReportIO,
    readonly reportId: number,
    private log?: (dir: 'out' | 'in', body: Uint8Array) => void,
    /**
     * `readMs`: wait for the first reply packet. `gapMs`: wait for each later one. Issue #35 (Bluetooth) measured
     * at most 30 ms between delivered packets and 160 ms per whole reply; issue #31 (2.4 GHz) at most 6 ms. Ending
     * an attempt early costs one more request, never data, because packets are kept across attempts.
     */
    private timing: { pace: number; livePace: number; ackMs: number; readMs: number; gapMs?: number } = {
      pace: 15,
      livePace: 10,
      ackMs: 1500,
      readMs: 1000,
      gapMs: 250,
    },
  ) {
    this.unsub = io.onInput((_id, body) => {
      this.log?.('in', body);
      const p = parsePacket(body);
      this.waiters = this.waiters.filter((w) => !w(p));
    });
  }

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Wait for the next packet matching `cmd` (and `index` when given). */
  private next(cmd: number, ms: number, index?: number): Promise<Packet> {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== h);
        reject(new LinkError(`timeout waiting for 0x${cmd.toString(16)}`));
      }, ms);
      const h = (p: Packet) => {
        if (p.cmd !== cmd || (index !== undefined && !p.busy && p.index !== index)) return false;
        clearTimeout(t);
        resolve(p);
        return true;
      };
      this.waiters.push(h);
    });
  }

  private async sendBody(body: Uint8Array) {
    if (!(body[0] & 0x80)) this.log?.('out', body); // don't flood the log with live frames
    await this.io.send(this.reportId, body);
  }

  write(cmd: number, sub: number, payload: Uint8Array) {
    return this.exclusive(async () => {
      const live = (cmd & 0x80) !== 0;
      const noAck = live || cmd === 0x06;
      for (const body of chunk(this.reportId, cmd, sub, payload)) {
        for (let attempt = 0; ; attempt++) {
          await sleep(live ? this.timing.livePace : this.timing.pace);
          const ack = noAck ? null : this.next(cmd, this.timing.ackMs, body[2]);
          ack?.catch(() => undefined); // a failed send must not leave an unhandled rejection behind
          await this.sendBody(body);
          if (!ack) break;
          try {
            const p = await ack;
            if (!p.busy) break;
          } catch {
            /* timeout → retry */
          }
          if (attempt >= 4) throw new LinkError(`no ack for cmd 0x${cmd.toString(16)} packet ${body[2]}`);
        }
      }
    });
  }

  /**
   * Collect reply packets for `cmd` into `got` (keyed by index) until packets 0..total-1 are all there.
   * `got` may already hold packets from an earlier attempt of the same read; only the gaps are waited for.
   */
  private collect(cmd: number, ms: number, gapMs: number, got: Map<number, Packet>): Promise<Packet[]> {
    return new Promise((resolve, reject) => {
      let timer = setTimeout(fail, ms);
      function fail() {
        remove();
        reject(new LinkError(`timeout reading 0x${cmd.toString(16)} (${got.size} packets)`));
      }
      const remove = () => (this.waiters = this.waiters.filter((w) => w !== h));
      const h = (p: Packet) => {
        if (p.cmd !== cmd) return false;
        if (p.busy) {
          clearTimeout(timer);
          reject(new LinkError('device busy'));
          return true;
        }
        const total = Math.max(1, p.total);
        // A different packet count means a different reply (e.g. a short one): never mix the two.
        if ([...got.values()].some((q) => Math.max(1, q.total) !== total)) got.clear();
        if (p.index < total) got.set(p.index, p);
        clearTimeout(timer);
        if (got.size >= total) {
          resolve([...got.values()].sort((a, b) => a.index - b.index));
          return true;
        }
        timer = setTimeout(fail, gapMs); // the rest of the burst follows within milliseconds
        return false;
      };
      this.waiters.push(h);
    });
  }

  /**
   * `min`: fewest bytes that count as a whole reply (2.4 GHz receivers never send the last bytes of some blocks).
   *
   * Bluetooth drops some input reports, and a packet that is lost on one attempt may be lost on the next two as well
   * (issue #32). The block does not change between attempts, so packets are kept across attempts and each resend
   * only has to fill the gaps. Attempts continue while they bring new packets, up to READ_ATTEMPTS.
   */
  read(cmd: number, sub: number, len: number, min = len) {
    return this.exclusive(async () => {
      const got = new Map<number, Packet>();
      let lastErr: unknown;
      for (let attempt = 0, stale = 0; attempt < READ_ATTEMPTS && stale < READ_STALE_ATTEMPTS; attempt++) {
        const before = got.size;
        try {
          const { readMs, gapMs = readMs } = this.timing;
          const replies = this.collect(cmd, readMs, Math.min(gapMs, readMs), got);
          replies.catch(() => undefined);
          await sleep(this.timing.pace);
          await this.sendBody(chunk(this.reportId, cmd, sub, new Uint8Array(0))[0]);
          const out = new Uint8Array(len);
          let filled = 0;
          for (const p of await replies) {
            out.set(p.data.subarray(0, Math.max(0, len - filled)), filled);
            filled += p.data.length;
          }
          // A short config block would be zero-padded and written back on the next save. Small status replies
          // (online, battery) may legitimately carry fewer bytes than asked, so only blocks are checked.
          if (len > PKT_DATA && filled < min) {
            got.clear(); // ask again from scratch
            throw new LinkError(`short reply for 0x${cmd.toString(16)}: ${filled} of ${len} bytes`);
          }
          return out;
        } catch (e) {
          lastErr = e;
          stale = got.size > before ? 0 : stale + 1;
          await sleep(100);
        }
      }
      throw new LinkError(`read 0x${cmd.toString(16)} failed: ${String(lastErr)}`);
    });
  }

  async close() {
    this.unsub();
    await this.io.close();
  }
}
