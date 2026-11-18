import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

// Reuses plugins and `define` (__APP_VERSION__) from vite.config.ts (SCRUM-92).
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      // Only used with `npm run test:coverage` (SCRUM-108). Thresholds sit a little below the
      // baseline when added (statements 92.5, branches 85.5, functions 89.2, lines 93.9), so
      // CI fails on a real drop but not on noise.
      coverage: {
        provider: 'v8',
        include: ['src/**/*.{ts,tsx}'],
        exclude: ['src/**/*.test.{ts,tsx}', 'src/test/**', 'src/**/*.d.ts'],
        reporter: ['text-summary', 'lcov'],
        thresholds: { statements: 90, branches: 82, functions: 86, lines: 91 },
      },
    },
  }),
);
