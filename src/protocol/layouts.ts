/**
 * Hardware layout presets: the keyboard itself sends Colemak/Dvorak/… usages, so the layout works on any
 * computer set to US QWERTY. Maps are "QWERTY key position → character it should produce".
 */
import { MK75_KEYS } from '../device/mk75Layout';
import { vkToHid } from './vk';
import type { KeyAction } from './keycodes';
import { charUsage } from './textMacro';

export interface LayoutPreset {
  id: string;
  name: string;
  /** QWERTY position (lowercase char) → produced char. Positions not listed keep QWERTY. */
  map: Record<string, string>;
}

const zip = (from: string, to: string): Record<string, string> => {
  const m: Record<string, string> = {};
  [...from].forEach((c, i) => {
    if (to[i] !== c) m[c] = to[i];
  });
  return m;
};

const QWERTY_ROWS = ['qwertyuiop[]', "asdfghjkl;'", 'zxcvbnm,./', '-='];

export const LAYOUTS: LayoutPreset[] = [
  { id: 'qwerty', name: 'QWERTY (default)', map: {} },
  {
    id: 'colemak',
    name: 'Colemak',
    map: { ...zip('qwertyuiop', 'qwfpgjluy;'), ...zip('asdfghjkl;', 'arstdhneio'), ...zip('zxcvbnm', 'zxcvbkm') },
  },
  {
    id: 'colemak-dh',
    name: 'Colemak-DH (ANSI)',
    map: { ...zip('qwertyuiop', 'qwfpbjluy;'), ...zip('asdfghjkl;', 'arstgmneio'), ...zip('zxcvbnm', 'zxcdvkh') },
  },
  {
    id: 'dvorak',
    name: 'Dvorak',
    map: {
      ...zip(QWERTY_ROWS[0], "',.pyfgcrl/="),
      ...zip(QWERTY_ROWS[1], 'aoeuidhtns-'),
      ...zip(QWERTY_ROWS[2], ';qjkxbmwvz'),
      ...zip(QWERTY_ROWS[3], '[]'),
    },
  },
  {
    id: 'workman',
    name: 'Workman',
    map: { ...zip('qwertyuiop', 'qdrwbjfup;'), ...zip('asdfghjkl;', 'ashtgyneoi'), ...zip('zxcvbnm', 'zxmcvkl') },
  },
];

export interface LayoutTweaks {
  /** Bottom row reads Ctrl · Option · Cmd like a Mac keyboard (swap LWin/LAlt; RAlt → Right Cmd). */
  macSwap?: boolean;
  capsToCtrl?: boolean;
  capsToEsc?: boolean;
}

const byLabel = new Map(MK75_KEYS.map((k) => [k.label.toLowerCase(), k]));
const key = (usage: number): KeyAction => ({ kind: 'key', usage, mods: 0 });

/** The full set of key actions a layout + tweaks produces (QWERTY positions reset to defaults first). */
export function layoutActions(layoutId: string, tweaks: LayoutTweaks = {}): Map<number, KeyAction> {
  const preset = LAYOUTS.find((l) => l.id === layoutId) ?? LAYOUTS[0];
  const out = new Map<number, KeyAction>();
  for (const pos of QWERTY_ROWS.join('')) {
    const k = byLabel.get(pos);
    const usage = charUsage(preset.map[pos] ?? pos);
    if (k && usage !== undefined) out.set(k.index, key(usage));
  }
  const set = (label: string, usage: number) => {
    const k = byLabel.get(label.toLowerCase());
    if (k) out.set(k.index, key(usage));
  };
  // Tweakable keys start from their defaults so un-ticking a tweak restores them.
  for (const label of ['LWin', 'LAlt', 'RAlt', 'CapsLock']) {
    const k = byLabel.get(label.toLowerCase());
    const hid = k ? vkToHid(k.vk) : undefined;
    if (k && hid !== undefined) out.set(k.index, key(hid));
  }
  if (tweaks.macSwap) {
    set('LWin', 0xe2); // Option
    set('LAlt', 0xe3); // Command
    set('RAlt', 0xe7); // Right Command
  }
  if (tweaks.capsToCtrl) set('CapsLock', 0xe0);
  else if (tweaks.capsToEsc) set('CapsLock', 0x29);
  return out;
}
