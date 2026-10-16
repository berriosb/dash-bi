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
        // regression.
        //
        // RE-BASELINED for vitest 4 (2026-10-16). The previous values
        // (70/75/65/70) were measured with vitest 3's v8 provider and are
        // NOT comparable to what vitest 4 reports — the jump was a change
        // in the measuring instrument, not a loss of tests. Evidence, same
        // 91 files in the report, modules untouched by the change:
        //
        //   file                          vitest 3   vitest 4
        //   widgets/archetypes.ts              477        23
        //   templates/catalog.ts               370         5
        //   widgets/atomic-patterns.ts         189        10
        //
        // Those are constant modules; their source did not change. Across
        // the 66 files untouched by this branch, statement totals went
        // 3726 → 1094 (0.29x) while branch totals went UP (1129 → 1604),
        // which is what a different instrumentation model looks like.
        //
        // So the real measurement moved, and the gate has to follow it.
        // The old numbers would have required writing ~230 extra branch
        // assertions to satisfy a denominator that no longer describes
        // this codebase. New values are still set just below actual, so a
        // regression of the same magnitude keeps failing the gate.
        //
        // Any future vitest/coverage-provider upgrade invalidates these
        // numbers again: re-measure both trees before changing them.
        statements: 67, // actual 67.72
        branches: 60,  // actual 60.84
        functions: 62, // actual 62.72
        lines: 68,     // actual 69.15
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