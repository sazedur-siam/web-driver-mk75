import { describe, expect, it } from 'vitest';
import { MK75_KEYS } from '../device/mk75Layout';
import {
  DEFAULT_GAME_MODE,
  GAME_KEYS,
  P_SLEEP,
  describeOptions,
  gameModeStatus,
  parseOptions,
  parseRecord,
  planGameModeOff,
  planGameModeOn,
  type GameModeOptions,
} from './gameMode';
import { getKeyCode, setKeyCode } from './keycodes';
import { CUSTOM_MODE_INDEX, parseProfile } from './lighting';
import { Mk75 } from './mk75';
import { MockMk75 } from './mock';
import { WirelessLink } from './wireless/link';
import { MockWirelessIO } from './wireless/mockWireless';
import { Mk75Wireless } from './wireless/mk75Wireless';

const WIN = GAME_KEYS.win!;
const CAPS = GAME_KEYS.caps!;
const ALL: GameModeOptions = { disableWin: true, disableCaps: true, neverSleep: true, lighting: 'wasd' };

const fresh = () => {
  const mock = new MockMk75();
  return { mock, matrix: new Uint8Array(mock.matrix), profile: new Uint8Array(mock.profile) };
};
const differing = (a: Uint8Array, b: Uint8Array) => [...a].flatMap((v, i) => (v !== b[i] ? [i] : []));

describe('game mode planning', () => {
  it('disables Win and Caps Lock and records both values', () => {
    const { matrix, profile } = fresh();
    const plan = planGameModeOn(matrix, profile, DEFAULT_GAME_MODE);
    expect(getKeyCode(plan.matrix, WIN)).toBe(0);
    expect(getKeyCode(plan.matrix, CAPS)).toBe(0);
    expect(plan.record.keys).toEqual([
      { index: WIN, before: getKeyCode(matrix, WIN), after: 0 },
      { index: CAPS, before: getKeyCode(matrix, CAPS), after: 0 },
    ]);
    expect(plan.record.profile).toEqual([]);
    expect([...plan.profile]).toEqual([...profile]); // keys only: no lighting write
  });

  it('writes Caps Lock through its Fn redirect and never changes the redirect word', () => {
    const { matrix, profile } = fresh();
    const redirectWord = new DataView(matrix.buffer).getUint32(CAPS * 4, true);
    expect(redirectWord & 0xff).toBe(0x02); // the simulator models CapsLock as a redirect slot
    const plan = planGameModeOn(matrix, profile, DEFAULT_GAME_MODE);
    expect(new DataView(plan.matrix.buffer).getUint32(CAPS * 4, true)).toBe(redirectWord);
    expect(new DataView(plan.matrix.buffer).getUint32(0x84 * 4, true)).toBe(0);
    // Only the two target slots changed anywhere in the 1024-byte matrix.
    const slots = new Set(differing(matrix, plan.matrix).map((i) => i >> 2));
    expect([...slots].sort((a, b) => a - b)).toEqual([WIN, 0x84].sort((a, b) => a - b));
  });

  it('never sleep changes only the sleep byte', () => {
    const { matrix, profile } = fresh();
    const plan = planGameModeOn(matrix, profile, { ...DEFAULT_GAME_MODE, disableWin: false, disableCaps: false, neverSleep: true });
    expect(differing(profile, plan.profile)).toEqual([P_SLEEP]);
    expect(plan.profile[P_SLEEP]).toBe(0xff);
    expect(plan.record.profile).toEqual([{ at: P_SLEEP, before: profile[P_SLEEP], after: 0xff }]);
  });

  it('WASD lighting switches to Self-define through patchProfile and records every byte it changed', () => {
    const { matrix, profile } = fresh();
    const plan = planGameModeOn(matrix, profile, { ...DEFAULT_GAME_MODE, lighting: 'wasd' });
    expect(parseProfile(plan.profile).activeIndex).toBe(CUSTOM_MODE_INDEX);
    expect(plan.record.perKeyWritten).toBe(true);
    expect(plan.record.profile.map((b) => b.at)).toEqual(differing(profile, plan.profile));
  });

  it('skips keys holding firmware functions or already disabled, and says why', () => {
    const { profile } = fresh();
    let matrix = setKeyCode(fresh().matrix, WIN, 0x01000007); // device function (Win lock)
    matrix = setKeyCode(matrix, CAPS, 0);
    const plan = planGameModeOn(matrix, profile, DEFAULT_GAME_MODE);
    expect(plan.record.keys).toEqual([]);
    expect(plan.skipped).toEqual(['Win holds a keyboard function and was left alone', 'Caps Lock was already disabled']);
    expect([...plan.matrix]).toEqual([...matrix]);
  });

  it('on then off gives back the exact matrix and profile', () => {
    const { matrix, profile } = fresh();
    const on = planGameModeOn(matrix, profile, ALL);
    const off = planGameModeOff(on.matrix, on.profile, on.record);
    expect([...off.matrix]).toEqual([...matrix]);
    expect([...off.profile]).toEqual([...profile]);
    expect(off.leftAsIs).toEqual([]);
  });

  it('leaves a key the user changed since, and still restores the rest', () => {
    const { matrix, profile } = fresh();
    const on = planGameModeOn(matrix, profile, DEFAULT_GAME_MODE);
    const userCode = 0x00e00000 >>> 0; // something else on Caps Lock
    const edited = setKeyCode(on.matrix, CAPS, userCode);
    const off = planGameModeOff(edited, on.profile, on.record);
    expect(getKeyCode(off.matrix, WIN)).toBe(getKeyCode(matrix, WIN));
    expect(getKeyCode(off.matrix, CAPS)).toBe(userCode);
    expect(off.leftAsIs).toEqual(['Caps Lock was changed after game mode started, so it was left as it is']);
  });

  it('restores the sleep timer even if the lighting was changed since, and leaves that lighting alone', () => {
    const { matrix, profile } = fresh();
    const on = planGameModeOn(matrix, profile, ALL);
    const changed = new Uint8Array(on.profile);
    changed[0x05] = 3; // the user picked another effect with Fn + \
    const off = planGameModeOff(on.matrix, changed, on.record);
    expect(off.profile[P_SLEEP]).toBe(profile[P_SLEEP]);
    expect(off.profile[0x05]).toBe(3);
    expect(off.leftAsIs).toEqual(['The lighting was changed after game mode started, so it was left as it is']);
  });

  it('refuses records that name the Fn key, the knob slot or an unrelated profile byte', () => {
    const { matrix, profile } = fresh();
    const fn = MK75_KEYS.find((k) => k.vk === 0xfa)!.index;
    const base = { since: 'x', profile: [], perKeyWritten: false };
    expect(() => planGameModeOff(matrix, profile, { ...base, keys: [{ index: fn, before: 0x20, after: 0 }] })).toThrow();
    expect(() => planGameModeOff(matrix, profile, { ...base, keys: [{ index: 90, before: 0x14000007, after: 0 }] })).toThrow();
    expect(() => planGameModeOff(matrix, profile, { ...base, keys: [], profile: [{ at: 0x60, before: 1, after: 2 }] })).toThrow();
    expect(parseRecord({ ...base, keys: [{ index: 90, before: 1, after: 0 }] })).toBeNull();
  });

  it('status: on, partial or off against the keyboard', () => {
    const { matrix, profile } = fresh();
    const on = planGameModeOn(matrix, profile, DEFAULT_GAME_MODE);
    expect(gameModeStatus(on.record, on.matrix, on.profile)).toBe('on');
    expect(gameModeStatus(on.record, setKeyCode(on.matrix, WIN, 5), on.profile)).toBe('partial');
    expect(gameModeStatus(on.record, matrix, profile)).toBe('off');
    expect(gameModeStatus(null, on.matrix, on.profile)).toBe('off');
  });

  it('stored values are validated', () => {
    const { matrix, profile } = fresh();
    const r = planGameModeOn(matrix, profile, ALL).record;
    expect(parseRecord(JSON.parse(JSON.stringify(r)))).toEqual(r);
    expect(parseRecord({ ...r, keys: 'x' })).toBeNull();
    expect(parseOptions(ALL)).toEqual(ALL);
    expect(parseOptions({ ...ALL, lighting: 'disco' })).toBeNull();
    expect(describeOptions(ALL)).toBe('Win and Caps Lock off · never sleeps · WASD lighting');
  });
});

describe('game mode round trip on the simulators', () => {
  it('USB: on then off leaves the keyboard byte-identical', async () => {
    const mock = new MockMk75();
    const dev = new Mk75(mock, { readDelayMs: 0, writeDelayMs: 0 });
    const startMatrix = new Uint8Array(mock.matrix);
    const startProfile = new Uint8Array(mock.profile);
    const on = planGameModeOn(await dev.readKeyMatrix(), await dev.readProfile(), ALL);
    await dev.writeKeyMatrix(on.matrix);
    await dev.writeProfile(on.profile);
    expect(mock.matrix[WIN * 4 + 3]).toBe(0);
    const off = planGameModeOff(await dev.readKeyMatrix(), await dev.readProfile(), on.record);
    await dev.writeKeyMatrix(off.matrix);
    await dev.writeProfile(off.profile);
    expect([...mock.matrix]).toEqual([...startMatrix]);
    expect([...mock.profile]).toEqual([...startProfile]);
  });

  it('2.4 GHz: on then off leaves the key layer and LED block as they were', async () => {
    const io = new MockWirelessIO();
    const dev = new Mk75Wireless(new WirelessLink(io, 0x13, undefined, { pace: 0, livePace: 0, ackMs: 300, readMs: 300 }), '3632');
    const matrix = await dev.readKeyMatrix();
    const profile = await dev.readProfile();
    const startLayer = new Uint8Array(io.layers[0]);
    const startLed = new Uint8Array(io.led);
    const on = planGameModeOn(matrix, profile, { ...DEFAULT_GAME_MODE, neverSleep: true });
    await dev.writeKeyMatrix(on.matrix);
    await dev.writeProfile(on.profile);
    expect(io.led[0x18]).toBe(0); // layout B: sleep 0 = never
    expect(gameModeStatus(on.record, await dev.readKeyMatrix(), await dev.readProfile())).toBe('on');
    const off = planGameModeOff(await dev.readKeyMatrix(), await dev.readProfile(), on.record);
    await dev.writeKeyMatrix(off.matrix);
    await dev.writeProfile(off.profile);
    expect([...io.layers[0]]).toEqual([...startLayer]);
    expect([...io.led]).toEqual([...startLed]);
  });
});
