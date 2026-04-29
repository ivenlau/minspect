import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Vite builds the SPA shell into `dist/spa/`. The `@minspect/ui` server
// helper (src/index.ts → dist/index.js) reads `dist/spa/index.html` and
// surfaces it to the collector. Relative `base: './'` is required so JS/CSS
// asset URLs resolve correctly under any hash-router path.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist/spa',
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      output: {
        // Keep predictable asset names so the collector can cache-control them
        // on hash. (The SPA entry index.html is always fresh.)
        assetFileNames: 'assets/[name]-[hash][extname]',
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
      },
    },
  },
  server: {
    port: 5173,
    // During development the collector still serves /api; proxy so the SPA
    // can fetch('/api/...') without CORS noise.
    proxy: {
      '/api': 'http://127.0.0.1:3000',
      '/events': 'http://127.0.0.1:3000',
    },
  },
});
