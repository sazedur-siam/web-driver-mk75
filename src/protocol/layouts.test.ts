import { describe, expect, it } from 'vitest';
import { MK75_KEYS } from '../device/mk75Layout';
import { encodeAction } from './keycodes';
import { layoutActions } from './layouts';
import { vkToHid } from './mock';

const idx = (label: string) => MK75_KEYS.find((k) => k.label === label)!.index;
const usageAt = (m: ReturnType<typeof layoutActions>, label: string) => {
  const a = m.get(idx(label));
  return a?.kind === 'key' ? a.usage : undefined;
};
/** Keys whose action differs from the keyboard default. */
const changed = (m: ReturnType<typeof layoutActions>) =>
  MK75_KEYS.filter((k) => {
    const a = m.get(k.index);
    const d = vkToHid(k.vk);
    return a && d !== undefined && encodeAction(a) !== encodeAction({ kind: 'key', usage: d, mods: 0 });
  }).map((k) => k.label);

describe('layout presets', () => {
  it('QWERTY changes nothing', () => {
    expect(changed(layoutActions('qwerty'))).toEqual([]);
  });
  it('Colemak changes exactly 17 keys', () => {
    const m = layoutActions('colemak');
    expect(changed(m)).toHaveLength(17);
    expect(usageAt(m, 'E')).toBe(0x09); // F
    expect(usageAt(m, ';')).toBe(0x12); // O
    expect(usageAt(m, 'K')).toBe(0x08); // E
  });
  it('Dvorak moves punctuation too', () => {
    const m = layoutActions('dvorak');
    expect(usageAt(m, 'Q')).toBe(0x34); // '
    expect(usageAt(m, 'Z')).toBe(0x33); // ;
    expect(usageAt(m, '-')).toBe(0x2f); // [
    expect(usageAt(m, '/')).toBe(0x1d); // Z
  });
  it('tweaks: Mac swap and Caps Lock', () => {
    const m = layoutActions('qwerty', { macSwap: true, capsToCtrl: true });
    expect(usageAt(m, 'LWin')).toBe(0xe2);
    expect(usageAt(m, 'LAlt')).toBe(0xe3);
    expect(usageAt(m, 'RAlt')).toBe(0xe7);
    expect(usageAt(m, 'CapsLock')).toBe(0xe0);
    expect(usageAt(layoutActions('qwerty', { capsToEsc: true }), 'CapsLock')).toBe(0x29);
    // turning tweaks off restores defaults
    expect(changed(layoutActions('qwerty', {}))).toEqual([]);
  });
});
