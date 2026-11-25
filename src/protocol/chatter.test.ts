import { describe, expect, it } from 'vitest';
import { keyIndexForCode } from '../device/codeMap';
import { ChatterDetector } from './chatter';

describe('chatter detector', () => {
  it('flags a re-press within the threshold', () => {
    const d = new ChatterDetector(30);
    expect(d.keyDown(8, 0)).toBeNull();
    d.keyUp(8, 60);
    expect(d.keyDown(8, 72)).toBe(12); // 12 ms after release → chatter
    d.keyUp(8, 140);
    expect(d.keyDown(8, 400)).toBeNull(); // normal second press
    expect(d.keys.get(8)!.presses).toBe(3);
    expect(d.chattering).toEqual([{ key: 8, gaps: [12] }]);
  });
  it('ignores OS auto-repeat and tracks hold time', () => {
    const d = new ChatterDetector();
    d.keyDown(5, 0);
    expect(d.keyDown(5, 500)).toBeNull(); // repeat while held
    d.keyUp(5, 800);
    expect(d.keys.get(5)!.presses).toBe(1);
    expect(d.keys.get(5)!.longestHold).toBe(800);
  });
  it('maps KeyboardEvent.code to MK75 keys', () => {
    expect(keyIndexForCode('Escape')).toBe(0);
    expect(keyIndexForCode('KeyQ')).toBe(8);
    expect(keyIndexForCode('ShiftRight')).toBeDefined();
    expect(keyIndexForCode('Numpad1')).toBeUndefined(); // not on a 75% board
  });
});
