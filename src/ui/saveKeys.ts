import type { DeviceCaps } from '../protocol/device';
import { getKeyCode, setKeyCode } from '../protocol/keycodes';
import { MK75_KEYS } from '../device/mk75Layout';
import { planMacros } from '../protocol/macro';
import { assignmentMap, macroStore } from './macroStore';
import type { DeviceApi } from './useDevice';

/** Macro pages can't be read back; remember what this browser last wrote to skip identical rewrites. */
const LAST_PAGES = 'mk75.macropages.last';
const pagesKey = (pages: { sub: number; data: Uint8Array }[]) => pages.map((p) => p.sub.toString(16) + ':' + Array.from(p.data, (b) => b.toString(16)).join('')).join('|');
export function macroPagesUnchanged(pages: { sub: number; data: Uint8Array }[]): boolean {
  try {
    return localStorage.getItem(LAST_PAGES) === pagesKey(pages);
  } catch {
    return false;
  }
}
export function rememberMacroPages(pages: { sub: number; data: Uint8Array }[]) {
  try {
    localStorage.setItem(LAST_PAGES, pagesKey(pages));
  } catch {
    /* ignore */
  }
}

/** No macro support (0x15 receiver): macro keys keep whatever the keyboard has now. */
export function keepDeviceMacros(matrix: Uint8Array, current: Uint8Array): Uint8Array {
  let m = matrix;
  for (const k of MK75_KEYS) if ((getKeyCode(m, k.index) & 0xff) === 0x10) m = setKeyCode(m, k.index, getKeyCode(current, k.index));
  return m;
}

/**
 * Apply current macro assignments onto a matrix (ids assigned in key order, like the vendor).
 * With `format` false the device can't store macros: nothing is planned and `current`'s macro cells are kept.
 */
export function withMacroCodes(
  matrix: Uint8Array,
  format: DeviceCaps['macros'] = 'slots',
  current: Uint8Array = matrix,
): { matrix: Uint8Array; plan: ReturnType<typeof planMacros> } {
  if (!format) return { matrix: keepDeviceMacros(matrix, current), plan: planMacros(new Map(), [], 'slots') };
  const s = macroStore.get();
  const plan = planMacros(assignmentMap(s), s.macros, format);
  let m = matrix;
  for (const [key, code] of plan.codes) m = setKeyCode(m, key, code);
  return { matrix: m, plan };
}

/**
 * Vendor ApplySetting flag 1 order: macro pages (50 ms apart), then the key matrix; then read back.
 */
export async function saveKeysAndMacros(api: DeviceApi, matrix: Uint8Array) {
  const { dev, snap } = api;
  if (!dev || !snap) return;
  const { matrix: m, plan } = withMacroCodes(matrix, dev.caps.macros, snap.matrix);
  if (plan.pages.length) {
    await dev.checkKeyMatrix?.(m);
    await dev.writeMacroPages(plan.pages);
    rememberMacroPages(plan.pages);
  }
  await dev.writeKeyMatrix(m);
  const back = await dev.readKeyMatrix();
  api.setSnap({ ...snap, matrix: back });
  api.push({
    dir: 'info',
    text: `Key mapping saved${plan.pages.length ? ` with ${plan.codes.size} macro key(s) in ${plan.pages.length} macro block(s)` : ''}`,
  });
  if (plan.truncated.length) api.push({ dir: 'error', text: `Macro too long, truncated: ${plan.truncated.join(', ')}` });
}
