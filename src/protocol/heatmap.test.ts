import { describe, expect, it } from 'vitest';
import { heatColour, heatmapColours, scoreTyping, wpm } from './heatmap';

describe('typing heatmap', () => {
  it('heat scale goes from cold blue to hot red', () => {
    expect(heatColour(0)).toEqual([20, 40, 160]);
    expect(heatColour(1)).toEqual([255, 40, 20]);
  });
  it('most-used key is hottest, unused keys are left out', () => {
    const m = heatmapColours({ 1: 100, 2: 1, 3: 0 });
    expect(m[1]).toEqual([255, 40, 20]);
    expect(m[2][2]).toBeGreaterThan(m[2][0]); // cooler (bluer) for rarely used keys
    expect(m[3]).toBeUndefined();
  });
  it('WPM and accuracy', () => {
    expect(wpm(250, 60_000)).toBe(50);
    expect(scoreTyping('hello', 'hxllo')).toEqual({ correct: 4, accuracy: 80 });
    expect(scoreTyping('abc', '')).toEqual({ correct: 0, accuracy: 100 });
  });
});
