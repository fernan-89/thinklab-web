/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The browser only ever talks to /api; the dev server (and nginx in the container) forwards it to the platform
// gateway and strips the prefix, so the app needs no CORS setup and no gateway URL baked into the bundle.
const gateway = process.env.THINKLAB_GATEWAY_URL ?? 'http://localhost:8088';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: gateway, changeOrigin: true, rewrite: (path) => path.replace(/^\/api/, '') },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
  },
});
