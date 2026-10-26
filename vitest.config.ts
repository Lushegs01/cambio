import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, '.'),
      'cross-fetch': path.resolve(import.meta.dirname, 'src/shims/cross-fetch.ts'),
    },
  },
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    exclude: ['tests/rules/**', 'node_modules/**'],
    environment: 'node',
    testTimeout: 20_000,
  },
});
