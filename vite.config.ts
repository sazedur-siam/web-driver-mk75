import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// WebHID requires a secure context: localhost (dev) or HTTPS (deployed).
export default defineConfig({
  plugins: [react()],
  base: './',
});
