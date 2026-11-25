/**
 * In-memory AU75 simulator implementing the same feature-report protocol.
 * Lets you try the UI without hardware and backs the unit tests.
 */
import { AU75_KEYS } from '../device/au75Layout';
import { DATA_FRAME_LEN, DATA_HEADER_LEN, PAGE_LEN, PROFILE_LEN, REPORT_CMD, REPORT_DATA } from './au75';
import { encodeAction } from './keycodes';
import { LED_MATRIX_LEN, LED_MODES, RGB_TABLE_STRIDE } from './lighting';
import type { FeatureTransport } from './transport';

const VK_TO_HID: Record<number, number> = {
  0x1b: 0x29, 0x08: 0x2a, 0x09: 0x2b, 0x0d: 0x28, 0x14: 0x39, 0x20: 0x2c,
  0xc0: 0x35, 0xbd: 0x2d, 0xbb: 0x2e, 0xdb: 0x2f, 0xdd: 0x30, 0xdc: 0x31, 0xba: 0x33, 0xde: 0x34,
  0xbc: 0x36, 0xbe: 0x37, 0xbf: 0x38, 0x2e: 0x4c, 0x2d: 0x49, 0x24: 0x4a, 0x23: 0x4d, 0x21: 0x4b, 0x22: 0x4e,
  0x27: 0x4f, 0x25: 0x50, 0x28: 0x51, 0x26: 0x52,
  0xa2: 0xe0, 0xa0: 0xe1, 0xa4: 0xe2, 0x5b: 0xe3, 0xa3: 0xe4, 0xa1: 0xe5, 0xa5: 0xe6,
};
export function vkToHid(vk: number): number | undefined {
  if (vk >= 0x41 && vk <= 0x5a) return 0x04 + (vk - 0x41);
  if (vk >= 0x31 && vk <= 0x39) return 0x1e + (vk - 0x31);
  if (vk === 0x30) return 0x27;
  if (vk >= 0x70 && vk <= 0x7b) return 0x3a + (vk - 0x70);
  return VK_TO_HID[vk];
}

export class MockAu75 implements FeatureTransport {
  readonly name = 'Simulated MK75';
  profile = new Uint8Array(PROFILE_LEN);
  matrix = new Uint8Array(PAGE_LEN);
  rgbTable = new Uint8Array(PAGE_LEN);
  ledMatrix = new Uint8Array(LED_MATRIX_LEN + 0x400);
  writes: { op: number; sub: number; flag: number; payload: Uint8Array }[] = [];
  private pending: Uint8Array | null = null;

  constructor() {
    // Plausible factory defaults: Fixed on, full brightness, red.
    this.profile[0x05] = 1;
    this.profile[0x14] = this.profile[0x15] = 0xff;
    LED_MODES.forEach((_, i) => {
      if (i < 17) {
        this.profile[0x16 + 2 * i] = 0;
        this.profile[0x17 + 2 * i] = (2 << 4) | 4;
      }
    });
    const pal = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0], [0, 255, 255], [255, 0, 255], [255, 255, 255]];
    LED_MODES.forEach((_, i) => pal.forEach((c, k) => this.rgbTable.set(c, RGB_TABLE_STRIDE * (i + 1) + 3 * k)));
    const v = new DataView(this.matrix.buffer);
    for (const k of AU75_KEYS) {
      const hid = vkToHid(k.vk);
      if (hid !== undefined) v.setUint32(k.index * 4, encodeAction({ kind: 'key', usage: hid, mods: 0 }), true);
    }
    // Model an Fn-slot redirect on CapsLock (index 3) to exercise that code path.
    const caps = v.getUint32(3 * 4, true);
    v.setUint32(3 * 4, 0x00000002, true); // redirect -> slot 132 + 0
    v.setUint32(0x84 * 4, caps, true);
  }

  featureSize(reportId: number) {
    return reportId === REPORT_CMD ? 6 : reportId === REPORT_DATA ? DATA_FRAME_LEN : undefined;
  }

  async sendFeature(reportId: number, data: Uint8Array) {
    await new Promise((r) => setTimeout(r, 2));
    if (reportId === REPORT_CMD) {
      const [op, sub] = data;
      const reply = new Uint8Array(DATA_FRAME_LEN);
      reply[0] = op;
      reply[1] = sub;
      const src =
        op === 0x83 && sub === 0xb6 ? this.profile : op === 0x84 && sub === 0xd4 ? this.matrix : op === 0x88 && sub === 0xb8 ? this.rgbTable : null;
      if (!src) {
        reply[0] = 0; // unknown command: no echo
      } else reply.set(src, DATA_HEADER_LEN);
      this.pending = reply;
      return;
    }
    if (reportId === REPORT_DATA) {
      const [op, sub, , flag] = data;
      const payload = data.slice(DATA_HEADER_LEN);
      this.writes.push({ op, sub, flag, payload });
      if (op === 0x03 && sub === 0xb6) this.profile = payload.slice(0, PROFILE_LEN);
      else if (op === 0x04 && sub === 0xd4) this.matrix = payload.slice(0, PAGE_LEN);
      else if (op === 0x08 && sub === 0xb8) this.rgbTable = payload.slice(0, PAGE_LEN);
      else if (op === 0x09 && (sub === 0xbc || sub === 0xc0)) this.ledMatrix.set(payload.slice(0, PAGE_LEN), sub === 0xbc ? 0 : PAGE_LEN);
      return;
    }
    throw new Error(`mock: unexpected report ${reportId}`);
  }

  async receiveFeature(reportId: number) {
    await new Promise((r) => setTimeout(r, 2));
    if (reportId !== REPORT_DATA || !this.pending) return new Uint8Array(DATA_FRAME_LEN);
    const r = this.pending;
    this.pending = null;
    return r;
  }

  async close() {}
}
