import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { pwa } from './scripts/pwa-plugin.ts';

export default defineConfig({
  // Relative, so a build works from a subdirectory or a file:// path as well as
  // from a domain root. A local-first app should not assume where it is served.
  base: './',
  plugins: [react(), tailwindcss(), pwa()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
