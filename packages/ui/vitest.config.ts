import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: false,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    passWithNoTests: true,
    // @fontsource CSS side-effect imports need to be handled in jsdom.
    css: false,
  },
});
