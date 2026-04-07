import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Allow importing './foo.js' to resolve to './foo.ts' in source
    extensions: ['.ts', '.js'],
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
