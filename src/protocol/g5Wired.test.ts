import { describe, expect, it } from 'vitest';
import { G5_FRAME_LEN, G5WiredLink, Mk75G5Wired } from './g5Wired';
import { setKeyCode } from './keycodes';
import { planMacros } from './macro';
import type { FeatureTransport } from './transport';
import { PALETTE_TAIL } from './wireless/mockWireless';

const hx = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join(' ');

// Factory LED block read from a real 258A:010C (issue #4).
const FACTORY_LED = Uint8Array.from(
  (
    '00 03 03 02 00 00 04 04 07 00 0c 20 01 00 00 00 00 00 00 02 02 03 00 ff 02 00 00 00 00 00 00 00 ' +
    '00 '.repeat(24) +
    'ff ff 04 40 04 47 04 47 04 20 03 20 04 20 03 20 03 20 03 20 03 47 03 47 ' +
    '00 26 01 47 04 47 04 27 04 47 04 47 04 47 04 47 04 47 07 47 07 47 07 44 07 44 07 44 07 44 07 44 ' +
    '07 44 07 44 04 04 04 04 04 04 04 04 04 04 5a a5'
  )
    .trim()
    .split(/\s+/)
    .map((h) => parseInt(h, 16)),
);

/** Fake IC2481 board: one 519-byte feature report 0x06; reads echo the cmd and return the stored block. */
class FakeG5 implements FeatureTransport {
  readonly name = 'Fake IC2481';
  sent: Uint8Array[] = [];
  blocks = new Map<string, Uint8Array>([
    ['4/0', new Uint8Array(FACTORY_LED)],
    ['2/1', Uint8Array.of(0x03, 0, 0, 0, 0, 0xc6)],
    ['7/2', Uint8Array.of(87, 0x10)],
  ]);
  staleReplies = 0;
  private reply = new Uint8Array(G5_FRAME_LEN);

  featureSize(id: number) {
    return id === 0x06 ? G5_FRAME_LEN : undefined;
  }
  async sendFeature(id: number, data: Uint8Array) {
    expect(id).toBe(0x06);
    expect(data.length).toBe(G5_FRAME_LEN);
    this.sent.push(new Uint8Array(data));
    const [cmd, sub] = data;
    const len = data[5] | (data[6] << 8);
    const key = `${cmd & 0x7f}/${sub}`;
    if (cmd & 0x80) {
      this.reply = new Uint8Array(G5_FRAME_LEN);
      this.reply.set(data.subarray(0, 7));
      if (this.staleReplies-- > 0) this.reply[0] = 0x00;
      this.reply.set((this.blocks.get(key) ?? new Uint8Array(len)).subarray(0, len), 7);
    } else {
      this.blocks.set(key, data.slice(7, 7 + len));
    }
  }
  async receiveFeature() {
    return new Uint8Array(this.reply);
  }
  async close() {}
}

describe('CDevG5KB wired frames match OemDrv.exe', () => {
  it('model check reads 82/1, 6 bytes', async () => {
    const t = new FakeG5();
    const dev = new Mk75G5Wired(t);
    expect(hx((await dev.checkModel())!)).toBe('03 00 00 00 00 c6');
    expect(hx(t.sent[0].subarray(0, 8))).toBe('82 01 00 01 00 06 00 00');
  });

  it('battery reads 87/2, 2 bytes: percent and charging flag', async () => {
    const t = new FakeG5();
    const dev = new Mk75G5Wired(t);
    expect(await dev.readBattery()).toEqual({ level: 87, charging: true });
    expect(hx(t.sent[0].subarray(0, 7))).toBe('87 02 00 01 00 02 00');
    t.blocks.set('7/2', Uint8Array.of(100, 0x11));
    expect(await dev.readBattery()).toEqual({ level: 100, charging: false });
  });

  it('LED read, matrix write and live frame headers', async () => {
    const t = new FakeG5();
    const dev = new Mk75G5Wired(t);
    await dev.readProfile();
    expect(hx(t.sent[0].subarray(0, 7))).toBe('84 00 00 01 00 80 00');
    const m = await dev.readKeyMatrix();
    expect(hx(t.sent[1].subarray(0, 7))).toBe('83 00 00 01 00 00 02');
    m[3] = 0x05; // slot 0 → wired key code 0x05000000 (B), so the write isn't skipped
    await dev.writeKeyMatrix(m);
    const w = t.sent[2];
    expect(hx(w.subarray(0, 7))).toBe('03 00 00 01 00 00 02');
    expect(hx(w.subarray(7 + 508, 7 + 512))).toBe('00 00 5a a5'); // layer trailer 0xA55A0000
    await dev.sendLiveFrame(new Uint8Array(378).fill(9));
    const live = t.sent[3];
    expect(hx(live.subarray(0, 8))).toBe('08 00 00 01 00 7a 01 09');
    expect(live[7 + 377]).toBe(9);
    expect(live[7 + 378]).toBe(0);
  });

  it('splits writes over 512 bytes into numbered chunks', async () => {
    const t = new FakeG5();
    await new G5WiredLink(t, undefined, 0).write(0x05, 0, new Uint8Array(600).fill(1));
    expect(t.sent.map((f) => hx(f.subarray(0, 7)))).toEqual(['05 00 00 02 00 00 02', '05 00 00 02 01 58 00']);
  });

  it('retries a read whose reply does not echo the command', async () => {
    const t = new FakeG5();
    t.staleReplies = 1;
    const r = await new G5WiredLink(t, undefined, 0).read(0x84, 0, 0x80);
    expect(hx(r.subarray(0x7e))).toBe('5a a5');
    expect(t.sent.length).toBe(2);
  });
});

describe('Mk75G5Wired macros', () => {
  it('writes the store as one numbered transfer on op 05 and binds the key as 03 mode 01 id', async () => {
    const t = new FakeG5();
    const dev = new Mk75G5Wired(t);
    const big = { id: 'b', name: 'Big', events: Array.from({ length: 140 }, (_, i) => ({ usage: 4, down: i % 2 === 0, delay: 5 })) };
    const plan = planMacros(new Map([[9, { macroId: 'b', mode: 1 as const }]]), [big], 'store');
    expect(plan.pages.map((p) => p.sub)).toEqual([0, 1]); // 4 + 7 + 560 bytes → 2 blocks
    await dev.writeMacroPages(plan.pages);
    // Layers 1 and 3 are read first (OEM macro guard); only the 05 frames are the store write.
    expect(t.sent.filter((f) => f[0] === 0x05).map((f) => hx(f.subarray(0, 7)))).toEqual(['05 00 00 02 00 00 02', '05 00 00 02 01 00 02']);
    const m = await dev.readKeyMatrix();
    await dev.writeKeyMatrix(setKeyCode(m, 9, plan.codes.get(9)!));
    expect(hx(t.blocks.get('3/0')!.subarray(36, 40))).toBe('03 01 01 00');
    await expect(dev.writeMacroPages([{ sub: 8, data: new Uint8Array(512) }])).rejects.toThrow(/Invalid/);
  });
});

describe('Mk75G5Wired profile', () => {
  it('is a wired device with palette colours and the layout-B macro store', () => {
    const dev = new Mk75G5Wired(new FakeG5());
    expect(dev.kind).toBe('wired');
    expect(dev.caps).toEqual({ macros: 'store', paletteIndex: true, battery: true });
    expect(dev.canStream).toBe(true);
  });

  it('keeps palette colour indexes 0..6 both ways', async () => {
    const t = new FakeG5();
    const dev = new Mk75G5Wired(t);
    const p = await dev.readProfile();
    expect(p[0x05]).toBe(0x0c); // active effect
    expect(p[0x16 + 2 * 11]).toBe(6); // raw 0x51 = 0x26: speed 2, colour 6
    expect(p[0x17 + 2 * 11]).toBe(0x20);
    p[0x16 + 2 * 11] = 3;
    await dev.writeProfile(p);
    const raw = t.blocks.get('4/0')!;
    expect(raw[0x51]).toBe(0x23);
    expect(hx(raw.subarray(0x7e))).toBe('5a a5');
    // untouched bytes survive the read-modify-write
    expect(hx(raw.subarray(0, 0x3a))).toBe(hx(FACTORY_LED.subarray(0, 0x3a)));
  });

  it('palette save keeps the identity tail 483..511 (cable reads all 512 bytes)', async () => {
    const t = new FakeG5();
    const pal = new Uint8Array(0x200);
    pal.set(PALETTE_TAIL, 483);
    t.blocks.set('10/0', pal);
    const dev = new Mk75G5Wired(t);
    const table = await dev.readRgbTable();
    table[0x15] = 9;
    await dev.writeRgbTable(table);
    const out = t.blocks.get('10/0')!;
    expect(out[0x15]).toBe(9);
    expect(hx(out.subarray(483))).toBe(hx(PALETTE_TAIL));
  });
});
