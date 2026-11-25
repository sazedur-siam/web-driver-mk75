/** Per-key "Self-define" colours, kept in this browser (the keyboard has no read-back for them). */
import type { RGB } from '../protocol/lighting';

const KEY = 'mk75.perkey.v1';

export function loadPerKey(): Record<number, RGB> {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    return {};
  }
}

export function savePerKey(v: Record<number, RGB>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    /* storage unavailable */
  }
}

export const perKeyMap = (v: Record<number, RGB>) => new Map<number, RGB>(Object.entries(v).map(([k, c]) => [Number(k), c]));
