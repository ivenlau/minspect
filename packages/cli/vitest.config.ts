import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Sandbox HOME/USERPROFILE/LOCALAPPDATA/XDG_* for every test file —
    // the suite must never touch real user state (see test-setup.ts).
    setupFiles: ['./test-setup.ts'],
  },
});
