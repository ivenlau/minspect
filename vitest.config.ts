import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    passWithNoTests: true,
    include: ['src/**/*.{test,spec}.ts'],
    // Serialize tests: parallel git subprocess calls across workers are flaky
    // on Windows. Single-fork trades a bit of wall-clock for stability.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
