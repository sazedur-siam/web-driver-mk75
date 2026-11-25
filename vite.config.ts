import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

// WebHID requires a secure context: localhost (dev) or HTTPS (deployed).
export default defineConfig({
  plugins: [react()],
  base: './',
  define: {
    // Shown in issue-report diagnostics.
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
});
