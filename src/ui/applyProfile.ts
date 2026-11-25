/**
 * Capture / apply profiles. Apply follows the vendor ApplySetting order and skips blocks that are already
 * identical on the keyboard, so applying the active profile again writes nothing.
 */
import type { Mk75Device } from '../protocol/device';
import { getKeyCode, setKeyCode } from '../protocol/keycodes';
import { MK75_KEYS } from '../device/mk75Layout';
import { buildLedMatrix, CUSTOM_MODE_INDEX, parseProfile } from '../protocol/lighting';
import { planMacros } from '../protocol/macro';
import { assignmentMap, macroStore } from './macroStore';
import { loadPerKey, perKeyMap, savePerKey } from './perKeyStore';
import { macroPagesUnchanged, rememberMacroPages } from './saveKeys';
import { fromHex, toHex, type Profile } from './profileStore';
import { applyPresetToBlocks, type Preset } from '../protocol/preset';
import type { DeviceSnapshot } from './useDevice';

const eq = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

export function captureProfile(name: string, snap: DeviceSnapshot, id?: string, created?: string): Profile {
  const now = new Date().toISOString();
  return {
    id: id ?? Math.random().toString(36).slice(2, 10),
    name,
    created: created ?? now,
    updated: now,
    profile: toHex(snap.profile),
    rgbTable: toHex(snap.rgbTable),
    keyMatrix: toHex(snap.matrix),
    perKey: loadPerKey(),
    macros: structuredClone(macroStore.get()),
  };
}

/**
 * The key matrix a profile will actually write: its saved matrix plus macro codes from its own macro
 * assignments (cable), or with macro keys left as they are now (wireless, where macros can't be written).
 */
export function profileMatrix(p: Profile, macrosSupported: boolean, current: Uint8Array) {
  let matrix: Uint8Array = fromHex(p.keyMatrix);
  const plan = planMacros(assignmentMap(p.macros), p.macros.macros);
  if (macrosSupported) {
    for (const [key, code] of plan.codes) matrix = setKeyCode(matrix, key, code);
  } else {
    for (const k of MK75_KEYS) {
      if ((getKeyCode(matrix, k.index) & 0xff) === 0x10) matrix = setKeyCode(matrix, k.index, getKeyCode(current, k.index));
    }
  }
  return { matrix, plan };
}

export interface ApplyResult {
  snap: DeviceSnapshot;
  wrote: string[];
  skipped: string[];
}

export async function applyProfile(dev: Mk75Device, snap: DeviceSnapshot, p: Profile, step?: (label: string) => void): Promise<ApplyResult> {
  const wrote: string[] = [];
  const skipped: string[] = [];
  const profile = fromHex(p.profile);
  const rgbTable = fromHex(p.rgbTable);
  const custom = parseProfile(profile).activeIndex === CUSTOM_MODE_INDEX;

  // Per-key colours can't be read back: compare with what this browser last wrote.
  const perKeySame = JSON.stringify(loadPerKey()) === JSON.stringify(p.perKey);
  const wasCustom = parseProfile(snap.profile).activeIndex === CUSTOM_MODE_INDEX;

  // Browser-side state first, so key-matrix macro codes are planned from this profile's macros.
  macroStore.replaceAll(structuredClone(p.macros));
  savePerKey(p.perKey);

  // 1. Palette (vendor writes it only when not in Self-define).
  if (!eq(rgbTable, snap.rgbTable)) {
    step?.('Palette');
    await dev.writeRgbTable(rgbTable);
    wrote.push('palette');
  }

  // 2. Macro pages, then key matrix.
  const target = profileMatrix(p, dev.caps.macros, snap.matrix);
  const matrix = target.matrix;
  if (target.plan.pages.length) {
    if (!dev.caps.macros) skipped.push(dev.kind === 'wired' ? 'macros (not supported on this keyboard revision yet)' : 'macros (need the USB cable)');
    else if (eq(matrix, snap.matrix) && macroPagesUnchanged(target.plan.pages)) {
      /* same macros already written from this browser */
    } else {
      step?.('Macros');
      await dev.writeMacroPages(target.plan.pages);
      rememberMacroPages(target.plan.pages);
      wrote.push('macros');
    }
  }
  if (!eq(matrix, snap.matrix)) {
    step?.('Key mapping');
    await dev.writeKeyMatrix(matrix);
    wrote.push('key mapping');
  }

  // 3. Per-key colours when the profile uses Self-define (no read-back, so always written then).
  if (custom && Object.keys(p.perKey).length && !(perKeySame && wasCustom)) {
    step?.('Per-key colours');
    await dev.writeLedMatrix(buildLedMatrix(perKeyMap(p.perKey)));
    wrote.push('per-key colours');
  }

  // 4. Lighting profile last.
  if (!eq(profile, snap.profile)) {
    step?.('Lighting');
    await dev.writeProfile(profile);
    wrote.push('lighting');
  }

  step?.('Reading back');
  const back: DeviceSnapshot = { profile: await dev.readProfile(), matrix: await dev.readKeyMatrix(), rgbTable: await dev.readRgbTable() };
  return { snap: back, wrote, skipped };
}

/** Turn a shared preset into a full profile on top of the keyboard's current setup. */
export function profileFromPreset(p: Preset, snap: DeviceSnapshot): Profile {
  const b = applyPresetToBlocks(p, snap);
  const macros = structuredClone(macroStore.get());
  for (const idx of Object.keys(p.keys ?? {})) delete macros.assignments[Number(idx)]; // preset remaps win
  const now = new Date().toISOString();
  return {
    id: Math.random().toString(36).slice(2, 10),
    name: p.name,
    created: now,
    updated: now,
    profile: toHex(b.profile),
    rgbTable: toHex(b.rgbTable),
    keyMatrix: toHex(b.matrix),
    perKey: p.perKey ?? loadPerKey(),
    macros,
  };
}
