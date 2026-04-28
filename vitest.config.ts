import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@core': path.resolve(__dirname, 'src/core'),
      '@parser': path.resolve(__dirname, 'src/parser'),
      '@di': path.resolve(__dirname, 'src/di'),
      '@interpolate': path.resolve(__dirname, 'src/interpolate'),
      '@sce': path.resolve(__dirname, 'src/sce'),
      '@sanitize': path.resolve(__dirname, 'src/sanitize'),
    },
  },
  test: {
    passWithNoTests: true,
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      thresholds: {
        lines: 90,
      },
    },
  },
});
