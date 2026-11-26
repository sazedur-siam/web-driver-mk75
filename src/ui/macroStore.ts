/**
 * Macro library + key assignments, persisted in this browser. The MK75 has no macro read-back
 * command (the official driver also keeps macros on the PC), so this is the source of truth.
 */
import { useSyncExternalStore } from 'react';
import type { Macro, MacroAssignment } from '../protocol/macro';

const KEY = 'mk75.macros.v1';

interface MacroState {
  macros: Macro[];
  /** keyIndex → assignment */
  assignments: Record<number, MacroAssignment>;
}

const empty: MacroState = { macros: [], assignments: {} };

/** Shape check for stored or imported macro state (the tabs index into both fields). */
export const isMacroState = (v: unknown): v is MacroState => {
  const o = v as MacroState | null;
  return !!o && Array.isArray(o.macros) && !!o.assignments && typeof o.assignments === 'object' && !Array.isArray(o.assignments);
};

function load(): MacroState {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null');
    return isMacroState(v) ? v : empty;
  } catch {
    return empty;
  }
}

let state: MacroState = load();
const subs = new Set<() => void>();

function set(next: MacroState) {
  state = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable: keep in memory */
  }
  subs.forEach((f) => f());
}

export const macroStore = {
  get: () => state,
  subscribe(f: () => void) {
    subs.add(f);
    return () => subs.delete(f);
  },
  upsert(m: Macro) {
    const i = state.macros.findIndex((x) => x.id === m.id);
    const macros = i < 0 ? [...state.macros, m] : state.macros.map((x) => (x.id === m.id ? m : x));
    set({ ...state, macros });
  },
  remove(id: string) {
    const assignments = Object.fromEntries(Object.entries(state.assignments).filter(([, a]) => a.macroId !== id));
    set({ macros: state.macros.filter((m) => m.id !== id), assignments });
  },
  assign(keyIndex: number, a: MacroAssignment | null) {
    const assignments = { ...state.assignments };
    if (a) assignments[keyIndex] = a;
    else delete assignments[keyIndex];
    set({ ...state, assignments });
  },
  replaceAll(next: MacroState) {
    set(next);
  },
};

export function useMacros() {
  return useSyncExternalStore(macroStore.subscribe, macroStore.get);
}

export function assignmentMap(s: MacroState): Map<number, MacroAssignment> {
  return new Map(Object.entries(s.assignments).map(([k, v]) => [Number(k), v]));
}

export const newId = () => Math.random().toString(36).slice(2, 10);
