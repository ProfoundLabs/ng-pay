import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    extensions: ['.ts', '.js'],
    alias: {
      // Point @ng-pay/core to its TypeScript source during tests
      '@ng-pay/core': path.resolve(__dirname, '../core/src/index.ts'),
    },
  },
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      reporter: ['text', 'json'],
    },
  },
});
