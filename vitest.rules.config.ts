import { defineConfig } from 'vitest/config';

// Emulator-backed tests. Run through `npm run test:rules`, which starts the Firestore emulator.
export default defineConfig({
  test: {
    include: ['tests/rules/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
