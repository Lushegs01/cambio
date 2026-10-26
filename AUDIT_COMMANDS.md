# Executed command record

## Self-hosting follow-up — 2026-10-26

The user selected hosting both the app and database and stated that no server/domain is available yet. `git status`, `git diff`, `git diff --check`, `rg` and source/config reads established the implementation boundaries. `Get-Command docker` found no CLI; `wsl --list --quiet` reported WSL not installed. No Docker execution is claimed.

Commands run included `npm run typecheck`, `npm run lint`, `npm test -- --reporter=dot`, `npm test -- --maxWorkers=2 --reporter=dot`, `npm run test:rules` with task-local Java 21, `npm run verify:chain`, `npm run build` with `VITE_ENABLE_MAINNET=false`, and production `npm run test:e2e` with `E2E_IDENTITY_STORE=sqlite`, first with normal workers and then `--workers=1`. Intermediate RPC-related failures are preserved; final results are in `SELF_HOSTING_READINESS.md` and `audit-evidence/selfhost-*`.

Read-only Node HTTP scripts validated `compose.yaml` against the official Compose JSON Schema and retrieved official Node/Caddy image manifests (digests only were saved). These do not replace container execution. The local `@vercel/node` builder also compiled/imported the API as a backward-compatibility check.

`node --env-file=.env.selfhost.local server.js` started the loopback-only local SQLite instance on port 3100 using an ignored local config and database. HTTP probes observed healthy durable identity, SPA direct navigation and JSON API 404 behavior. Disposable production subprocess/worker tests verified real signed claims, restart persistence, nonce rejection, transaction rollback, cross-worker uniqueness/limits and consistent backups. No wallet transaction, hosting purchase, DNS change or remote self-hosted deployment occurred.

## Vercel remediation follow-up — 2026-10-26

The user authorized backend deployment after reporting the unavailable registry on https://cambio-rho.vercel.app. Read-only HTTP requests observed `/` 200, `/api/health` 404, username availability 404 and `/app/activity` 404. `git status`, `git diff --check`, GitHub commit statuses and deployment status GETs inspected the current source and the existing Git-triggered Vercel integration. `vercel --version` reported 59.23.2; `vercel whoami` reported an expired saved login. The subsequently connected Vercel integration returned no accessible projects/teams and a 403 for the owning team; its prescribed team-authorization recovery returned 404 team not found. No credentials were obtained or permissions changed.

After repairs, `npm run typecheck`, `npm run lint`, `npm test -- --reporter=dot`, `npm run test:rules`, `npm run test:e2e`, `npm run verify:chain` and `npm run build` were run; retained `audit-evidence/vercel-fix-*` logs record their observed results. The E2E command also builds the final production source before starting Express. The local `@vercel/node` builder compiled the function, then plain Node imported its emitted JavaScript and served a correct 503 when production memory storage was prohibited. That check first exposed missing ESM import extensions, which were fixed. A persistent regression test now compiles the API/server modules with TypeScript and boots them in a separate plain Node process. No blockchain transaction was broadcast and no production username was claimed.

The original audit command record follows.

Publication verification for the follow-up: `git commit` created `f7e3911224b22efe236e9b1ee2449602e98113a5`; `git push origin main` succeeded, and `git ls-remote origin refs/heads/main` matched that SHA. Read-only GitHub status requests observed both existing Vercel checks transition from pending to success. Public requests then confirmed the backend/API routes and security headers; the health/availability 503 responses identified a remaining Firestore initialization blocker. Exact response evidence is retained in `audit-evidence/vercel-public-health.json`. No Vercel environment variables or permissions were changed.

Audit run 2026-10-25, handoff 2026-10-26. Commands ran locally on Windows with Node 24.20.0, npm 11.19.0, and a checksum-verified Temurin Java 21 JRE for the emulator. No audit command pushed, deployed, broadcast a transaction or changed production data.

After the audit, the user explicitly requested a Git push. Publication preparation fetched origin, confirmed main had not diverged, compared every publishable file with the reviewed source snapshot (zero differences before this documentation update), scanned publishable text and retained logs for private-credential patterns (zero matches), and ran `git diff --check`. The publication commit preserves the reviewed source, regression tests and command evidence. Deployment, transaction broadcasts and hackathon submission remain outside this publication step.

## Repository and environment inspection

`Get-Location`, `Get-ChildItem -Force`, initial `git status --short --branch` and `git rev-parse HEAD` established that the starting directory was not a checkout. `git clone https://github.com/CaNoN-0/Cambio.git work/Cambio` succeeded. In the clone, `git status --short --branch`, `git rev-parse HEAD`, `git log -3 --oneline`, `git remote -v`, `rg --files`, `rg` searches and `Get-Content` reads established clean main at bea064ab58384703cc2a4e51470d5888afe2b80b and inspected the files inventoried in SUBMISSION_READINESS.md. Repeated `git diff`, `git diff --numstat`, `git diff --stat` and final `git diff --check` reviewed the repairs; final whitespace check exit 0.

`node --version`, `npm --version`, `Get-Command node,npm,git,java,bun`, directory checks and credential-environment **names only** established the available prerequisites. A filename-only secret-pattern `rg -l` scan flagged the public Firebase browser configuration, not a private key. Public GitHub metadata GETs observed homepage=null and zero public deployment records. The GitHub connector was also used read-only.

## Installation, prerequisite and dependency commands

| Command / operation | Observed result |
| --- | --- |
| `npx --yes bun --version` | Bun 1.4.4 |
| `npx --yes bun install --frozen-lockfile` | PASS, 638 packages; original locked baseline |
| `npm install --package-lock-only --ignore-scripts` | FAIL peer conflict, notably esbuild range; investigated |
| `npm view firebase-tools version engines --json`, `npm view esbuild version --json`, `npm view typescript@5.9.3 version --json` | Retrieved registry metadata used to align toolchain |
| `npm install --save-dev esbuild@0.28.2 typescript@5.9.3 firebase-tools@15.34.1` | PASS; generated npm lock and supplied missing CLI |
| `npm audit --json` | Initial 22 affected packages, 17 high / 5 moderate; logs retained |
| `npm audit fix` | Compatible body-parser repair; 21 affected packages remained |
| `npm ls zod @grpc/grpc-js @opentelemetry/core uuid --all` | Dependency-path evidence retained |
| `npm view zod@3 version --json`, Reown version/dependency lookups | Confirmed current SDK still pins vulnerable Zod 3; no blind major replacement |
| `npm install` after patched gRPC override | PASS; 16 affected packages remain |
| `npm ci` | FAIL due shared-cache missing content ENOENT; see npm-ci-final.log |
| `npm ci --cache ../npm-cache --prefer-online` | PASS, 1,098 packages; separate cache avoids the environmental corruption |
| `npm audit --json`, `npm audit --omit=dev --json` | FAIL clean-security gate: 16 full-tree entries, 11 production entries; no critical entries. Assessed, not hidden |
| `npx playwright install chromium` | Exit 0; available Chromium used by browser tests |
| Adoptium official Java 21 asset GET, SHA256 comparison, `Expand-Archive`, `java -version` | Download checksum matched, Java 21 installed only in task work/ |

## Baseline and repair runs

Before dependencies were ready, every requested npm command was attempted: typecheck, lint, test, rules, e2e, chain and build failed for missing executables/modules. After frozen installation, baseline typecheck/lint and all 112 tests passed. Baseline chain verification passed with one empty-pool warning. Firestore could not initially start without its CLI/Java. The frontend built, but the server build/e2e hit a Windows Device Guard rejection of stale Bun executable shims. `npm start` failed on POSIX `NODE_ENV=...` syntax. No endpoint protection was disabled or bypassed. The clean npm installation and portable production scripts eliminated those shim/shell dependencies.

Repeated `npm run typecheck`, `npm test`, `npm run build`, `npm run test:rules`, `npm run test:e2e` and `npm run verify:chain` were used during repair. Logs include intermediate failures and successful reruns: 121, 133, 134 and 142 tests as coverage grew; a duplicate export/variable compile error repaired immediately; missing input event in the old swap fixture corrected to provide stronger receipt evidence; script pool return types corrected after adding the verifier to typecheck; an emulator hook initialization timeout corrected with the existing 30-second suite budget; UI review-before-balance failure; blocked SDK telemetry and storage-denial startup failures; then complete passes.

The final sequential run is authoritative: **release-results.json** records the exact seven npm commands, exit codes, start timestamps and log names. Results: typecheck 0, lint 0, tests 143 passed, rules 14 passed, browser 18 passed, chain 0 with investigated liquidity warning, build 0. Mainnet frontend enablement was explicitly false.

## Runtime and final handoff commands

`npm run dev -- --port 4183` started Vite plus the actual API. Read-only HTTP checks observed dev root/health 200 with in-memory durable=false. `PORT=4182` was set through PowerShell, then `npm start` started the bundled Express production process. App/deep links/assets returned 200 and missing credentials produced identity health/lookup 503. The final Node fetch smoke repeated this against the rebuilt application, also verifying unknown API/assets 404 and CSP headers. The task-owned servers were stopped with Ctrl-C after inspection.

Temporary Node scripts applied documented repairs, produced the report, checked PNG dimensions, traced CSP failures, rendered/inspected six deck slides and packaged deliverables. A first documentation helper had a quoting SyntaxError and a PowerShell log-redirection helper had syntax errors; both were corrected, and their unsuccessful attempts were never counted as successful application checks. Direct session PPTX byte export was unavailable; the reviewed product deck was exported successfully as PDF instead.

Official Mezo docs, current event announcement and AKINDO page were read with web/browser tools. The interactive event clarified deck/video requirements and scoring; no form, registration, account change or submission was performed. The pitch is a recording script, not a fabricated video or completed payment demo.

See retained **audit-evidence/** for all collected pipeline, dependency and runtime logs, including earlier failures. Shell file reads and status queries were read-only and are grouped above rather than represented as release tests.
