import { defineConfig } from 'vitest/config';

// Two projects:
//  - "node": the default environment for pure-logic and CLI tests (src/**/*.test.ts).
//  - "dom": happy-dom environment for OSMD / musicxml render tests (src/**/*.dom.test.ts).
// The DOM tests are matched FIRST and excluded from the node project so a *.dom.test.ts
// file runs only once, under happy-dom.
export default defineConfig({
  test: {
    testTimeout: 120_000, // the M2 1,000-line property test is slow
    passWithNoTests: true, // scaffold has no tests yet; M1 adds the first ones
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
    },
    projects: [
      {
        extends: true,
        test: {
          name: { label: 'node', color: 'green' },
          environment: 'node',
          include: ['src/**/*.test.ts'],
          exclude: ['src/**/*.dom.test.ts', '**/node_modules/**'],
        },
      },
      {
        extends: true,
        test: {
          name: { label: 'dom', color: 'cyan' },
          environment: 'happy-dom',
          include: ['src/**/*.dom.test.ts'],
          exclude: ['**/node_modules/**'],
        },
      },
    ],
  },
});
