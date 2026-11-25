import { setKeyCode } from '../protocol/keycodes';
import { planMacros } from '../protocol/macro';
import { assignmentMap, macroStore } from './macroStore';
import type { DeviceApi } from './useDevice';

/** Apply current macro assignments onto a matrix (ids assigned in key order, like the vendor). */
export function withMacroCodes(matrix: Uint8Array): { matrix: Uint8Array; plan: ReturnType<typeof planMacros> } {
  const s = macroStore.get();
  const plan = planMacros(assignmentMap(s), s.macros);
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
  const { matrix: m, plan } = withMacroCodes(matrix);
  if (plan.pages.length) await dev.writeMacroPages(plan.pages);
  await dev.writeKeyMatrix(m);
  const back = await dev.readKeyMatrix();
  api.setSnap({ ...snap, matrix: back });
  api.push({
    dir: 'info',
    text: `Key mapping saved${plan.pages.length ? ` with ${plan.codes.size} macro key(s) in ${plan.pages.length} macro page(s)` : ''}`,
  });
  if (plan.truncated.length) api.push({ dir: 'error', text: `Macro too long, truncated: ${plan.truncated.join(', ')}` });
}
