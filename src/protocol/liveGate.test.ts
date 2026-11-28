import { describe, expect, it } from 'vitest';
import { MK75_KEYS } from '../device/mk75Layout';
import { G5_FRAME_LEN, Mk75G5Wired } from './g5Wired';
import { LIVE_KEEPALIVE_MS, LiveGate } from './liveGate';
import { Mk75, STREAM_LEN } from './mk75';
import { MockMk75 } from './mock';
import type { FeatureTransport } from './transport';
import { WirelessLink } from './wireless/link';
import { MockWirelessIO } from './wireless/mockWireless';
import { Mk75Wireless } from './wireless/mk75Wireless';

/** A clock the test moves by hand. */
const clock = () => {
  let t = 1000;
  return { now: () => t, advance: (ms: number) => (t += ms) };
};

const frame = (fill: number) => new Uint8Array(STREAM_LEN).fill(fill);

describe('LiveGate', () => {
  it('sends the first frame, skips repeats, and sends again once the keep-alive is due', () => {
    const c = clock();
    const g = new LiveGate(LIVE_KEEPALIVE_MS, c.now);
    const f = frame(1);
    expect(g.shouldSend(f)).toBe(true);
    g.sent(f);
    expect(g.shouldSend(frame(1))).toBe(false);
    c.advance(LIVE_KEEPALIVE_MS - 1);
    expect(g.shouldSend(frame(1))).toBe(false);
    c.advance(1);
    expect(g.shouldSend(frame(1))).toBe(true);
  });

  it('always sends a changed frame, including one of a different length', () => {
    const g = new LiveGate(LIVE_KEEPALIVE_MS, clock().now);
    g.sent(frame(1));
    const changed = frame(1);
    changed[STREAM_LEN - 1] = 2;
    expect(g.shouldSend(changed)).toBe(true);
    expect(g.shouldSend(new Uint8Array(10).fill(1))).toBe(true);
  });

  it('a frame that was never confirmed as sent is not skipped', () => {
    const g = new LiveGate(LIVE_KEEPALIVE_MS, clock().now);
    expect(g.shouldSend(frame(1))).toBe(true);
    expect(g.shouldSend(frame(1))).toBe(true); // a failed write never calls sent()
  });

  it('reset() forces the next frame out', () => {
    const g = new LiveGate(LIVE_KEEPALIVE_MS, clock().now);
    g.sent(frame(1));
    g.reset();
    expect(g.shouldSend(frame(1))).toBe(true);
  });

  it('keeps its own copy, so a reused caller buffer cannot fool it', () => {
    const g = new LiveGate(LIVE_KEEPALIVE_MS, clock().now);
    const buf = frame(1);
    g.sent(buf);
    buf.fill(2);
    expect(g.shouldSend(buf)).toBe(true);
  });
});

describe('devices skip unchanged live frames', () => {
  it('cable (CDev916KB): one report for repeats, again after the keep-alive and after a config write', async () => {
    const mock = new MockMk75();
    const dev = new Mk75(mock, { readDelayMs: 0, writeDelayMs: 0 });
    const c = clock();
    dev.liveGate.now = c.now;
    expect(await dev.sendLiveFrame(frame(5))).toBe(true);
    for (let i = 0; i < 9; i++) expect(await dev.sendLiveFrame(frame(5))).toBe(false);
    expect(mock.liveFrames).toBe(1);
    expect(await dev.sendLiveFrame(frame(6))).toBe(true);
    expect(mock.liveFrames).toBe(2);
    c.advance(LIVE_KEEPALIVE_MS);
    expect(await dev.sendLiveFrame(frame(6))).toBe(true);
    // Stopping restores the saved effect with a profile write: the same frame must show again on the next start.
    await dev.writeProfile(await dev.readProfile());
    expect(await dev.sendLiveFrame(frame(6))).toBe(true);
    expect(mock.liveFrames).toBe(4);
  });

  it('2.4 GHz: gates on the encoded groups, and resets after a config write', async () => {
    const io = new MockWirelessIO();
    const dev = new Mk75Wireless(new WirelessLink(io, 0x15, undefined, { pace: 0, livePace: 0, ackMs: 300, readMs: 300 }), 'combo');
    dev.setLiveLeds(MK75_KEYS.map((k) => k.index));
    dev.liveGate.now = clock().now;
    const rgb = new Uint8Array(STREAM_LEN);
    for (const k of MK75_KEYS) rgb.set([k.index * 2, 255 - k.index, (k.index * 7) % 256], 3 * k.index);
    expect(await dev.sendLiveFrame(rgb)).toBe(true);
    // A raw frame that differs only at an LED index with no key encodes to the same groups, so it isn't sent.
    const keyed = new Set(MK75_KEYS.map((k) => k.index));
    const spare = [...Array(126).keys()].find((i) => !keyed.has(i))!;
    const other = rgb.slice();
    other.set([255, 255, 255], 3 * spare);
    expect(await dev.sendLiveFrame(other)).toBe(false);
    expect(await dev.sendLiveFrame(rgb)).toBe(false);
    expect(io.liveFrames).toBe(1);
    await dev.writeLedMatrix(new Uint8Array(0x762));
    expect(await dev.sendLiveFrame(rgb)).toBe(true);
  });

  it('IC2481 cable: repeats are skipped and a per-key write resets the gate', async () => {
    const live: Uint8Array[] = [];
    const t: FeatureTransport = {
      name: 'Counting IC2481',
      featureSize: (id: number) => (id === 0x06 ? G5_FRAME_LEN : undefined),
      async sendFeature(_id: number, data: Uint8Array) {
        if (data[0] === 0x08) live.push(data.slice());
      },
      async receiveFeature() {
        return new Uint8Array(G5_FRAME_LEN);
      },
      async close() {},
    };
    const dev = new Mk75G5Wired(t);
    dev.liveGate.now = clock().now;
    expect(await dev.sendLiveFrame(frame(3))).toBe(true);
    expect(await dev.sendLiveFrame(frame(3))).toBe(false);
    expect(live.length).toBe(1);
    await dev.writeLedMatrix(new Uint8Array(0x762));
    expect(await dev.sendLiveFrame(frame(3))).toBe(true);
    expect(live.length).toBe(2);
  });
});
