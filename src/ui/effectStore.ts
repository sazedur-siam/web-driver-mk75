/** Custom live effects library, kept in this browser (and in backups). */
import { useSyncExternalStore } from 'react';
import { EXAMPLE_EFFECT, type CustomEffect } from '../protocol/effectDesigner';

const KEY = 'mk75.effects.v1';

function load(): CustomEffect[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null');
    return Array.isArray(v) && v.length ? v : [structuredClone(EXAMPLE_EFFECT)];
  } catch {
    return [structuredClone(EXAMPLE_EFFECT)];
  }
}

let effects: CustomEffect[] = load();
const subs = new Set<() => void>();
function set(next: CustomEffect[]) {
  effects = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  subs.forEach((f) => f());
}

export const effectStore = {
  get: () => effects,
  subscribe(f: () => void) {
    subs.add(f);
    return () => subs.delete(f);
  },
  upsert(e: CustomEffect) {
    set(effects.some((x) => x.id === e.id) ? effects.map((x) => (x.id === e.id ? e : x)) : [...effects, e]);
  },
  remove(id: string) {
    const next = effects.filter((e) => e.id !== id);
    set(next.length ? next : [structuredClone(EXAMPLE_EFFECT)]);
  },
  replaceAll(list: CustomEffect[]) {
    set(list.length ? list : [structuredClone(EXAMPLE_EFFECT)]);
  },
};

export function useEffects() {
  return useSyncExternalStore(effectStore.subscribe, effectStore.get);
}
