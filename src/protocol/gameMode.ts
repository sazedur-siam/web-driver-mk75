/**
 * Game mode: a few changes on top of whatever is on the keyboard, recorded so that turning it off puts back exactly
 * what it changed and nothing else.
 *
 * It only uses writes the app already makes (key matrix, lighting profile, per-key colours). Keys are disabled
 * through the redirect-aware setKeyCode; the effect switch goes through patchProfile like the Lighting tab. The
 * firmware's own Win lock (Fn + LWin) is separate and keeps working.
 */
import { MK75_KEYS } from '../device/mk75Layout';
import { getKeyCode, setKeyCode } from './keycodes';
import { CUSTOM_MODE_INDEX, parseProfile, patchProfile, PER_MODE_SLOTS } from './lighting';

export interface GameModeOptions {
  disableWin: boolean;
  disableCaps: boolean;
  /** Sleep timer off while gaming (matters most on 2.4 GHz / Bluetooth). */
  neverSleep: boolean;
  /** 'wasd' switches to Self-define with the WASD highlight colours. */
  lighting: 'keep' | 'wasd';
}

export const DEFAULT_GAME_MODE: GameModeOptions = { disableWin: true, disableCaps: true, neverSleep: false, lighting: 'keep' };

export interface KeyChange {
  index: number;
  before: number;
  after: number;
}
export interface ByteChange {
  at: number;
  before: number;
  after: number;
}

/** What game mode changed, with both values, so undo can tell whether the user changed something since. */
export interface GameModeRecord {
  since: string;
  keys: KeyChange[];
  profile: ByteChange[];
  /** The WASD colours were written to the per-key memory (it can't be read back). */
  perKeyWritten: boolean;
}

/** Profile sleep byte: 0xFF = never (lighting.ts header). */
export const P_SLEEP = 0x11;
const SLEEP_NEVER = 0xff;
const DISABLED = 0;
/** The Fn key's code: the firmware handles it, never write it (CLAUDE.md rule 3). */
const FN_CODE = 0x00000020;

const keyIndex = (label: string) => MK75_KEYS.find((k) => k.label === label)?.index;
export const GAME_KEYS = { win: keyIndex('LWin'), caps: keyIndex('CapsLock') };
const ALLOWED_KEYS = new Set([GAME_KEYS.win, GAME_KEYS.caps].filter((i): i is number => i !== undefined));

/** Profile bytes game mode may touch: the sleep byte and what patchProfile writes for a mode switch. */
const ALLOWED_BYTES = new Set<number>([P_SLEEP, 0x04, 0x05, 0x06, 0x14, 0x15]);
for (let i = 0; i < PER_MODE_SLOTS * 2; i++) ALLOWED_BYTES.add(0x16 + i);

const label = (index: number) => MK75_KEYS.find((k) => k.index === index)?.label ?? `key ${index}`;
const keyName = (index: number) => ({ LWin: 'Win', CapsLock: 'Caps Lock' })[label(index)] ?? label(index);

/** A key game mode must not touch: the Fn key, device functions (07) and the Fn type (0D) are firmware's. */
function untouchable(code: number) {
  return code === FN_CODE || [0x07, 0x0d].includes(code & 0xff);
}

function diffBytes(before: Uint8Array, after: Uint8Array): ByteChange[] {
  const out: ByteChange[] = [];
  for (let i = 0; i < before.length; i++) if (before[i] !== after[i]) out.push({ at: i, before: before[i], after: after[i] });
  return out;
}

export interface PlanOn {
  matrix: Uint8Array;
  profile: Uint8Array;
  record: GameModeRecord;
  /** Human-readable reasons for options that changed nothing. */
  skipped: string[];
}

export function planGameModeOn(matrix: Uint8Array, profile: Uint8Array, o: GameModeOptions, now = new Date()): PlanOn {
  let m = matrix;
  const keys: KeyChange[] = [];
  const skipped: string[] = [];
  const wanted = [o.disableWin ? GAME_KEYS.win : undefined, o.disableCaps ? GAME_KEYS.caps : undefined];
  for (const index of wanted) {
    if (index === undefined) continue;
    const before = getKeyCode(m, index);
    if (untouchable(before)) skipped.push(`${keyName(index)} holds a keyboard function and was left alone`);
    else if (before === DISABLED) skipped.push(`${keyName(index)} was already disabled`);
    else {
      m = setKeyCode(m, index, DISABLED);
      keys.push({ index, before, after: DISABLED });
    }
  }
  let p: Uint8Array = new Uint8Array(profile);
  if (o.neverSleep) {
    if (p[P_SLEEP] === SLEEP_NEVER) skipped.push('The sleep timer was already off');
    else p[P_SLEEP] = SLEEP_NEVER;
  }
  let perKeyWritten = false;
  if (o.lighting === 'wasd') {
    p = patchProfile(p, { ...parseProfile(p), activeIndex: CUSTOM_MODE_INDEX });
    perKeyWritten = true;
  }
  return { matrix: m, profile: p, record: { since: now.toISOString(), keys, profile: diffBytes(profile, p), perKeyWritten }, skipped };
}

export interface PlanOff {
  matrix: Uint8Array;
  profile: Uint8Array;
  restored: number;
  /** Human-readable notes for changes left as they are because something changed them since. */
  leftAsIs: string[];
}

/** Undo a record. Throws on a record that names anything game mode never touches (a damaged saved value). */
export function planGameModeOff(matrix: Uint8Array, profile: Uint8Array, r: GameModeRecord): PlanOff {
  assertRecord(r);
  let m = matrix;
  const p = new Uint8Array(profile);
  let restored = 0;
  const leftAsIs: string[] = [];
  for (const k of r.keys) {
    if (getKeyCode(m, k.index) === k.after) {
      m = setKeyCode(m, k.index, k.before);
      restored++;
    } else leftAsIs.push(`${keyName(k.index)} was changed after game mode started, so it was left as it is`);
  }
  // The sleep timer and the lighting bytes are restored independently, each only if all its bytes are still
  // game mode's: restoring half of a lighting change would leave a mixed effect.
  const groups: [string, ByteChange[]][] = [
    ['sleep timer', r.profile.filter((b) => b.at === P_SLEEP)],
    ['lighting', r.profile.filter((b) => b.at !== P_SLEEP)],
  ];
  for (const [name, bytes] of groups) {
    if (!bytes.length) continue;
    if (bytes.some((b) => p[b.at] !== b.after)) {
      leftAsIs.push(`The ${name} was changed after game mode started, so it was left as it is`);
      continue;
    }
    for (const b of bytes) p[b.at] = b.before;
    restored++;
  }
  return { matrix: m, profile: p, restored, leftAsIs };
}

export type GameModeStatus = 'on' | 'partial' | 'off';

/** Compare a record with the keyboard: all of its changes still there, some, or none. */
export function gameModeStatus(r: GameModeRecord | null, matrix: Uint8Array | undefined, profile: Uint8Array | undefined): GameModeStatus {
  if (!r || !matrix || !profile) return 'off';
  const checks = [...r.keys.map((k) => getKeyCode(matrix, k.index) === k.after), ...r.profile.map((b) => profile[b.at] === b.after)];
  if (!checks.length) return 'off';
  const hits = checks.filter(Boolean).length;
  return hits === checks.length ? 'on' : hits ? 'partial' : 'off';
}

const isByte = (v: unknown) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 0xff;
const isU32 = (v: unknown) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 0xffffffff;

function assertRecord(r: GameModeRecord) {
  for (const k of r.keys) if (!ALLOWED_KEYS.has(k.index) || untouchable(k.before)) throw new Error(`Game mode record names a key it never changes (${k.index})`);
  for (const b of r.profile) if (!ALLOWED_BYTES.has(b.at)) throw new Error(`Game mode record names a lighting byte it never changes (0x${b.at.toString(16)})`);
}

/** Validate a stored record; null if it's damaged or names anything game mode never touches. */
export function parseRecord(v: unknown): GameModeRecord | null {
  const r = v as GameModeRecord;
  if (!r || typeof r !== 'object' || typeof r.since !== 'string' || !Array.isArray(r.keys) || !Array.isArray(r.profile) || typeof r.perKeyWritten !== 'boolean') return null;
  if (!r.keys.every((k) => k && Number.isInteger(k.index) && isU32(k.before) && isU32(k.after))) return null;
  if (!r.profile.every((b) => b && Number.isInteger(b.at) && isByte(b.before) && isByte(b.after))) return null;
  try {
    assertRecord(r);
  } catch {
    return null;
  }
  return { since: r.since, keys: r.keys.map((k) => ({ ...k })), profile: r.profile.map((b) => ({ ...b })), perKeyWritten: r.perKeyWritten };
}

/** Validate stored options; null if damaged. */
export function parseOptions(v: unknown): GameModeOptions | null {
  const o = v as GameModeOptions;
  if (!o || typeof o !== 'object') return null;
  if (typeof o.disableWin !== 'boolean' || typeof o.disableCaps !== 'boolean' || typeof o.neverSleep !== 'boolean') return null;
  if (o.lighting !== 'keep' && o.lighting !== 'wasd') return null;
  return { disableWin: o.disableWin, disableCaps: o.disableCaps, neverSleep: o.neverSleep, lighting: o.lighting };
}

/** One line for the header tooltip and the card, e.g. "Win and Caps Lock off · never sleeps". */
export function describeOptions(o: GameModeOptions): string {
  const keys = [o.disableWin && 'Win', o.disableCaps && 'Caps Lock'].filter(Boolean).join(' and ');
  const parts = [keys && `${keys} off`, o.neverSleep && 'never sleeps', o.lighting === 'wasd' && 'WASD lighting'].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'nothing selected';
}
