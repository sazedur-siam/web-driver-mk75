/**
 * Side-light probe (features/20-side-lights.md, phase 1): snapshot every readable layout B block, let the user
 * press one side-light shortcut on the keyboard, read again, and show which bytes changed. Read-only: nothing
 * here writes to the keyboard. The reads go into the "Contribute device data" file.
 */
import { toHex } from './profileStore';

/** What the user did on the keyboard before a read: `keys` as printed on the keyboard, `what` it changes. */
export const PROBE_ACTIONS = [
  { id: 'baseline', keys: 'Snapshot', what: 'starting point' },
  { id: 'mode', keys: 'Fn + Right Shift', what: 'mode' },
  { id: 'colour', keys: 'Fn + /', what: 'colour' },
  { id: 'speed', keys: 'Fn + Right Ctrl', what: 'speed' },
  { id: 'brightness', keys: 'Fn + Right Alt', what: 'brightness' },
  /** Control: main backlight brightness lives at led 0x3A+2i, so this must show a change if the probe works. */
  { id: 'check', keys: 'Fn + F5 or F6', what: 'main backlight brightness' },
  { id: 'replug', keys: 'Re-plugged', what: 'after reconnecting' },
] as const;

export type ProbeAction = (typeof PROBE_ACTIONS)[number]['id'];

export const probeAction = (id: ProbeAction) => PROBE_ACTIONS.find((a) => a.id === id)!;
export const actionLabel = (id: ProbeAction) => `${probeAction(id).keys} (${probeAction(id).what})`;

export interface ProbeRead {
  t: number;
  /** What the user did on the keyboard just before this read. */
  action: ProbeAction;
  /** Raw blocks by name (`led`, `palette`, `keymap 0`..`keymap 3`), see Mk75Device.readRawBlocks. */
  blocks: Record<string, Uint8Array>;
}

export interface ByteChange {
  block: string;
  offset: number;
  from: number;
  to: number;
}

/** Layout B config-block offsets the app already understands (PROTOCOL.md, spec_wireless.md §4.1). */
const KNOWN_LED: Record<number, string> = {
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

/** A short name for a byte, or '' when nobody knows what it is yet. */
export function describeOffset(block: string, o: number): string {
  if (block === 'led') {
    if (KNOWN_LED[o]) return KNOWN_LED[o];
    const i = o - EFFECTS_AT;
    if (i >= 0 && i < 2 * EFFECTS) return `effect ${i >> 1} ${i & 1 ? 'speed/colour' : 'brightness'}`;
    return '';
  }
  if (block.startsWith('keymap')) return `key slot ${o >> 2}`;
  if (block === 'palette' && o < 0x15 * 20) return `effect ${Math.floor(o / 0x15)} colours`;
  return '';
}

export function diffBlocks(a: Uint8Array, b: Uint8Array): { offset: number; from: number; to: number }[] {
  const out: { offset: number; from: number; to: number }[] = [];
  for (let o = 0; o < Math.min(a.length, b.length); o++) if (a[o] !== b[o]) out.push({ offset: o, from: a[o], to: b[o] });
  return out;
}

/** Every byte that differs between two reads, block by block (blocks in the order the device returned them). */
export function diffReads(a: ProbeRead, b: ProbeRead): ByteChange[] {
  const out: ByteChange[] = [];
  for (const name of Object.keys(b.blocks)) {
    if (!a.blocks[name]) continue;
    for (const c of diffBlocks(a.blocks[name], b.blocks[name])) out.push({ block: name, ...c });
  }
  return out;
}

export interface OffsetSummary {
  block: string;
  offset: number;
  /** Values seen at this byte across all reads, in order of first appearance. */
  values: number[];
  /** Actions that changed it (a read differing from the one before). */
  actions: ProbeAction[];
}

/** Every byte that changed between consecutive reads, with the values it took and what changed it. */
export function summarise(reads: ProbeRead[]): OffsetSummary[] {
  const by = new Map<string, OffsetSummary>();
  for (let i = 1; i < reads.length; i++) {
    for (const c of diffReads(reads[i - 1], reads[i])) {
      const k = `${c.block}:${c.offset}`;
      const s = by.get(k) ?? { block: c.block, offset: c.offset, values: [], actions: [] };
      if (!s.actions.includes(reads[i].action)) s.actions.push(reads[i].action);
      by.set(k, s);
    }
  }
  for (const s of by.values()) {
    for (const r of reads) {
      const v = r.blocks[s.block]?.[s.offset];
      if (v !== undefined && !s.values.includes(v)) s.values.push(v);
    }
  }
  return [...by.values()];
}

export const hex2 = (n: number) => n.toString(16).padStart(2, '0').toUpperCase();
/** "led 0x06", "palette 0x1A3". */
export const byteLabel = (block: string, o: number) => `${block} 0x${o.toString(16).padStart(o > 0xff ? 3 : 2, '0').toUpperCase()}`;

/** The probe as it goes into the device-data file. */
export function probeForFile(reads: ProbeRead[]) {
  return reads.map((r) => ({
    t: new Date(r.t).toISOString(),
    action: r.action,
    blocks: Object.fromEntries(Object.entries(r.blocks).map(([k, v]) => [k, toHex(v)])),
  }));
}
