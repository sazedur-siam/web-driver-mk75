/**
 * Side-light probe (how the side-light bytes were found; PROTOCOL.md): snapshot every readable layout B block, let the user
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
  { id: 'setup', keys: 'Fn + Right Shift', what: 'set to steady' },
  { id: 'breathe', keys: 'Fn + Right Shift', what: 'set to breathe' },
  { id: 'replug', keys: 'Re-plugged', what: 'after reconnecting' },
] as const;

export type ProbeAction = (typeof PROBE_ACTIONS)[number]['id'];

export const probeAction = (id: ProbeAction) => PROBE_ACTIONS.find((a) => a.id === id)!;
export const actionLabel = (id: ProbeAction) => `${probeAction(id).keys} (${probeAction(id).what})`;

/** How the page noticed the press: a byte changed, the keyboard sent an input report, the browser saw the key, or nothing (user confirmed). */
export type ProbeSignal = 'bytes' | 'hid' | 'key' | 'none';

export interface ProbeRead {
  t: number;
  /** What the user did on the keyboard just before this read. */
  action: ProbeAction;
  /** Raw blocks by name (`led`, `palette`, `keymap 0`..`keymap 3`), see Mk75Device.readRawBlocks. */
  blocks: Record<string, Uint8Array>;
  /** Guided test only: what detected the press, input reports seen (hex, report ID first) and key codes the browser saw. */
  signal?: ProbeSignal;
  hid?: string[];
  keys?: string[];
}

/**
 * One step of the guided test. `press` steps wait for the press to be detected; `setup` waits for the user's
 * "Ready"; `save` waits for the user to save the results file; `replug` waits for the keyboard to reconnect.
 * `codes` = KeyboardEvent.code values the key would send if the keyboard passes it to the computer (with Fn held
 * it usually doesn't).
 */
export interface GuideStep {
  /** Unused for `save` steps (nothing is read). */
  action: ProbeAction;
  kind: 'press' | 'setup' | 'save' | 'replug';
  prompt: string;
  detail: string;
  codes?: string[];
}

const presses = (action: ProbeAction, n: number, prompt: string, what: string, look: string, codes: string[]): GuideStep[] =>
  Array.from({ length: n }, (_, i) => ({ action, kind: 'press' as const, prompt, detail: `${what}: press ${i + 1} of ${n}. ${look}`, codes }));

/**
 * The order keeps every press visible on the side lights: steady first (colour and brightness show there),
 * breathe for speed, and mode last because it cycles through the animated modes.
 */
export const GUIDE: GuideStep[] = [
  {
    action: 'setup',
    kind: 'setup',
    prompt: 'Set the side lights to steady',
    detail: 'Press Fn + Right Shift until the side lights glow in one steady colour (not moving, not breathing), then click Ready.',
  },
  {
    action: 'check',
    kind: 'press',
    prompt: 'Press Fn + F6',
    detail: 'The key backlight gets brighter. This checks that the page notices changes. Already at full brightness? Press Fn + F5 instead.',
    codes: ['F5', 'F6'],
  },
  ...presses('colour', 7, 'Press Fn + /', 'Side-light colour', 'The side lights should change colour.', ['Slash']),
  ...presses('brightness', 4, 'Press Fn + Right Alt', 'Side-light brightness', 'The side lights should get brighter or dimmer.', ['AltRight']),
  {
    action: 'breathe',
    kind: 'setup',
    prompt: 'Set the side lights to breathe',
    detail: 'Press Fn + Right Shift until the side lights slowly fade in and out, then click Ready. Speed only shows in a moving mode.',
  },
  ...presses('speed', 4, 'Press Fn + Right Ctrl', 'Side-light speed', 'The breathing should get faster or slower.', ['ControlRight']),
  ...presses('mode', 5, 'Press Fn + Right Shift', 'Side-light mode', 'The side-light pattern should change.', ['ShiftRight']),
  {
    action: 'replug',
    kind: 'save',
    prompt: 'Save the results',
    detail: 'Click Save results. The file goes to your Downloads folder. Then the last step.',
  },
  {
    action: 'replug',
    kind: 'replug',
    prompt: 'Unplug the keyboard, then plug it back in',
    detail: 'Keep this window open. The page reconnects by itself and continues. If it doesn\'t, click Reconnect below.',
  },
];

/** The probe on its own, for "Save results" (works while the keyboard is unplugged). */
export function probeResultsFile(reads: ProbeRead[], connection: { kind: string; flavour: string; transport: string } | null, appVersion: string) {
  return {
    format: 'mk75-side-light-probe' as const,
    version: 1,
    created: new Date().toISOString(),
    app: appVersion,
    connection,
    probe: probeForFile(reads),
  };
}

/** Keys that are only half of a shortcut (Fn itself never reaches the computer). */
const MODIFIERS = new Set(['ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight']);

/** For a key the browser saw during a press step: 'right', 'wrong' (tell the user), or 'ignore' (part of a shortcut). */
export function judgeKey(step: GuideStep, code: string): 'right' | 'wrong' | 'ignore' {
  if (step.codes?.includes(code)) return 'right';
  return MODIFIERS.has(code) ? 'ignore' : 'wrong';
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
    ...(r.signal ? { signal: r.signal } : {}),
    ...(r.hid?.length ? { hid: r.hid } : {}),
    ...(r.keys?.length ? { keys: r.keys } : {}),
    blocks: Object.fromEntries(Object.entries(r.blocks).map(([k, v]) => [k, toHex(v)])),
  }));
}
