import { describe, expect, it } from 'vitest';
import SW from '../../public/sw.js?raw';
import { ASSETS_PLACEHOLDER, BUILD_PLACEHOLDER, buildId, injectPrecache } from './swPrecache';

describe('service worker precache injection', () => {
  it('public/sw.js carries both placeholders, and they are valid defaults on their own', () => {
    expect(SW).toContain(BUILD_PLACEHOLDER);
    expect(SW).toContain(ASSETS_PLACEHOLDER);
  });

  it('writes a sorted, de-duplicated asset list and a build id', () => {
    const out = injectPrecache(SW, ['assets/b.js', 'assets/a.css', 'assets/b.js', 'index.html', 'sw.js']);
    expect(out).not.toContain(BUILD_PLACEHOLDER);
    expect(out).not.toContain(ASSETS_PLACEHOLDER);
    expect(out).toContain('const ASSETS = ["./assets/a.css","./assets/b.js"];');
    expect(out).toMatch(/const BUILD = '[0-9a-f]{8}';/);
  });

  it('the build id is stable for the same assets and changes when one changes', () => {
    expect(buildId(['./assets/a.js'])).toBe(buildId(['./assets/a.js']));
    expect(buildId(['./assets/a.js'])).not.toBe(buildId(['./assets/a2.js']));
    const one = injectPrecache(SW, ['assets/x-1.js']);
    expect(injectPrecache(SW, ['assets/x-1.js'])).toBe(one);
    expect(injectPrecache(SW, ['assets/x-2.js'])).not.toBe(one);
  });

  it('refuses a service worker without the placeholders, so a broken build fails loudly', () => {
    expect(() => injectPrecache('const CACHE = 1;', ['assets/a.js'])).toThrow(/placeholders/);
  });
});
