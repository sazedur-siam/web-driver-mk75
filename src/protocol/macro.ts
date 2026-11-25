/**
 * Wired MK75 macro storage, decoded from StMacro_To_HdMacro (OemDrv.exe MK75 build 0x4961B0, emulated)
 * and ApplySetting/FillMatrix.
 *
 *  - 32 macros max, each a fixed 128-byte slot; 8 slots per 1 KiB page.
 *  - Pages written with op 0x05, sub = 0xDC / 0xE0 / 0xE4 / 0xE8 (slots 0-7, 8-15, 16-23, 24-31).
 *    Only ceil(count/8) pages are written. No read-back exists.
 *  - Slot: [0x00, 0x01, events...], zero padded.
 *    event (delay <= 127 ms): [down?0x80:0 | max(delay,3), usage]
 *    event (delay  > 127 ms): [down?0x80:0 | max(delay%100,3), usage, 0x00, 0x03, hi, lo]  (BE count of 100 ms)
 *  - Key-matrix reference: [0x10, 0x00, mode, id-1]; mode 1 = cycle, 2 = until released, 4 = until any key.
 *  - Wired supports keyboard usages, modifiers (0xE0-0xE7) and mouse L/R/M (0xF0/0xF1/0xF2) only.
 */

export const MAX_MACROS = 32;
export const MACRO_SLOT = 128;
export const MACRO_PAGES = [0xdc, 0xe0, 0xe4, 0xe8] as const;
export const MACROS_PER_PAGE = 8;

export interface MacroEvent {
  /** HID usage (keyboard page) or 0xF0/0xF1/0xF2 for mouse left/right/middle. */
  usage: number;
  down: boolean;
  /** Delay in ms after this event. */
  delay: number;
}

export interface Macro {
  id: string;
  name: string;
  events: MacroEvent[];
}

export const RepeatMode = { Once: 1, UntilReleased: 2, UntilAnyKey: 4 } as const;
export type RepeatModeValue = (typeof RepeatMode)[keyof typeof RepeatMode];

export const MOUSE_USAGE = { left: 0xf0, right: 0xf1, middle: 0xf2 } as const;

export function isEncodable(usage: number): boolean {
  return (usage >= 0x04 && usage <= 0xa4) || (usage >= 0xe0 && usage <= 0xe7) || (usage >= 0xf0 && usage <= 0xf2);
}

/** Encode one macro into a 128-byte slot. Returns the slot and how many events fit. */
export function encodeMacroSlot(events: MacroEvent[]): { slot: Uint8Array; encoded: number } {
  const slot = new Uint8Array(MACRO_SLOT);
  slot[0] = 0x00;
  slot[1] = 0x01;
  let p = 2;
  let encoded = 0;
  for (const ev of events) {
    if (!isEncodable(ev.usage)) continue;
    const delay = Math.max(0, Math.round(ev.delay));
    const flag = ev.down ? 0x80 : 0x00;
    if (delay <= 127) {
      if (p >= 0x7e) break;
      slot[p++] = flag | Math.max(delay, 3);
      slot[p++] = ev.usage;
    } else {
      if (p >= 0x7a) break;
      const hundreds = Math.min(0xffff, Math.floor(delay / 100));
      slot[p++] = flag | Math.max(delay % 100, 3);
      slot[p++] = ev.usage;
      slot[p++] = 0x00;
      slot[p++] = 0x03;
      slot[p++] = (hundreds >> 8) & 0xff;
      slot[p++] = hundreds & 0xff;
    }
    encoded++;
  }
  return { slot, encoded };
}

/** Bytes an event list will take (to show capacity in the editor). */
export function macroBytes(events: MacroEvent[]): number {
  return 2 + events.filter((e) => isEncodable(e.usage)).reduce((n, e) => n + (e.delay > 127 ? 6 : 2), 0);
}

export function macroRefCode(id1: number, mode: number): number {
  return ((((id1 - 1) & 0xff) << 24) | ((mode & 0xff) << 16) | 0x10) >>> 0;
}

export interface MacroAssignment {
  macroId: string;
  mode: RepeatModeValue;
}

/**
 * Assign hardware ids like the vendor's FillMatrix: walk keys in matrix order, give each distinct
 * macro the next id (1..32) on first use, and build the page buffers.
 */
export function planMacros(
  assignments: Map<number, MacroAssignment>,
  library: Macro[],
): { pages: { sub: number; data: Uint8Array }[]; codes: Map<number, number>; truncated: string[] } {
  const byId = new Map(library.map((m) => [m.id, m]));
  const hwId = new Map<string, number>();
  const codes = new Map<number, number>();
  const buf = new Uint8Array(MACRO_SLOT * MAX_MACROS);
  const truncated: string[] = [];
  for (const keyIndex of [...assignments.keys()].sort((a, b) => a - b)) {
    const a = assignments.get(keyIndex)!;
    const macro = byId.get(a.macroId);
    if (!macro) continue;
    let id = hwId.get(macro.id);
    if (id === undefined) {
      if (hwId.size >= MAX_MACROS) throw new Error(`Too many macros: the MK75 stores at most ${MAX_MACROS}.`);
      id = hwId.size + 1;
      hwId.set(macro.id, id);
      const { slot, encoded } = encodeMacroSlot(macro.events);
      if (encoded < macro.events.filter((e) => isEncodable(e.usage)).length) truncated.push(macro.name);
      buf.set(slot, (id - 1) * MACRO_SLOT);
    }
    codes.set(keyIndex, macroRefCode(id, a.mode));
  }
  const pageCount = Math.ceil(hwId.size / MACROS_PER_PAGE);
  const pages = Array.from({ length: pageCount }, (_, i) => ({
    sub: MACRO_PAGES[i],
    data: buf.slice(i * 1024, (i + 1) * 1024),
  }));
  return { pages, codes, truncated };
}
