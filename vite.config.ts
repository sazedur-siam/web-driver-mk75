import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { injectPrecache } from './src/build/swPrecache';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

/** Writes the build's asset list and id into dist/sw.js (see src/build/swPrecache.ts). */
function swPrecache(): Plugin {
  let outDir = 'dist';
  let assets: string[] = [];
  return {
    name: 'sw-precache',
    apply: 'build',
    configResolved(c) {
      outDir = resolve(c.root, c.build.outDir);
    },
    generateBundle(_options, bundle) {
      assets = Object.keys(bundle);
    },
    // After Vite has copied public/ (sw.js) into the output folder.
    closeBundle() {
      const file = resolve(outDir, 'sw.js');
      writeFileSync(file, injectPrecache(readFileSync(file, 'utf8'), assets));
    },
  };
}

// WebHID requires a secure context: localhost (dev) or HTTPS (deployed).
export default defineConfig({
  plugins: [react(), swPrecache()],
  base: './',
  define: {
    // Shown in issue-report diagnostics.
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
});
