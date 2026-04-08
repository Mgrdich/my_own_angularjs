import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    passWithNoTests: true,
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    exclude: ['legacy/**'],
    coverage: {
      provider: 'v8',
      thresholds: {
        lines: 90,
      },
    },
  },
});
