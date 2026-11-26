import { describe, expect, it, vi } from 'vitest';
import { G5WiredLink } from './g5Wired';
import type { FeatureTransport } from './transport';

function fake(replies: Uint8Array[]): FeatureTransport {
  let reads = 0;
  return { name: 'test', featureSize: () => 519, async sendFeature() {}, async receiveFeature() { return replies[Math.min(reads++, replies.length - 1)]; }, async close() {} };
}
describe('G5 write ordering', () => {
  it('holds a queued read until 130ms after a profile write', async () => {
    vi.useFakeTimers();
    try {
      const events: { cmd: number; at: number }[] = [];
      let response = Uint8Array.of(0x84, 0, 0, 1, 0, 1, 0, 0xab);
      const t: FeatureTransport = { name: 'test', featureSize: () => 519,
        async sendFeature(_id, b) { events.push({ cmd: b[0], at: Date.now() }); },
        async receiveFeature() { return response; }, async close() {} };
      const link = new G5WiredLink(t, undefined, 20);
      const result = Promise.all([link.write(4, 0, new Uint8Array(128)), link.read(0x84, 0, 1)]);
      await vi.runAllTimersAsync();
      await result;
      expect(events.map(e => e.cmd)).toEqual([4, 0x84]);
      expect(events[1].at - events[0].at).toBeGreaterThanOrEqual(130);
    } finally { vi.useRealTimers(); }
  });
});
describe('G5 complete read payload', () => {
  it('rejects repeated truncated matrix echoes instead of returning zero-filled data', async () => {
    const link = new G5WiredLink(fake([Uint8Array.of(0x83, 0, 0, 1, 0, 0, 2)]), undefined, 0);
    await expect(link.read(0x83, 0, 512)).rejects.toThrow('complete payload');
  });
  it('retries a truncated reply and accepts a complete one', async () => {
    const short = Uint8Array.of(0x82, 1, 0, 1, 0, 2, 0, 0x12);
    const complete = Uint8Array.of(0x82, 1, 0, 1, 0, 2, 0, 0x12, 0x34);
    const result = await new G5WiredLink(fake([short, complete]), undefined, 0).read(0x82, 1, 2);
    expect([...result]).toEqual([0x12, 0x34]);
  });
  it('accepts a short Linux response with its report ID and complete payload', async () => {
    const reply = Uint8Array.of(0x06, 0x82, 1, 0, 1, 0, 2, 0, 0x12, 0x34);
    const result = await new G5WiredLink(fake([reply]), undefined, 0).read(0x82, 1, 2);
    expect([...result]).toEqual([0x12, 0x34]);
  });
  it('does not accept a report ID followed by an unrelated command', async () => {
    const reply = Uint8Array.of(0x06, 0x84, 1, 0, 1, 0, 2, 0, 0x12, 0x34);
    await expect(new G5WiredLink(fake([reply]), undefined, 0).read(0x82, 1, 2)).rejects.toThrow();
  });
  it('accepts a short response with the complete payload', async () => {
    const reply = Uint8Array.of(0x82, 1, 0, 1, 0, 2, 0, 0x12, 0x34);
    const result = await new G5WiredLink(fake([reply]), undefined, 0).read(0x82, 1, 2);
    expect([...result]).toEqual([0x12, 0x34]);
  });
});
