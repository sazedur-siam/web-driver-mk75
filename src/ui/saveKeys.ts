import { setKeyCode } from '../protocol/keycodes';
import { planMacros, type MacroFormat } from '../protocol/macro';
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

/** Apply current macro assignments onto a matrix (ids assigned in key order, like the vendor). */
export function withMacroCodes(matrix: Uint8Array, format: MacroFormat = 'slots'): { matrix: Uint8Array; plan: ReturnType<typeof planMacros> } {
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
  const { matrix: m, plan } = withMacroCodes(matrix, dev.caps.macros || 'slots');
  if (plan.pages.length) {
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
