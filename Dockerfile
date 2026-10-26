FROM node:24-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_WALLETCONNECT_PROJECT_ID
ENV VITE_WALLETCONNECT_PROJECT_ID=${VITE_WALLETCONNECT_PROJECT_ID}
ENV VITE_ENABLE_MAINNET=false
RUN node -e "if(!/^[a-f0-9]{32}$/i.test(process.env.VITE_WALLETCONNECT_PROJECT_ID||''))throw new Error('Set your real Reown project ID as a build argument')" && npm run build
RUN npm prune --omit=dev

FROM node:24-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=3000
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/server.js /app/package.json /app/firebase-applet-config.json ./
COPY --chown=node:node scripts/backup-identity.mjs ./scripts/backup-identity.mjs
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(async r=>{const b=await r.json();if(!r.ok||!b.identity?.available||!b.identity?.durable)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
