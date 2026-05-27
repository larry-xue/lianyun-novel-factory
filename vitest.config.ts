import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  // Vitest bundles its own Vite; the `tsconfigPaths` plugin types come
  // from a different Vite version. Cast keeps the types happy without
  // changing runtime behaviour.
  plugins: [tsconfigPaths() as never],
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    env: {
      NODE_ENV: 'test',
    },
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: true,
      },
    },
    hookTimeout: 30_000,
    testTimeout: 30_000,
    coverage: {
      reporter: ['text', 'html'],
      include: ['app/**/*.{ts,tsx}'],
      exclude: ['app/**/*.test.{ts,tsx}', 'app/routes/**'],
    },
  },
});
