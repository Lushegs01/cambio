import { build } from 'esbuild';
await build({ entryPoints: ['server/index.ts'], bundle: true, platform: 'node', format: 'esm', target: 'node22', packages: 'external', outfile: 'server.js' });
