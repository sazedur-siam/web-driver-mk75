/**
 * Text → macro events (US keyboard layout). Consecutive shifted characters share one Shift hold to save
 * bytes in the 128-byte macro slot.
 */
import { macroBytes, MACRO_SLOT, type MacroEvent } from './macro';

const LSHIFT = 0xe1;

/** char → [HID usage, needs Shift] for a US layout. */
const MAP = new Map<string, [number, boolean]>();
'abcdefghijklmnopqrstuvwxyz'.split('').forEach((c, i) => {
  MAP.set(c, [0x04 + i, false]);
  MAP.set(c.toUpperCase(), [0x04 + i, true]);
});
'1234567890'.split('').forEach((c, i) => MAP.set(c, [0x1e + i, false]));
'!@#$%^&*()'.split('').forEach((c, i) => MAP.set(c, [0x1e + i, true]));
const PAIRS: [string, string, number][] = [
  ['-', '_', 0x2d],
  ['=', '+', 0x2e],
  ['[', '{', 0x2f],
  [']', '}', 0x30],
  ['\\', '|', 0x31],
  [';', ':', 0x33],
  ["'", '"', 0x34],
  ['`', '~', 0x35],
  [',', '<', 0x36],
  ['.', '>', 0x37],
  ['/', '?', 0x38],
];
for (const [plain, shifted, usage] of PAIRS) {
  MAP.set(plain, [usage, false]);
  MAP.set(shifted, [usage, true]);
}
MAP.set(' ', [0x2c, false]);
MAP.set('\n', [0x28, false]);
MAP.set('\t', [0x2b, false]);

/** HID usage for a character's key on a US layout (ignoring Shift), or undefined. */
export function charUsage(ch: string): number | undefined {
  return MAP.get(ch)?.[0];
}

export function isTypeable(ch: string): boolean {
  return MAP.has(ch);
}

export interface TextMacroResult {
  events: MacroEvent[];
  unsupported: string[];
  bytes: number;
  fits: boolean;
}

export function textToEvents(text: string, delay = 5): TextMacroResult {
  const d = Math.max(3, Math.round(delay));
  const events: MacroEvent[] = [];
  const unsupported = new Set<string>();
  let shift = false;
  for (const ch of text.replace(/\r\n?/g, '\n')) {
    const m = MAP.get(ch);
    if (!m) {
      unsupported.add(ch);
      continue;
    }
    const [usage, needShift] = m;
    if (needShift !== shift) {
      events.push({ usage: LSHIFT, down: needShift, delay: d });
      shift = needShift;
    }
    events.push({ usage, down: true, delay: d }, { usage, down: false, delay: d });
  }
  if (shift) events.push({ usage: LSHIFT, down: false, delay: d });
  const bytes = macroBytes(events);
  return { events, unsupported: [...unsupported], bytes, fits: bytes <= MACRO_SLOT };
}

/** Split text into the fewest chunks whose macros each fit in one 128-byte slot. */
export function splitText(text: string, delay = 5): string[] {
  const chars = [...text.replace(/\r\n?/g, '\n')].filter(isTypeable);
  const out: string[] = [];
  let cur = '';
  for (const ch of chars) {
    if (textToEvents(cur + ch, delay).fits) cur += ch;
    else {
      if (cur) out.push(cur);
      cur = ch;
    }
  }
  if (cur) out.push(cur);
  return out;
}
