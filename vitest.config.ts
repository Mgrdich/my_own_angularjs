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
      '@exception-handler': path.resolve(__dirname, 'src/exception-handler'),
      '@filter': path.resolve(__dirname, 'src/filter'),
      '@compiler': path.resolve(__dirname, 'src/compiler'),
      '@template': path.resolve(__dirname, 'src/template'),
      '@controller': path.resolve(__dirname, 'src/controller'),
      '@bootstrap': path.resolve(__dirname, 'src/bootstrap'),
      '@async': path.resolve(__dirname, 'src/async'),
      '@cache': path.resolve(__dirname, 'src/cache'),
      '@http': path.resolve(__dirname, 'src/http'),
      '@forms': path.resolve(__dirname, 'src/forms'),
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
