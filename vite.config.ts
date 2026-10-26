import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, type Plugin } from 'vite';

/**
 * Development only: mounts the same Express API app that server/index.ts serves in production,
 * so `npm run dev` exercises the real identity code. Production does not depend on this plugin.
 */
function cambioApiDevPlugin(): Plugin {
  return {
    name: 'cambio-api-dev',
    apply: 'serve',
    async configureServer(server) {
      const { createApiApp } = await import('./server/app');
      const { bootstrapIdentity } = await import('./server/bootstrap');
      const { identity, error, rateLimitStore } = await bootstrapIdentity(process.env, 'development');
      const api = createApiApp({ identity, identityInitError: error, rateLimitStore });
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next();
        api(req as never, res as never, next);
      });
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), cambioApiDevPlugin()],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
        'cross-fetch': path.resolve(import.meta.dirname, 'src/shims/cross-fetch.ts'),
      },
    },
    build: {
      chunkSizeWarningLimit: 2000,
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
