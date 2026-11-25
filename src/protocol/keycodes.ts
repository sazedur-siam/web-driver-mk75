/**
 * Key-matrix hardware codes, decoded from keyinfo_to_hardware_code (OemDrv.exe 0x48BAC0)
 * and FillMatrix (0x48C3C0).
 *
 * The 1024-byte key matrix (op 0x84/0x04 sub 0xD4) holds little-endian u32 slots:
 *   slots 0..131   base layer, indexed by the key's hardware matrix index (KB.ini last column)
 *   slots 132..    Fn single-key / Fn-combo slots
 * If a base slot's low byte is 0x02 it is a redirect: the key's real function lives in slot
 * 132 + (signed) byte3. The vendor writes through that redirect, and so do we.
 *
 * u32 code layout (byte0 = low byte = type):
 *   0x00  keyboard key     byte2 = modifier mask, byte3 = HID usage      e.g. Alt+F4 = 0x3D040000
 *   0x04  consumer usage   byte2 = usage low, byte3 = usage high         e.g. Play  = 0xCD000004
 *   0x06  modifier alone   byte3 = 0xE0..0xE6                            e.g. LCtrl = 0xE0000006
 *   0x07  mouse button     byte3 = 0xF0..0xF4                            e.g. Left  = 0xF0000007
 *   0x10  macro            byte2 = repeat mode, byte3 = macro slot
 *   0x02  Fn-slot redirect (see above)
 *   0x00000000            disabled
 */

export const MATRIX_SLOTS = 0x84; // 132 base-layer slots
export const SLOT_BYTES = 4;

export const MOD = { LCtrl: 0x01, LShift: 0x02, LAlt: 0x04, LGui: 0x08, RCtrl: 0x10, RShift: 0x20, RAlt: 0x40, RGui: 0x80 } as const;

export type KeyAction =
  | { kind: 'disabled' }
  | { kind: 'key'; usage: number; mods: number }
  | { kind: 'consumer'; usage: number }
  | { kind: 'modifier'; usage: number }
  | { kind: 'mouse'; button: number }
  | { kind: 'macro'; slot: number; mode: number }
  | { kind: 'raw'; code: number };

export function encodeAction(a: KeyAction): number {
  switch (a.kind) {
    case 'disabled':
      return 0;
    case 'key':
      return (((a.usage & 0xff) << 24) | ((a.mods & 0xff) << 16)) >>> 0;
    case 'consumer':
      return (((a.usage & 0xff) << 24) | (((a.usage >> 8) & 0xff) << 16) | 0x04) >>> 0;
    case 'modifier':
      return (((a.usage & 0xff) << 24) | 0x06) >>> 0;
    case 'mouse':
      return (((0xf0 + a.button) << 24) | 0x07) >>> 0;
    case 'macro':
      return (((a.slot & 0xff) << 24) | ((a.mode & 0xff) << 16) | 0x10) >>> 0;
    case 'raw':
      return a.code >>> 0;
  }
}

export function decodeAction(code: number): KeyAction {
  code >>>= 0;
  if (code === 0) return { kind: 'disabled' };
  const t = code & 0xff;
  const b2 = (code >>> 16) & 0xff;
  const b3 = (code >>> 24) & 0xff;
  if (t === 0x00 && (code & 0xff00) === 0) return { kind: 'key', usage: b3, mods: b2 };
  if (t === 0x04 && (code & 0xff00) === 0) return { kind: 'consumer', usage: (b2 << 8) | b3 };
  if (t === 0x06 && b3 >= 0xe0 && b3 <= 0xe7) return { kind: 'modifier', usage: b3 };
  if (t === 0x07 && b3 >= 0xf0 && b3 <= 0xf4) return { kind: 'mouse', button: b3 - 0xf0 };
  if (t === 0x10) return { kind: 'macro', slot: b3, mode: b2 };
  return { kind: 'raw', code };
}

/** Resolve which matrix slot really holds the function for a key (following Fn redirects). */
export function resolveSlot(matrix: Uint8Array, index: number): number {
  const v = new DataView(matrix.buffer, matrix.byteOffset, matrix.byteLength);
  const code = v.getUint32(index * SLOT_BYTES, true);
  if ((code & 0xff) === 0x02) {
    const slot = MATRIX_SLOTS + ((code >>> 24) << 24 >> 24); // signed byte3
    if (slot >= MATRIX_SLOTS && (slot + 1) * SLOT_BYTES <= matrix.length) return slot;
  }
  return index;
}

export function getKeyCode(matrix: Uint8Array, index: number): number {
  const v = new DataView(matrix.buffer, matrix.byteOffset, matrix.byteLength);
  return v.getUint32(resolveSlot(matrix, index) * SLOT_BYTES, true);
}

export function setKeyCode(matrix: Uint8Array, index: number, code: number): Uint8Array {
  const out = new Uint8Array(matrix);
  const v = new DataView(out.buffer);
  v.setUint32(resolveSlot(out, index) * SLOT_BYTES, code >>> 0, true);
  return out;
}

// ---------------------------------------------------------------------------------------------
// HID keyboard usages (USB HID Usage Tables, page 0x07), keyed by KeyboardEvent.code.
export const HID_KEYS: { code: string; usage: number; label: string }[] = [
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((c, i) => ({ code: `Key${c}`, usage: 0x04 + i, label: c })),
  ...'1234567890'.split('').map((c, i) => ({ code: `Digit${c}`, usage: 0x1e + i, label: c })),
  { code: 'Enter', usage: 0x28, label: 'Enter' },
  { code: 'Escape', usage: 0x29, label: 'Esc' },
  { code: 'Backspace', usage: 0x2a, label: 'Backspace' },
  { code: 'Tab', usage: 0x2b, label: 'Tab' },
  { code: 'Space', usage: 0x2c, label: 'Space' },
  { code: 'Minus', usage: 0x2d, label: '-' },
  { code: 'Equal', usage: 0x2e, label: '=' },
  { code: 'BracketLeft', usage: 0x2f, label: '[' },
  { code: 'BracketRight', usage: 0x30, label: ']' },
  { code: 'Backslash', usage: 0x31, label: '\\' },
  { code: 'Semicolon', usage: 0x33, label: ';' },
  { code: 'Quote', usage: 0x34, label: "'" },
  { code: 'Backquote', usage: 0x35, label: '`' },
  { code: 'Comma', usage: 0x36, label: ',' },
  { code: 'Period', usage: 0x37, label: '.' },
  { code: 'Slash', usage: 0x38, label: '/' },
  { code: 'CapsLock', usage: 0x39, label: 'Caps Lock' },
  ...Array.from({ length: 12 }, (_, i) => ({ code: `F${i + 1}`, usage: 0x3a + i, label: `F${i + 1}` })),
  { code: 'PrintScreen', usage: 0x46, label: 'Print Screen' },
  { code: 'ScrollLock', usage: 0x47, label: 'Scroll Lock' },
  { code: 'Pause', usage: 0x48, label: 'Pause' },
  { code: 'Insert', usage: 0x49, label: 'Insert' },
  { code: 'Home', usage: 0x4a, label: 'Home' },
  { code: 'PageUp', usage: 0x4b, label: 'Page Up' },
  { code: 'Delete', usage: 0x4c, label: 'Delete' },
  { code: 'End', usage: 0x4d, label: 'End' },
  { code: 'PageDown', usage: 0x4e, label: 'Page Down' },
  { code: 'ArrowRight', usage: 0x4f, label: 'Right' },
  { code: 'ArrowLeft', usage: 0x50, label: 'Left' },
  { code: 'ArrowDown', usage: 0x51, label: 'Down' },
  { code: 'ArrowUp', usage: 0x52, label: 'Up' },
  { code: 'NumLock', usage: 0x53, label: 'Num Lock' },
  { code: 'NumpadDivide', usage: 0x54, label: 'Num /' },
  { code: 'NumpadMultiply', usage: 0x55, label: 'Num *' },
  { code: 'NumpadSubtract', usage: 0x56, label: 'Num -' },
  { code: 'NumpadAdd', usage: 0x57, label: 'Num +' },
  { code: 'NumpadEnter', usage: 0x58, label: 'Num Enter' },
  ...'1234567890'.split('').map((c, i) => ({ code: `Numpad${c}`, usage: 0x59 + i, label: `Num ${c}` })),
  { code: 'NumpadDecimal', usage: 0x63, label: 'Num .' },
  { code: 'IntlBackslash', usage: 0x64, label: 'ISO \\' },
  { code: 'ContextMenu', usage: 0x65, label: 'Menu' },
  ...Array.from({ length: 12 }, (_, i) => ({ code: `F${i + 13}`, usage: 0x68 + i, label: `F${i + 13}` })),
];

export const HID_MODIFIERS: { code: string; usage: number; bit: number; label: string }[] = [
  { code: 'ControlLeft', usage: 0xe0, bit: MOD.LCtrl, label: 'Left Ctrl' },
  { code: 'ShiftLeft', usage: 0xe1, bit: MOD.LShift, label: 'Left Shift' },
  { code: 'AltLeft', usage: 0xe2, bit: MOD.LAlt, label: 'Left Alt' },
  { code: 'MetaLeft', usage: 0xe3, bit: MOD.LGui, label: 'Left Win' },
  { code: 'ControlRight', usage: 0xe4, bit: MOD.RCtrl, label: 'Right Ctrl' },
  { code: 'ShiftRight', usage: 0xe5, bit: MOD.RShift, label: 'Right Shift' },
  { code: 'AltRight', usage: 0xe6, bit: MOD.RAlt, label: 'Right Alt' },
  { code: 'MetaRight', usage: 0xe7, bit: MOD.RGui, label: 'Right Win' },
];

/** Consumer-page usages the vendor driver offers (values taken from its jump tables). */
export const CONSUMER_KEYS: { usage: number; label: string }[] = [
  { usage: 0x00cd, label: 'Play / Pause' },
  { usage: 0x00b7, label: 'Stop' },
  { usage: 0x00b6, label: 'Previous track' },
  { usage: 0x00b5, label: 'Next track' },
  { usage: 0x00e9, label: 'Volume +' },
  { usage: 0x00ea, label: 'Volume -' },
  { usage: 0x00e2, label: 'Mute' },
  { usage: 0x006f, label: 'Screen brightness +' },
  { usage: 0x0070, label: 'Screen brightness -' },
  { usage: 0x018a, label: 'Email' },
  { usage: 0x0223, label: 'Browser home' },
  { usage: 0x0194, label: 'My computer' },
  { usage: 0x0192, label: 'Calculator' },
  { usage: 0x022a, label: 'Favorites' },
  { usage: 0x0221, label: 'Search' },
  { usage: 0x0224, label: 'Browser back' },
  { usage: 0x0225, label: 'Browser forward' },
  { usage: 0x0226, label: 'Browser stop' },
  { usage: 0x0227, label: 'Browser refresh' },
  { usage: 0x0183, label: 'Media player' },
];

/**
 * Firmware mouse codes F0..F4 (button index 0..4). Order confirmed by emulating the vendor encoders:
 * wired keyinfo maps left/right/middle/forward/back → F0/F2/F1/F3/F4, and the wireless encoder agrees
 * (left 1, middle 2, right 3, back 4, forward 5).
 */
export const MOUSE_BUTTONS = ['Left click', 'Middle click', 'Right click', 'Forward', 'Back'];

/** Shortcut presets the vendor exposes as "Commands" (exact codes from its table). */
export const SHORTCUTS: { label: string; usage: number; mods: number }[] = [
  { label: 'Close window (Alt+F4)', usage: 0x3d, mods: MOD.LAlt },
  { label: 'Lock computer (Win+L)', usage: 0x0f, mods: MOD.LGui },
  { label: 'Run (Win+R)', usage: 0x15, mods: MOD.LGui },
  { label: 'Show desktop (Win+D)', usage: 0x07, mods: MOD.LGui },
  { label: 'Zoom in (Ctrl+=)', usage: 0x2e, mods: MOD.LCtrl },
  { label: 'Zoom out (Ctrl+-)', usage: 0x2d, mods: MOD.LCtrl },
  { label: 'Task manager (Ctrl+Alt+Del)', usage: 0x4c, mods: MOD.LCtrl | MOD.LAlt },
  { label: 'Undo (Ctrl+Z)', usage: 0x1d, mods: MOD.LCtrl },
  { label: 'Save (Ctrl+S)', usage: 0x16, mods: MOD.LCtrl },
];

const usageLabel = new Map(HID_KEYS.map((k) => [k.usage, k.label]));
for (const m of HID_MODIFIERS) usageLabel.set(m.usage, m.label);

export function modsLabel(mods: number): string {
  const parts: string[] = [];
  if (mods & (MOD.LCtrl | MOD.RCtrl)) parts.push('Ctrl');
  if (mods & (MOD.LShift | MOD.RShift)) parts.push('Shift');
  if (mods & (MOD.LAlt | MOD.RAlt)) parts.push('Alt');
  if (mods & (MOD.LGui | MOD.RGui)) parts.push('Win');
  return parts.join('+');
}

export function describeAction(a: KeyAction): string {
  switch (a.kind) {
    case 'disabled':
      return 'Disabled';
    case 'key': {
      const k = usageLabel.get(a.usage) ?? `HID 0x${a.usage.toString(16)}`;
      return a.mods ? `${modsLabel(a.mods)}+${k}` : k;
    }
    case 'consumer':
      return CONSUMER_KEYS.find((c) => c.usage === a.usage)?.label ?? `Consumer 0x${a.usage.toString(16)}`;
    case 'modifier':
      return usageLabel.get(a.usage) ?? `Mod 0x${a.usage.toString(16)}`;
    case 'mouse':
      return MOUSE_BUTTONS[a.button] ?? `Mouse ${a.button}`;
    case 'macro':
      return `Macro #${a.slot + 1}`;
    case 'raw':
      return `0x${a.code.toString(16).padStart(8, '0')}`;
  }
}

/** Map a KeyboardEvent to a KeyAction (used by the "press a key" capture box). */
export function actionFromKeyboardEvent(e: { code: string; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean }): KeyAction | null {
  const mod = HID_MODIFIERS.find((m) => m.code === e.code);
  if (mod) return { kind: 'modifier', usage: mod.usage };
  const key = HID_KEYS.find((k) => k.code === e.code);
  if (!key) return null;
  let mods = 0;
  if (e.ctrlKey) mods |= MOD.LCtrl;
  if (e.shiftKey) mods |= MOD.LShift;
  if (e.altKey) mods |= MOD.LAlt;
  if (e.metaKey) mods |= MOD.LGui;
  return { kind: 'key', usage: key.usage, mods };
}
