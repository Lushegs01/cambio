import { defineConfig } from 'vitest/config';
import base from './vitest.config.ts';

/** Read-only checks against the live Mezo Testnet. Kept out of `npm test`, which is network-free. */
export default defineConfig({
  ...base,
  test: { ...base.test, include: ['tests/live/**/*.live.test.ts'], exclude: ['node_modules/**'], testTimeout: 60_000 },
});
