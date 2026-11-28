/**
 * Build step for public/sw.js (run by the `sw-precache` plugin in vite.config.ts): writes the build's asset list
 * and a build id into the service worker. Two effects:
 *  - every chunk is precached at install, so lazily loaded tabs open offline even if never visited online;
 *  - sw.js changes on every deploy that changes code, so browsers install the new worker and the app's
 *    "A new version is available" notice appears (before, sw.js only changed when someone bumped the cache name).
 * No Node or DOM imports: unit-tested in swPrecache.test.ts.
 */
export const BUILD_PLACEHOLDER = "const BUILD = 'dev';";
export const ASSETS_PLACEHOLDER = 'const ASSETS = [];';

/** FNV-1a, 32-bit, as 8 hex digits: a short, stable id for the asset list. */
export function buildId(assets: readonly string[]): string {
  let h = 0x811c9dc5;
  for (const ch of assets.join('\n')) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** Replace both placeholders. `assets` are output paths such as `assets/index-abc.js`. Throws if a placeholder is missing. */
export function injectPrecache(sw: string, assets: readonly string[]): string {
  if (!sw.includes(BUILD_PLACEHOLDER) || !sw.includes(ASSETS_PLACEHOLDER)) {
    throw new Error('sw-precache: public/sw.js no longer contains the BUILD/ASSETS placeholders');
  }
  const list = [...new Set(assets)].filter((a) => a.startsWith('assets/')).sort().map((a) => `./${a}`);
  return sw
    .replace(BUILD_PLACEHOLDER, `const BUILD = '${buildId(list)}';`)
    .replace(ASSETS_PLACEHOLDER, `const ASSETS = ${JSON.stringify(list)};`);
}
