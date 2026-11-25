import { describe, expect, it } from 'vitest';
import { MK75_KEYS } from '../../device/mk75Layout';
import { encodeAction, getKeyCode, setKeyCode } from '../keycodes';
import { parseProfile, patchProfile, parseRgbTable, patchRgbTable } from '../lighting';
import { wiredToWireless, wirelessToWired } from './codes';
import { WirelessLink } from './link';
import { MockWirelessIO } from './mockWireless';
import { Mk75Wireless } from './mk75Wireless';
import { buildPacket, chunk } from './packet';

const hx = (id: number, b: Uint8Array) => [id, ...b].map((x) => x.toString(16).padStart(2, '0')).join(' ');
const fast = { pace: 0, livePace: 0, ackMs: 300, readMs: 300 };

// Expected bytes = requests captured by emulating the vendor CDevComboFilm/CDev3632 send routines.
describe('wireless packets match vendor', () => {
  it('read LED profile request', () => {
    expect(hx(0x15, buildPacket(0x15, 0x44, 1, 0, 0, new Uint8Array(0)))).toBe('15 44 01 00 00 ' + '00 '.repeat(14) + '5a');
  });
  it('online query / matrix layer 1 / reset', () => {
    expect(hx(0x15, buildPacket(0x15, 0x07, 1, 0, 0, new Uint8Array(0))).endsWith('1d')).toBe(true);
    const l1 = buildPacket(0x15, 0x41, 1, 0, 1, new Uint8Array(0));
    expect(hx(0x15, l1).slice(0, 14)).toBe('15 41 01 00 10');
    expect(l1[18]).toBe(0x67);
    expect(buildPacket(0x13, 0x06, 1, 0, 1, new Uint8Array(0))[18]).toBe(0x2a);
  });
  it('on-board write carries data length', () => {
    const p = buildPacket(0x15, 0x0a, 1, 0, 0, Uint8Array.of(3));
    expect(hx(0x15, p).slice(0, 17)).toBe('15 0a 01 00 01 03');
    expect(p[18]).toBe(0x24);
  });
  it('LED write = 10 packets, palette 0x200 = 37 packets, per-key = 27', () => {
    expect(chunk(0x15, 0x04, 0, new Uint8Array(128))).toHaveLength(10);
    expect(chunk(0x15, 0x09, 0, new Uint8Array(0x200))).toHaveLength(37);
    expect(chunk(0x15, 0x02, 0, new Uint8Array(0x17a))).toHaveLength(27);
    expect(chunk(0x15, 0x01, 2, new Uint8Array(512))[0][3]).toBe(0x2e); // layer 2, 14 bytes
  });
});

// Expected = vendor G5KB encoder outputs (emulated) vs wired 916KB encoder outputs.
describe('wired ↔ wireless key codes', () => {
  const pairs: [number, number][] = [
    [0x04000000, 0x04000000], // A
    [0x06010000, 0x06000100], // Ctrl+C
    [0xe0000006, 0x00000100], // LCtrl alone
    [0xcd000004, 0xcd000002], // Play/Pause
    [0x8a010004, 0x8a010002], // Mail
    [0xf0000007, 0x00010101], // left
    [0xf1000007, 0x00010201], // middle
    [0xf2000007, 0x00010301], // right
    [0xf3000007, 0x00010501], // forward
    [0xf4000007, 0x00010401], // back
    [0, 0],
  ];
  it.each(pairs)('%s ↔ %s', (wired, wl) => {
    expect(wiredToWireless(wired)).toBe(wl >>> 0);
    expect(wirelessToWired(wl)).toBe(wired >>> 0);
  });
  it('vendor preset form (key in byte 2) decodes too', () => {
    expect(wirelessToWired(0x001d0100)).toBe(0x1d010000); // Ctrl+Z preset
    expect(wiredToWireless(0x1d010000)).toBe(0x1d000100); // re-encoded in the user-combo form
  });
  it('firmware-only codes pass through as null', () => {
    expect(wirelessToWired(0x14000007)).toBeNull(); // knob function
  });
});

describe('Mk75Wireless adapter against the simulator', () => {
  const make = () => {
    const io = new MockWirelessIO();
    const dev = new Mk75Wireless(new WirelessLink(io, 0x15, undefined, fast), 'combo');
    dev.setLiveLeds(MK75_KEYS.map((k) => k.index));
    return { io, dev };
  };

  it('online + profile round trip in layout B', async () => {
    const { io, dev } = make();
    expect(await dev.online()).toBe(true);
    const p = await dev.readProfile();
    const st = parseProfile(p);
    expect(st.activeIndex).toBe(0);
    expect(p[0x11]).toBe(4);
    st.activeIndex = 1; // Respire hw 2
    st.perMode[1] = { speed: 3, brightness: 1, colorful: true, colorIndex: 0 };
    await dev.writeProfile(patchProfile(p, st));
    expect(io.led[0x0a]).toBe(2);
    expect(io.led[0x3a + 2]).toBe(1);
    expect(io.led[0x3b + 2]).toBe(0x37);
    expect([io.led[0x7e], io.led[0x7f]]).toEqual([0x5a, 0xa5]);
    expect(io.led[0x18]).toBe(4); // untouched sleep preserved
  });

  it('sleep off / on', async () => {
    const { io, dev } = make();
    const p = await dev.readProfile();
    p[0x11] = 0xff;
    await dev.writeProfile(p);
    expect([io.led[0x16], io.led[0x18]]).toEqual([0, 0]);
    const q = await dev.readProfile();
    q[0x11] = 20;
    await dev.writeProfile(q);
    expect([io.led[0x16], io.led[0x18]]).toEqual([1, 20]);
  });

  it('key remap converts to wireless encoding and keeps the trailer', async () => {
    const { io, dev } = make();
    const m = await dev.readKeyMatrix();
    expect(getKeyCode(m, 0)).toBe(0x29000000); // Esc in wired view
    await dev.writeKeyMatrix(setKeyCode(m, 3, encodeAction({ kind: 'key', usage: 0x06, mods: 0x01 })));
    const v = new DataView(io.layers[0].buffer);
    expect(v.getUint32(3 * 4, true)).toBe(0x06000100);
    expect(v.getUint32(508, true)).toBe(0xa55a0000);
    expect(v.getUint32(0, true)).toBe(0x29000000); // other keys untouched
  });

  it('macros are refused over wireless', async () => {
    const { dev } = make();
    await expect(dev.writeMacroPages()).rejects.toThrow(/USB cable/);
    expect(dev.caps.macros).toBe(false);
  });

  it('palette keeps wired offsets and gets the 5A A5 signature', async () => {
    const { io, dev } = make();
    const t = await dev.readRgbTable();
    const pal = parseRgbTable(t);
    expect(pal[0][0]).toEqual([255, 0, 0]);
    pal[0][0] = [1, 2, 3];
    await dev.writeRgbTable(patchRgbTable(t, pal));
    expect([...io.palette.slice(0x15, 0x18)]).toEqual([1, 2, 3]);
    expect([io.palette[0x1fa], io.palette[0x1fb]]).toEqual([0x5a, 0xa5]);
  });

  it('live frames are colour groups within 200 bytes', async () => {
    const { io, dev } = make();
    const rgb = new Uint8Array(378);
    for (const k of MK75_KEYS) rgb.set([k.index * 2, 255 - k.index, (k.index * 7) % 256], 3 * k.index);
    await dev.sendLiveFrame(rgb);
    expect(io.live!.length).toBeLessThanOrEqual(200);
    // every key appears exactly once across the groups
    const seen: number[] = [];
    for (let p = 0; p < io.live!.length; ) {
      const n = io.live![p + 3];
      seen.push(...io.live!.slice(p + 4, p + 4 + n));
      p += 4 + n;
    }
    expect(seen.sort((a, b) => a - b)).toEqual(MK75_KEYS.map((k) => k.index).sort((a, b) => a - b));
  });
});
