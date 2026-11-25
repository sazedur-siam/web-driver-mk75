/** The preset currently being previewed (from a share link or the gallery), plus link helpers. */
import { useSyncExternalStore } from 'react';
import { decodePreset, encodePreset, type Preset } from '../protocol/preset';

let pending: Preset | null = null;
let error: string | null = null;
let snapshot: { pending: Preset | null; error: string | null } = { pending, error };
const subs = new Set<() => void>();
const emit = () => {
  snapshot = { pending, error };
  subs.forEach((f) => f());
};

export const presetStore = {
  preview(p: Preset | null) {
    pending = p;
    error = null;
    emit();
  },
  dismiss() {
    pending = null;
    error = null;
    if (location.hash.startsWith('#p=')) history.replaceState(null, '', location.pathname + location.search);
    emit();
  },
};

export function usePendingPreset() {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => snapshot,
  );
}

/** Read a #p=… share link from the address bar (called once on start-up and on hash changes). */
export async function loadPresetFromHash() {
  const m = location.hash.match(/^#p=([A-Za-z0-9_-]+)$/);
  if (!m) return;
  try {
    pending = await decodePreset(m[1]);
    error = null;
  } catch (e) {
    pending = null;
    error = e instanceof Error ? e.message : String(e);
  }
  emit();
}

export async function shareLink(p: Preset): Promise<string> {
  return `${location.origin}${location.pathname}#p=${await encodePreset(p)}`;
}
