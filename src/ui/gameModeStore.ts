/**
 * Game mode in the browser: options and the active undo record (localStorage `mk75.gamemode`), and the write
 * sequence. Planning is pure and tested in protocol/gameMode.ts.
 */
import { useSyncExternalStore } from 'react';
import {
  DEFAULT_GAME_MODE,
  gameModeStatus,
  parseOptions,
  parseRecord,
  planGameModeOff,
  planGameModeOn,
  type GameModeOptions,
  type GameModeRecord,
} from '../protocol/gameMode';
import { buildLedMatrix, CUSTOM_MODE_INDEX, parseProfile, type RGB } from '../protocol/lighting';
import { loadPerKey, perKeyMap } from './perKeyStore';
import type { DeviceApi } from './useDevice';

const KEY = 'mk75.gamemode';

interface State {
  v: 1;
  options: GameModeOptions;
  active: GameModeRecord | null;
  /** What the last toggle did, for the card (not stored). */
  lastResult?: string[];
}

function load(): State {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null');
    return { v: 1, options: parseOptions(v?.options) ?? DEFAULT_GAME_MODE, active: parseRecord(v?.active) };
  } catch {
    return { v: 1, options: DEFAULT_GAME_MODE, active: null };
  }
}

let state = load();
const subs = new Set<() => void>();
function set(next: State) {
  state = next;
  try {
    localStorage.setItem(KEY, JSON.stringify({ v: 1, options: next.options, active: next.active }));
  } catch {
    /* storage unavailable: game mode still works for this page */
  }
  subs.forEach((f) => f());
}

export const gameModeStore = {
  get: () => state,
  subscribe(f: () => void) {
    subs.add(f);
    return () => subs.delete(f);
  },
  setOptions(options: GameModeOptions) {
    set({ ...state, options, lastResult: undefined });
  },
  /** A backup restore replaces the key map the record describes: keep the options, forget the record. */
  restoreOptions(options: GameModeOptions | undefined) {
    set({ v: 1, options: options ?? state.options, active: null });
  },
  /** Record what game mode just changed on the keyboard (null: it's off), with notes for the card. */
  setActive(active: GameModeRecord | null, lastResult?: string[]) {
    set({ ...state, active, lastResult });
  },
  clearRecord() {
    set({ ...state, active: null });
  },
};

export function useGameMode() {
  return useSyncExternalStore(gameModeStore.subscribe, gameModeStore.get);
}

/** Game mode status against the keyboard as last read. */
export function useGameModeStatus(api: DeviceApi) {
  const s = useGameMode();
  return { ...s, status: gameModeStatus(s.active, api.snap?.matrix, api.snap?.profile) };
}

/** The WASD highlight colours from the "WASD gamer" gallery preset (loaded only when needed: the header toggle lives in the app shell). */
async function wasdColours(): Promise<Map<number, RGB>> {
  const { GALLERY } = await import('../presets/gallery');
  const p = GALLERY.find((g) => g.name === 'WASD gamer');
  return perKeyMap((p?.perKey ?? {}) as Record<number, RGB>);
}

/** Turn game mode on with the stored options. Reads the keyboard first, so nothing it changed meanwhile is overwritten. */
export function turnGameModeOn(api: DeviceApi) {
  const { dev, snap } = api;
  if (!dev || !snap) return Promise.resolve(undefined);
  return api.run('Turning game mode on', async () => {
    const matrix = await dev.readKeyMatrix();
    const profile = await dev.readProfile();
    const plan = planGameModeOn(matrix, profile, state.options);
    const keysChanged = plan.record.keys.length > 0;
    const profileChanged = plan.record.profile.length > 0;
    if (!keysChanged && !profileChanged && !plan.record.perKeyWritten) {
      set({ ...state, lastResult: plan.skipped.length ? plan.skipped : ['Nothing to change: pick at least one option.'] });
      return;
    }
    // Vendor order: key matrix → per-key pages → profile.
    if (keysChanged) await dev.writeKeyMatrix(plan.matrix);
    if (plan.record.perKeyWritten) await dev.writeLedMatrix(buildLedMatrix(await wasdColours()));
    if (profileChanged) await dev.writeProfile(plan.profile);
    const back = keysChanged ? await dev.readKeyMatrix() : matrix;
    api.setSnap({ ...snap, matrix: back, profile: profileChanged ? plan.profile : profile });
    gameModeStore.setActive(plan.record, plan.skipped);
    api.push({ dir: 'info', text: `Game mode on (${plan.record.keys.length} key${plan.record.keys.length === 1 ? '' : 's'} disabled)` });
  });
}

/** Turn game mode off: put back what it changed, unless something changed it since. */
export function turnGameModeOff(api: DeviceApi) {
  const { dev, snap } = api;
  const record = state.active;
  if (!dev || !snap || !record) return Promise.resolve(undefined);
  return api.run('Turning game mode off', async () => {
    const matrix = await dev.readKeyMatrix();
    const profile = await dev.readProfile();
    const plan = planGameModeOff(matrix, profile, record);
    const notes = [...plan.leftAsIs];
    const keysChanged = plan.matrix.some((b, i) => b !== matrix[i]);
    const profileChanged = plan.profile.some((b, i) => b !== profile[i]);
    if (keysChanged) await dev.writeKeyMatrix(plan.matrix);
    // The WASD colours overwrote the per-key memory, which can't be read back: if the effect goes back to
    // Self-define, rewrite the colours this browser's Per-key RGB editor holds.
    if (record.perKeyWritten && profileChanged && parseProfile(plan.profile).activeIndex === CUSTOM_MODE_INDEX) {
      const saved = loadPerKey();
      if (Object.keys(saved).length) await dev.writeLedMatrix(buildLedMatrix(perKeyMap(saved)));
      else notes.push("No Self-define colours are saved in this browser's Per-key RGB editor, so the WASD colours stay.");
    }
    if (profileChanged) await dev.writeProfile(plan.profile);
    const back = keysChanged ? await dev.readKeyMatrix() : matrix;
    api.setSnap({ ...snap, matrix: back, profile: profileChanged ? plan.profile : profile });
    gameModeStore.setActive(null, notes);
    api.push({ dir: 'info', text: `Game mode off${notes.length ? ` (${notes.length} note${notes.length > 1 ? 's' : ''})` : ''}` });
  });
}
