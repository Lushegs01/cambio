# Host Cambio and its username database yourself

This configuration runs the existing React/Express application and a durable SQLite username registry on **one Linux server with local persistent storage**. It requires no Firebase project, Google service-account key or Vercel account. Wallets still sign all ownership challenges and transactions; the server never holds wallet keys. Mezo RPC/explorer services and Reown remain external integrations.

The supplied `compose.yaml` runs the app as a non-root user, stores the database in the persistent `registry_data` volume, and puts Caddy in front for HTTPS. Only Caddy exposes public ports. The app's port 3000 is bound to the server's loopback address for local checks. The same HTTPS origin serves the frontend and `/api/*`.

The Node and Caddy base images are pinned to manifest digests verified against Docker's official image registry. Review and update those pins deliberately for security patches; a rebuild alone keeps the pinned images. Registry availability and Compose schema validation do not constitute a successful container build or image vulnerability scan.

## What you need

- A Linux server you control, with Docker Engine and the Docker Compose plugin installed using [Docker's instructions](https://docs.docker.com/engine/install/).
- A domain/subdomain you control. Set its A record (and AAAA only if you have working IPv6) to the server. The existing `cambio-rho.vercel.app` hostname belongs to Vercel; it cannot be pointed at your own server.
- Public TCP ports 80 and 443 reachable by Caddy. Retain your SSH access. Do not expose port 3000 publicly or expose the database files.
- Your Reown project ID, with your new HTTPS origin allowed in its dashboard.

SQLite here is for one server and a local filesystem. Do not put it on NFS/SMB, use separate database volumes for replicas, or run this configuration on an ephemeral/serverless filesystem. Firestore remains available for existing managed deployments; SQLite is selected explicitly. The `node:sqlite` adapter requires Node >=24. The container uses Node 24 and leaves mainnet disabled at build time.

## Deploy on your server

```bash
git clone https://github.com/CaNoN-0/Cambio.git
cd Cambio
cp deploy/selfhost.env.example .env.selfhost
```

Edit `.env.selfhost` with your real values:

```dotenv
CAMBIO_HOSTNAME=pay.your-real-domain.com
ACME_EMAIL=you@your-real-domain.com
VITE_WALLETCONNECT_PROJECT_ID=your_real_32_character_reown_project_id
```

The hostname has no scheme, path, port or trailing slash. The ID above is a placeholder: Docker refuses an invalid ID format. The ID is public frontend configuration; it is not a wallet key. No Firebase variables are needed. Keep `.env.selfhost` out of Git.

```bash
docker compose --env-file .env.selfhost config --quiet
docker compose --env-file .env.selfhost up -d --build
docker compose --env-file .env.selfhost ps
docker compose --env-file .env.selfhost logs --tail=100 app proxy
```

Caddy requests and renews public HTTPS certificates when the hostname resolves to this server and ports 80/443 are reachable. Its certificate state has separate persistent volumes. The app must pass its durable-identity health check before Compose starts Caddy. [Caddy's HTTPS prerequisites](https://caddyserver.com/docs/automatic-https).

## Verify before sharing the app

Open `https://YOUR_HOSTNAME/api/health`. Require **HTTP 200** and:

```json
{"ok":true,"identity":{"available":true,"kind":"sqlite","durable":true}}
```

Open the homepage and `/app/activity` directly and refresh both. Connect a Mezo Testnet wallet, claim a username by signing the ownership message, and confirm another browser can resolve the name. Restart the app container, then confirm the same name still resolves:

```bash
docker compose --env-file .env.selfhost restart app
```

An HTTP 503 or an unavailable registry warning is a failed identity gate. Check the volume permissions, available disk space and app logs. `SQLITE_BUSY`/unavailable storage never counts as a successful claim. Do not enable a production memory registry to hide an error.

Your SQLite registry starts empty. This setup does **not** import or overwrite Firestore records. If you already have real registered users, migrate verified records and establish one canonical registry before switching origins; do not operate two independent registries as one username namespace. Links from the old origin keep pointing there until they are shared with the new origin.

## Back up the registry

Use the supplied SQLite backup command while the app is running. It creates a consistent snapshot, includes committed WAL data, checks integrity and refuses to overwrite an existing backup. Choose a new filename each time:

```bash
docker compose --env-file .env.selfhost exec app node scripts/backup-identity.mjs /data/backups/registry-001.sqlite
mkdir -p backups
docker compose --env-file .env.selfhost cp app:/data/backups/registry-001.sqlite ./backups/registry-001.sqlite
```

Keep tested backup copies off the server with appropriate access controls. The in-volume copy alone does not protect against losing the server/disk. Do not copy just the live `identity.sqlite` file: committed writes can be in its `-wal` sidecar.

To restore, stop the app first, preserve its existing database and sidecars as a set, then restore a verified snapshot to `/data/identity.sqlite` on the named volume. It must be readable/writable by the container's `node` user (UID 1000). Keep traffic off until challenges captured in the snapshot have expired (the production lifetime is five minutes), so restoring old unused-nonce state cannot enable replay. Start the app, check health, and verify known names. Registrations or name changes after the snapshot are lost; reconcile any changed ownership before accepting payments by username. Do not replace a database while the app has it open. The online backup/reopen regression tests cover snapshot contents; a full Docker/host disaster-recovery exercise is still required on your server.

Normal `docker compose down` preserves named volumes. `down -v`, deleting `registry_data`, or losing the only server disk destroys the registry unless a usable backup exists.

Before upgrades: create and export a verified backup, review the new revision, then `git pull --ff-only` and rerun `docker compose --env-file .env.selfhost up -d --build`. Unsupported database schema versions fail closed rather than being silently downgraded.

## Run locally without Docker

On Node >=24, the built server can use the same SQLite adapter directly. It does not automatically load `.env.local`; pass an explicit Node env file:

```bash
npm ci
npm run build
```

Create an ignored `.env.selfhost.local` with the following values (replace the database path with an absolute path for your machine):

```dotenv
PORT=3100
BIND_HOST=127.0.0.1
APP_URL=http://localhost:3100
TRUST_PROXY=0
IDENTITY_STORE=sqlite
IDENTITY_DATABASE_PATH=/absolute/private/path/identity.sqlite
ALLOW_NON_DURABLE_IDENTITY=false
```

```bash
node --env-file=.env.selfhost.local server.js
```

Visit `http://localhost:3100`. A public deployment must use HTTPS and its own allowed Reown origin; the shared evaluation Reown ID is only for local evaluation. Put your real `VITE_WALLETCONNECT_PROJECT_ID` in `.env.local` **before building** for a deployed frontend. Keep `VITE_ENABLE_MAINNET=false`.

## Verification scope

The source includes real-disk SQLite tests for restart persistence, signed claims, replay/expiry rejection, atomic changes and rollback, independent-worker races, shared persisted limits, backup/reopen integrity, and rejected ephemeral storage. A production-server subprocess test claims a name with a real disposable wallet signature, restarts the process, and checks persistence/replay without any valid Firebase credential. Browser tests support `E2E_IDENTITY_STORE=sqlite` with a fresh disposable cache file; they never point to your registry.

Docker Engine/WSL is unavailable in the current Windows audit environment. Container builds, public DNS, automatic TLS and remote server health must therefore be checked on your actual server. No public self-hosted deployment exists until a server/domain is supplied. Readiness evidence is recorded separately from these installation instructions.
