# Self-hosting verification — 2026-10-26

Scope: the user selected hosting both Cambio and its username database, without Firebase or Vercel, and has not yet obtained a server/domain. Starting revision: `0bfa59816e5d603e1c1863a34a81c153ce03d5ed`. Review the commit introducing this report against that base for the implementation and evidence.

**Local result: working durable SQLite registry. Public self-hosted deployment: BLOCKED until a server/domain are provided.** This does not change the buildathon release verdict: a public durable deployment and a genuine wallet-approved testnet transfer/proof are still required.

## Implementation

- `server/identity/sqliteStore.ts`: strict SQLite schema, local-file persistence, WAL/full synchronization, transactional username uniqueness and nonce consumption, atomic rename/release, persisted hashed rate-limit buckets and expiry cleanup. Existing incompatible/damaged schemas fail closed instead of becoming an empty username namespace.
- `server/bootstrap.ts`: explicit `IDENTITY_STORE=sqlite`, Node >=24, absolute persistent path, rejection on Vercel/Cloud Run ephemeral storage. Unused Firebase settings do not interfere with SQLite. Firestore and development-memory modes remain available.
- `server/index.ts`: same-origin production frontend/API, optional loopback binding, fail-fast SQLite startup and shutdown handling.
- `Dockerfile`, `compose.yaml`, `deploy/Caddyfile`: non-root Node app, persistent named volume, loopback-only app port, HTTPS reverse proxy, read-only app filesystem, mainnet disabled. Node/Caddy official-image manifest digests were retrieved and pinned; no container build or image scan is claimed.
- `scripts/backup-identity.mjs`: consistent online SQLite backup with integrity check and refusal to overwrite an existing snapshot. Restore limitations and nonce expiry are documented in `SELF_HOSTING.md`.
- `shared/signatureVerification.ts`: ordinary ECDSA signatures verify locally; failed ordinary signatures at code-free addresses do not trigger expensive universal contract simulation. Deployed contract wallets and wrapped counterfactual/delegation signatures still require affirmative on-chain verification. This fixed an existing latency defect exposed by invalid-signature tests and payment-request browser checks; assertions/timeouts were not relaxed.

No new npm dependencies were added. No Firestore records were migrated or modified. The new registry starts with its own namespace; an existing live registry requires deliberate migration/reconciliation before changing origins.

## Observed checks

| Command/check | Result |
|---|---|
| `npm run typecheck` | PASS |
| `npm run lint` | PASS; existing TypeScript alias |
| `npm test -- --maxWorkers=2 --reporter=dot` | PASS: 17 files, 167 tests |
| `npm run test:rules` with the task-local Java 21 runtime | PASS: 3 files, 14 tests |
| `E2E_IDENTITY_STORE=sqlite CI=true npm run test:e2e -- --workers=1` | PASS: all 18 production-browser tests, including mobile |
| `npm run verify:chain` | PASS, read-only. Empty testnet MUSD/mUSDT pool and anomalous mUSDC quote remain known liquidity limitations |
| `VITE_ENABLE_MAINNET=false npm run build` | PASS: frontend and Express bundle |
| Standalone production server against a real SQLite file | PASS: genuine wallet signature claim, process restart, persisted verified lookup, replay refusal, no valid Firebase credentials |
| Independent SQLite workers | PASS: exactly one winner for concurrent username claims and one shared rate quota |
| Online backup/reopen | PASS: committed WAL data and consumed nonce preserved; existing backup protected from overwrite |
| Official Compose JSON Schema | PASS for `compose.yaml`; this is configuration validation, not container execution |
| Official Docker image registry manifests | PASS for pinned Node/Caddy manifests; this is not an image vulnerability scan |
| Local `@vercel/node` packaging compatibility | PASS: compiled function imports under plain Node and refuses prohibited production-memory storage |
| `http://localhost:3100/api/health` | HTTP 200, `available=true`, `kind=sqlite`, `durable=true` |
| Local `/app/activity`, unknown API route | HTTP 200 frontend; HTTP 404 JSON respectively |
| Local listener | Bound to `127.0.0.1:3100`, not a public interface |

Retained logs: `audit-evidence/selfhost-*`. Earlier runs are retained too: the first browser run had 16/18 pass, the next 17/18; invalid-signature unit checks later timed out in existing contract-simulation fallback. After the production verification fast path was fixed, all 167 tests and all 18 SQLite browser tests passed. No failing suite was skipped, meaningful assertion weakened, or live RPC response replaced with a fabricated result.

## Remaining deployment work

1. Obtain/control a Linux server and a domain. No server/domain was supplied; no hosting purchase, DNS modification or remote deployment was performed.
2. Install Docker/Compose on that server, configure `.env.selfhost`, point DNS, and run the commands in `SELF_HOSTING.md`.
3. Verify actual container build/startup, volume permissions, HTTPS issuance, public health, wallet connectivity, name persistence after container restart, and a complete backup/restore exercise. Docker Engine and WSL are unavailable on the current Windows machine, so these checks are BLOCKED here.
4. Use an owned Reown project ID and allow-list the new origin. The local evaluation ID is not evidence of production WalletConnect readiness.
5. Keep SQLite on persistent local storage on one host. This setup is not a multi-host registry; do not use independent replica volumes or NFS/SMB. Preserve off-server backups and reconcile any ownership changes lost when restoring an older snapshot.
6. Complete the genuine human-wallet testnet payment and independently verified proof required by the original submission gate. No transaction was broadcast in this work.

Previous unresolved dependency advisories in `SUBMISSION_READINESS.md` remain applicable. This engineering review is not an independent smart-contract audit.
