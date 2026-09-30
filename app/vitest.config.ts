import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    include: [
      'tests/unit/**/*.test.ts',
      'tests/unit/**/*.test.tsx',
      'tests/security/**/*.test.ts',
      'tests/integration/**/*.test.ts',
    ],
    exclude: ['tests/e2e/**', 'node_modules/**', '.next/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov'],
      // Only the lib/db layer. The 34 API route handlers, 16 pages and
      // 54 components are NOT in this denominator, so these numbers say
      // nothing about whether /api/nlqa/ask works. Widening it is a
      // separate piece of work — the current ratio would collapse.
      include: ['src/lib/**/*.ts', 'src/db/**/*.ts'],
      exclude: ['**/*.test.ts', '**/*.d.ts', 'src/lib/env.ts'],
      thresholds: {
        // Measured with `pnpm test:coverage` and set slightly BELOW the
        // real numbers so the gate is green today and fails on a
        // regression. They used to sit at 70/65/70/70 and had never
        // been enforced, because CI ran `vitest run` without
        // `--coverage`; the functions threshold was 2.2 points above
        // actual (67.8%), so wiring it up as-is would have failed the
        // merge gate on the first run.
        statements: 70, // actual 71.63
        branches: 75,  // actual 79.33
        functions: 65, // actual 67.80
        lines: 70,     // actual 71.63
      },
    },
    testTimeout: 30000,  // 30s para tests con Testcontainers
    hookTimeout: 60000, // 60s para setup de Testcontainers Postgres
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@lib': path.resolve(__dirname, './src/lib'),
      '@db': path.resolve(__dirname, './src/db'),
      '@components': path.resolve(__dirname, './src/components'),
      '@hooks': path.resolve(__dirname, './src/hooks'),
      '@stores': path.resolve(__dirname, './src/stores'),
      '@types': path.resolve(__dirname, './src/types'),
      '@tests': path.resolve(__dirname, './tests'),
    },
  },
});