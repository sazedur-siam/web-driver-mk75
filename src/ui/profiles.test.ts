import { describe, expect, it } from 'vitest';
import { MK75_KEYS } from '../device/mk75Layout';
import { encodeAction, getKeyCode, setKeyCode } from '../protocol/keycodes';
import { parseProfile, patchProfile } from '../protocol/lighting';
import { MockMk75 } from '../protocol/mock';
import { Mk75 } from '../protocol/mk75';
import { WirelessLink } from '../protocol/wireless/link';
import { MockWirelessIO } from '../protocol/wireless/mockWireless';
import { Mk75Wireless } from '../protocol/wireless/mk75Wireless';
import { applyProfile, captureProfile } from './applyProfile';
import { macroStore } from './macroStore';
import { validateProfile } from './profileStore';
import { withMacroCodes } from './saveKeys';
import type { DeviceSnapshot } from './useDevice';

const read = async (d: { readProfile(): Promise<Uint8Array>; readKeyMatrix(): Promise<Uint8Array>; readRgbTable(): Promise<Uint8Array> }): Promise<DeviceSnapshot> => ({
  profile: await d.readProfile(),
  matrix: await d.readKeyMatrix(),
  rgbTable: await d.readRgbTable(),
});

describe('profiles', () => {
  it('apply restores a changed keyboard, and re-applying writes nothing', async () => {
    macroStore.replaceAll({ macros: [], assignments: {} });
    const mock = new MockMk75();
    const dev = new Mk75(mock, { readDelayMs: 0, writeDelayMs: 0 });
    let snap = await read(dev);
    const work = captureProfile('Work', snap);

    // Change the keyboard: Respire + remap Caps Lock.
    const st = parseProfile(snap.profile);
    st.activeIndex = 1;
    await dev.writeProfile(patchProfile(snap.profile, st));
    await dev.writeKeyMatrix(setKeyCode(snap.matrix, 3, encodeAction({ kind: 'key', usage: 0x29, mods: 0 })));
    snap = await read(dev);
    expect(parseProfile(snap.profile).activeIndex).toBe(1);

    const res = await applyProfile(dev, snap, work);
    expect(res.wrote).toEqual(['key mapping', 'lighting']);
    expect(parseProfile(res.snap.profile).activeIndex).toBe(0);
    expect(getKeyCode(res.snap.matrix, 3)).toBe(0x39000000); // Caps Lock back

    const before = mock.writes.length;
    const again = await applyProfile(dev, res.snap, work);
    expect(again.wrote).toEqual([]);
    expect(mock.writes.length).toBe(before);
  });

  it('skips macros over wireless but applies the rest', async () => {
    const io = new MockWirelessIO();
    const dev = new Mk75Wireless(new WirelessLink(io, 0x15, undefined, { pace: 0, livePace: 0, ackMs: 300, readMs: 300 }), 'combo');
    dev.setLiveLeds(MK75_KEYS.map((k) => k.index));
    const snap = await read(dev);
    const p = captureProfile('Wireless', snap);
    p.macros = { macros: [{ id: 'm', name: 'M', events: [{ usage: 4, down: true, delay: 5 }] }], assignments: { 46: { macroId: 'm', mode: 1 } } };
    const st = parseProfile(snap.profile);
    st.activeIndex = 2;
    p.profile = [...patchProfile(snap.profile, st)].map((b) => b.toString(16).padStart(2, '0')).join('');
    const res = await applyProfile(dev, snap, p);
    expect(res.skipped[0]).toMatch(/macros/);
    expect(res.wrote).toContain('lighting');
    expect(io.led[0x0a]).toBe(3); // Rainbow hw id
  });

  it('a cable profile with macro keys still applies over wireless', async () => {
    const io = new MockWirelessIO();
    const dev = new Mk75Wireless(new WirelessLink(io, 0x15, undefined, { pace: 0, livePace: 0, ackMs: 300, readMs: 300 }), 'combo');
    const snap = await read(dev);
    const p = captureProfile('Cable', snap);
    p.keyMatrix = [...setKeyCode(snap.matrix, 46, 0x00010010)].map((b) => b.toString(16).padStart(2, '0')).join(''); // macro ref on M (index 46)
    p.macros = { macros: [{ id: 'm', name: 'M', events: [] }], assignments: { 46: { macroId: 'm', mode: 1 } } };
    const res = await applyProfile(dev, snap, p);
    expect(res.skipped[0]).toMatch(/macros/);
    expect(new DataView(io.layers[0].buffer).getUint32(46 * 4, true)).toBe(0x10000000); // M keeps its normal key code
  });

  it('validates imported profiles', () => {
    expect(() => validateProfile({ name: 'x', profile: '00', rgbTable: '', keyMatrix: '' })).toThrow(/lighting/);
    const ok = validateProfile({ name: ' Gaming ', profile: '00'.repeat(254), rgbTable: '00'.repeat(1024), keyMatrix: '00'.repeat(1024) });
    expect(ok.name).toBe('Gaming');
    expect(ok.macros.macros).toEqual([]);
    // Macros without an assignments map would crash the Macros/Key mapping tabs on every reload.
    const bad = validateProfile({ name: 'x', profile: '00'.repeat(254), rgbTable: '00'.repeat(1024), keyMatrix: '00'.repeat(1024), macros: { macros: [] } as never });
    expect(bad.macros).toEqual({ macros: [], assignments: {} });
  });

  it('a 0x15 receiver saves key maps without touching macros', async () => {
    const io = new MockWirelessIO();
    const dev = new Mk75Wireless(new WirelessLink(io, 0x15, undefined, { pace: 0, livePace: 0, ackMs: 200, readMs: 200 }), 'combo');
    macroStore.replaceAll({ macros: [{ id: 'm', name: 'M', events: [{ usage: 4, down: true, delay: 5 }] }], assignments: { 9: { macroId: 'm', mode: 1 } } });
    const snap = await read(dev);
    const { matrix, plan } = withMacroCodes(setKeyCode(snap.matrix, 3, encodeAction({ kind: 'key', usage: 5, mods: 0 })), dev.caps.macros, snap.matrix);
    expect(plan.pages).toEqual([]);
    expect(getKeyCode(matrix, 9)).toBe(getKeyCode(snap.matrix, 9)); // macro key keeps the keyboard's code
    await dev.writeKeyMatrix(matrix);
    macroStore.replaceAll({ macros: [], assignments: {} });
  });
});
