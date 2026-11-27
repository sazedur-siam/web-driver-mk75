/**
 * Side-light probe (features/20-side-lights.md, phase 1): read the 128-byte layout B config block, let the user
 * press one side-light shortcut on the keyboard, read again, and show which bytes changed. Read-only: nothing
 * here writes to the keyboard. The reads go into the "Contribute device data" file.
 */
import { toHex } from './profileStore';

export const PROBE_ACTIONS = [
  { id: 'baseline', label: 'Nothing yet (start)' },
  { id: 'mode', label: 'Fn + RShift (mode)' },
  { id: 'colour', label: 'Fn + / (colour)' },
  { id: 'speed', label: 'Fn + RCtrl (speed)' },
  { id: 'brightness', label: 'Fn + RAlt (brightness)' },
  { id: 'replug', label: 'Re-plugged the keyboard' },
  { id: 'other', label: 'Something else (describe)' },
] as const;

export type ProbeAction = (typeof PROBE_ACTIONS)[number]['id'];

export interface ProbeRead {
  t: number;
  /** What the user did on the keyboard just before this read. */
  action: ProbeAction;
  /** What the side lights show now, in the user's words (e.g. "steady, red"). */
  seen: string;
  block: Uint8Array;
}

export interface ByteChange {
  offset: number;
  from: number;
  to: number;
}

/** Layout B offsets the app already understands (PROTOCOL.md, spec_wireless.md §4.1). */
const KNOWN: Record<number, string> = {
  0x03: 'debounce',
  0x09: 'custom-effect flag',
  0x0a: 'effect',
  0x0b: 'colour group',
  0x0e: 'connection mode',
  0x16: 'tap/hold threshold',
  0x18: 'sleep',
  0x1a: 'knob mode',
  0x38: 'always FF',
  0x39: 'always FF',
  0x7e: 'signature',
  0x7f: 'signature',
};
const EFFECTS_AT = 0x3a;
const EFFECTS = 19;

/** A short name for a config-block offset, or '' when nobody knows what it is yet. */
export function describeOffset(o: number): string {
  if (KNOWN[o]) return KNOWN[o];
  const i = o - EFFECTS_AT;
  if (i >= 0 && i < 2 * EFFECTS) return `effect ${i >> 1} ${i & 1 ? 'speed/colour' : 'brightness'}`;
  return '';
}

export function diffBlocks(a: Uint8Array, b: Uint8Array): ByteChange[] {
  const out: ByteChange[] = [];
  for (let o = 0; o < Math.min(a.length, b.length); o++) if (a[o] !== b[o]) out.push({ offset: o, from: a[o], to: b[o] });
  return out;
}

export interface OffsetSummary {
  offset: number;
  /** Values seen at this offset across all reads, in order of first appearance. */
  values: number[];
  /** Actions that changed it (a read differing from the one before). */
  actions: ProbeAction[];
}

/** Every offset that changed between consecutive reads, with the values it took and what changed it. */
export function summarise(reads: ProbeRead[]): OffsetSummary[] {
  const by = new Map<number, OffsetSummary>();
  for (let i = 1; i < reads.length; i++) {
    for (const c of diffBlocks(reads[i - 1].block, reads[i].block)) {
      const s = by.get(c.offset) ?? { offset: c.offset, values: [], actions: [] };
      if (!s.actions.includes(reads[i].action)) s.actions.push(reads[i].action);
      by.set(c.offset, s);
    }
  }
  for (const s of by.values()) {
    for (const r of reads) if (!s.values.includes(r.block[s.offset])) s.values.push(r.block[s.offset]);
  }
  return [...by.values()].sort((x, y) => x.offset - y.offset);
}

export const hex2 = (n: number) => n.toString(16).padStart(2, '0').toUpperCase();
export const offsetLabel = (o: number) => `0x${hex2(o)}`;

/** The probe as it goes into the device-data file. */
export function probeForFile(reads: ProbeRead[]) {
  return reads.map((r) => ({ t: new Date(r.t).toISOString(), action: r.action, seen: r.seen.trim(), block: toHex(r.block) }));
}
