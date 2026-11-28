/** KeyboardEvent.code → MK75 key (matrix/LED index), via HID usages. */
import { HID_KEYS, HID_MODIFIERS } from '../protocol/keycodes';
import { vkToHid } from '../protocol/vk';
import { MK75_KEYS } from './mk75Layout';

const USAGE_BY_CODE = new Map<string, number>([...HID_KEYS.map((k) => [k.code, k.usage] as const), ...HID_MODIFIERS.map((m) => [m.code, m.usage] as const)]);
const INDEX_BY_USAGE = new Map<number, number>();
for (const k of MK75_KEYS) {
  const u = vkToHid(k.vk);
  if (u !== undefined) INDEX_BY_USAGE.set(u, k.index);
}

export function keyIndexForCode(code: string): number | undefined {
  const u = USAGE_BY_CODE.get(code);
  return u === undefined ? undefined : INDEX_BY_USAGE.get(u);
}
