/**
 * Named profiles kept in this browser. Each holds everything needed to recreate a keyboard setup:
 * lighting profile, palette, key matrix (base-layer view), per-key colours and the macro library.
 * The keyboard stores one setup at a time; applying a profile writes it to the keyboard's flash.
 */
import { useSyncExternalStore } from 'react';
import type { RGB } from '../protocol/lighting';
import type { Macro, MacroAssignment } from '../protocol/macro';

export interface Profile {
  id: string;
  name: string;
  created: string;
  updated: string;
  profile: string; // hex, 254-byte lighting block (wired view)
  rgbTable: string; // hex, 1024 B palette table
  keyMatrix: string; // hex, 1024 B key matrix (base layer view)
  perKey: Record<number, RGB>;
  macros: { macros: Macro[]; assignments: Record<number, MacroAssignment> };
}

interface State {
  profiles: Profile[];
  activeId: string | null;
}

const KEY = 'mk75.profiles.v1';
const empty: State = { profiles: [], activeId: null };

function load(): State {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null');
    return v && Array.isArray(v.profiles) ? v : empty;
  } catch {
    return empty;
  }
}

let state: State = load();
const subs = new Set<() => void>();

function set(next: State) {
  state = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage full/unavailable: keep in memory */
  }
  subs.forEach((f) => f());
}

export const profileStore = {
  get: () => state,
  subscribe(f: () => void) {
    subs.add(f);
    return () => subs.delete(f);
  },
  upsert(p: Profile) {
    const exists = state.profiles.some((x) => x.id === p.id);
    set({ ...state, profiles: exists ? state.profiles.map((x) => (x.id === p.id ? p : x)) : [...state.profiles, p] });
  },
  remove(id: string) {
    set({ profiles: state.profiles.filter((p) => p.id !== id), activeId: state.activeId === id ? null : state.activeId });
  },
  setActive(id: string | null) {
    set({ ...state, activeId: id });
  },
  replaceAll(profiles: Profile[]) {
    set({ profiles, activeId: null });
  },
};

export function useProfiles() {
  return useSyncExternalStore(profileStore.subscribe, profileStore.get);
}

export const toHex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
export const fromHex = (s: string) => new Uint8Array((s.match(/../g) ?? []).map((h) => parseInt(h, 16)));

/** Validate an imported profile object (from a file). Throws on anything malformed. */
export function validateProfile(p: unknown): Profile {
  const o = p as Partial<Profile>;
  if (!o || typeof o !== 'object') throw new Error('Not a profile');
  if (typeof o.name !== 'string' || !o.name.trim()) throw new Error('Profile has no name');
  if (typeof o.profile !== 'string' || fromHex(o.profile).length !== 254) throw new Error(`Profile "${o.name}": bad lighting block`);
  if (typeof o.rgbTable !== 'string' || fromHex(o.rgbTable).length !== 1024) throw new Error(`Profile "${o.name}": bad palette`);
  if (typeof o.keyMatrix !== 'string' || fromHex(o.keyMatrix).length !== 1024) throw new Error(`Profile "${o.name}": bad key matrix`);
  const now = new Date().toISOString();
  return {
    id: typeof o.id === 'string' ? o.id : Math.random().toString(36).slice(2, 10),
    name: o.name.trim(),
    created: o.created ?? now,
    updated: o.updated ?? now,
    profile: o.profile,
    rgbTable: o.rgbTable,
    keyMatrix: o.keyMatrix,
    perKey: o.perKey && typeof o.perKey === 'object' ? o.perKey : {},
    macros: o.macros && Array.isArray(o.macros.macros) ? o.macros : { macros: [], assignments: {} },
  };
}
