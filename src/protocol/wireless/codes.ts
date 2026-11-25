/**
 * Key-code translation between the wired matrix encoding (CDev916KB, see keycodes.ts) and the
 * wireless encoding (CDevG5KB encoder 0x49A4D0, emulated):
 *
 *   wireless u32 LE bytes = [type][mods][x][hid]
 *     key:       hid<<24 | mods<<8            (type 0; vendor presets use hid<<16 | mods<<8)
 *     mod only:  mods<<8                      (type 0, hid 0)
 *     consumer:  lo<<24 | hi<<16 | 0x02       (type 2)
 *     mouse:     clicks<<16 | button<<8 | 0x01  (button 1 left, 2 middle, 3 right, 4 back, 5 forward)
 *
 * Anything else (Fn functions, macros, firmware codes) is passed through unchanged.
 */
const MOD_USAGE = [0xe0, 0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7];
// wired F0..F4 = left, middle, right, forward, back  →  wireless button numbers
const WIRED_TO_WL_BUTTON = [1, 2, 3, 5, 4];

export function wirelessToWired(code: number): number | null {
  code >>>= 0;
  if (code === 0) return 0;
  const type = code & 0xff;
  const b1 = (code >>> 8) & 0xff;
  const b2 = (code >>> 16) & 0xff;
  const b3 = (code >>> 24) & 0xff;
  if (type === 0x00) {
    if (b3 === 0 && b2 === 0 && b1 !== 0 && (b1 & (b1 - 1)) === 0) return ((MOD_USAGE[Math.log2(b1)] << 24) | 0x06) >>> 0;
    if (b3 !== 0 && b2 === 0) return ((b3 << 24) | (b1 << 16)) >>> 0;
    // Vendor "command" presets put the key in byte 2 (e.g. Ctrl+Z = 00 1D 01 00 → 0x001D0100).
    if (b3 === 0 && b2 !== 0) return ((b2 << 24) | (b1 << 16)) >>> 0;
  }
  if (type === 0x02) return ((b3 << 24) | (b2 << 16) | 0x04) >>> 0;
  if (type === 0x01 && b2 === 1 && b3 === 0) {
    const i = WIRED_TO_WL_BUTTON.indexOf(b1);
    if (i >= 0) return (((0xf0 + i) << 24) | 0x07) >>> 0;
  }
  return null; // not representable in the wired view
}

export function wiredToWireless(code: number): number | null {
  code >>>= 0;
  if (code === 0) return 0;
  const type = code & 0xff;
  const b2 = (code >>> 16) & 0xff;
  const b3 = (code >>> 24) & 0xff;
  if (type === 0x00 && (code & 0xff00) === 0) return ((b3 << 24) | (b2 << 8)) >>> 0;
  if (type === 0x04 && (code & 0xff00) === 0) return ((b3 << 24) | (b2 << 16) | 0x02) >>> 0;
  if (type === 0x06 && b3 >= 0xe0 && b3 <= 0xe7) return ((1 << (b3 - 0xe0)) << 8) >>> 0;
  if (type === 0x07 && b3 >= 0xf0 && b3 <= 0xf4) return ((1 << 16) | (WIRED_TO_WL_BUTTON[b3 - 0xf0] << 8) | 0x01) >>> 0;
  return null;
}
