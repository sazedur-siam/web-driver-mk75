/**
 * Backup file: the keyboard's blocks (lighting profile, key matrix, palette, side lights on layout B boards) plus the
 * browser-only data (macros, saved profiles, custom effects). Restore follows the vendor write order.
 */
import type { Mk75Device, SideLights } from '../protocol/device';
import { PAGE_LEN, PROFILE_LEN } from '../protocol/mk75';
import { writeSideLightsIfChanged } from './applyProfile';
import { effectStore, isEffectList } from './effectStore';
import { isMacroState, macroStore } from './macroStore';
import { parseSideLights, profileStore, validateProfile, type Profile } from './profileStore';
import { withMacroCodes } from './saveKeys';
import type { DeviceSnapshot } from './useDevice';

const toHex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
const fromHexStr = (s: string) => new Uint8Array((s.match(/../g) ?? []).map((h) => parseInt(h, 16)));

export interface BackupFile {
  format: 'mk75-driver-backup';
  version: 1;
  created: string;
  profile: string;
  keyMatrix: string;
  rgbTable: string;
  /** Side light bars (layout B boards only; older backups and other boards don't have it). */
  sideLights?: Partial<SideLights>;
  /** Macro library + assignments (kept in the browser; the keyboard can't send them back). */
  macros?: ReturnType<typeof macroStore.get>;
  /** Saved profiles (browser only). */
  profiles?: Profile[];
  /** Custom live effects (browser only). */
  effects?: ReturnType<typeof effectStore.get>;
}

export function buildBackup(snap: DeviceSnapshot, sideLights?: SideLights): BackupFile {
  return {
    format: 'mk75-driver-backup',
    version: 1,
    created: new Date().toISOString(),
    profile: toHex(snap.profile),
    keyMatrix: toHex(snap.matrix),
    rgbTable: toHex(snap.rgbTable),
    ...(sideLights ? { sideLights: { ...sideLights } } : {}),
    macros: macroStore.get(),
    profiles: profileStore.get().profiles,
    effects: effectStore.get(),
  };
}

/** Parse and check a backup file. Throws before anything is written or replaced if any part is damaged. */
export function parseBackup(text: string): BackupFile {
  const b = JSON.parse(text) as BackupFile;
  if (!b || b.format !== 'mk75-driver-backup') throw new Error('Not a Lingbao MK75 Driver backup file');
  if (typeof b.profile !== 'string' || typeof b.keyMatrix !== 'string' || typeof b.rgbTable !== 'string') throw new Error('Backup file is truncated or corrupted');
  if (fromHexStr(b.profile).length !== PROFILE_LEN || fromHexStr(b.keyMatrix).length !== PAGE_LEN || fromHexStr(b.rgbTable).length !== PAGE_LEN)
    throw new Error('Backup file is truncated or corrupted');
  if (b.macros !== undefined && !isMacroState(b.macros)) throw new Error('Backup macros are damaged');
  if (b.effects !== undefined && !isEffectList(b.effects)) throw new Error('Backup effects are damaged');
  if (b.profiles !== undefined) {
    if (!Array.isArray(b.profiles)) throw new Error('Backup profiles are damaged');
    b.profiles = b.profiles.map(validateProfile);
  }
  if (b.sideLights !== undefined) {
    const s = parseSideLights(b.sideLights);
    if (!s) throw new Error('Backup side lights are damaged');
    b.sideLights = s;
  }
  return b;
}

/**
 * Restore a parsed backup: browser data, then the keyboard in vendor order (palette → macro pages → key matrix →
 * profile), then the side lights. Returns the keyboard's state read back and notes for anything skipped.
 */
export async function restoreBackup(dev: Mk75Device, snap: DeviceSnapshot, b: BackupFile): Promise<{ snap: DeviceSnapshot; notes: string[] }> {
  const notes: string[] = [];
  if (b.macros) macroStore.replaceAll(b.macros);
  if (b.effects?.length) effectStore.replaceAll(b.effects);
  if (b.profiles?.length) profileStore.replaceAll(b.profiles);
  await dev.writeRgbTable(fromHexStr(b.rgbTable));
  // Macro pages first (ids are re-planned deterministically in key order), then the matrix.
  const { matrix, plan } = withMacroCodes(fromHexStr(b.keyMatrix), dev.caps.macros, snap.matrix);
  if (plan.pages.length) {
    await dev.checkKeyMatrix?.(matrix);
    await dev.writeMacroPages(plan.pages);
  }
  await dev.writeKeyMatrix(matrix);
  await dev.writeProfile(fromHexStr(b.profile));
  if (b.sideLights && (await writeSideLightsIfChanged(dev, b.sideLights)) === 'unsupported') {
    notes.push('The side lights in the backup were skipped: this connection has no side-light control.');
  }
  return { snap: { profile: await dev.readProfile(), matrix: await dev.readKeyMatrix(), rgbTable: await dev.readRgbTable() }, notes };
}
