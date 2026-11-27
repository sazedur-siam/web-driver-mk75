/**
 * Request/ack engine for the wireless protocol, modelled on the vendor SendData/ReadData:
 *  - writes: 14-byte chunks, 15 ms before each packet (10 ms for live 0x88/0x8E), wait for an ack
 *    with the same cmd (1.5 s), retry each packet up to 5x on busy/timeout; no ack for 0x88/0x8E/0x06.
 *  - reads: one request packet, then collect `total` reply packets (1 s each), 3 attempts.
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

export class LinkError extends Error {}

export class WirelessLink {
  private queue: Promise<unknown> = Promise.resolve();
  private waiters: ((p: Packet) => boolean)[] = [];
  private unsub: () => void;

  constructor(
    readonly io: ReportIO,
    readonly reportId: number,
    private log?: (dir: 'out' | 'in', body: Uint8Array) => void,
    private timing = { pace: 15, livePace: 10, ackMs: 1500, readMs: 1000 },
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

  /** Collect every reply packet for `cmd` (buffered, so none are lost) until `total` arrived. */
  private collect(cmd: number, ms: number): Promise<Packet[]> {
    return new Promise((resolve, reject) => {
      const got = new Map<number, Packet>();
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
        got.set(p.index, p);
        clearTimeout(timer);
        if (got.size >= Math.max(1, p.total)) {
          resolve([...got.values()].sort((a, b) => a.index - b.index));
          return true;
        }
        timer = setTimeout(fail, ms); // per-packet timeout, like the vendor
        return false;
      };
      this.waiters.push(h);
    });
  }

  /** `min`: fewest bytes that count as a whole reply (2.4 GHz receivers never send the last bytes of some blocks). */
  read(cmd: number, sub: number, len: number, min = len) {
    return this.exclusive(async () => {
      let lastErr: unknown;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const replies = this.collect(cmd, this.timing.readMs);
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
          if (len > PKT_DATA && filled < min) throw new LinkError(`short reply for 0x${cmd.toString(16)}: ${filled} of ${len} bytes`);
          return out;
        } catch (e) {
          lastErr = e;
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
