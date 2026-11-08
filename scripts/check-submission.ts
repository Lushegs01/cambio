/**
 * Submission readiness checker. Read-only: it never signs, broadcasts or submits anything.
 *
 *   npm run check:submission                 # print the report
 *   npm run check:submission -- --write      # also write submission/WAVE2_FINAL_READINESS.md
 *   npm run check:submission -- --offline    # skip network checks (they report BLOCKED)
 *
 * Every check is PASS, FAIL or BLOCKED:
 *   PASS     verified now, from the source named in the check;
 *   FAIL     something is wrong in the repository or deployment and can be fixed by a code change;
 *   BLOCKED  needs an owner action or an external fact (a recording, a real transaction, real users)
 *            or the network could not be read. BLOCKED is never shown as ready.
 * Exit code: 0 all PASS, 1 any FAIL, 2 otherwise BLOCKED.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createPublicClient, http, type Hex } from 'viem';
import { MEZO_TESTNET } from '../src/config/chains.ts';
import { checkBtcToMusdSwap, checkMusdTransfer, checkSignedSettlement, fetchEvidence, type EvidenceClient, type EvidenceResult } from '../src/lib/evidence.ts';
import { ecdsaTypedDataVerifier, parsePaymentLink, verifyRequestSignature } from '../src/lib/paymentRequest.ts';
import { verifyWalletSignature } from '../shared/signatureVerification.ts';

type Status = 'PASS' | 'FAIL' | 'BLOCKED';
interface Check { area: string; name: string; status: Status; detail: string; action?: string }

const flag = (n: string) => process.argv.includes(`--${n}`);
const OFFLINE = flag('offline');
const root = process.cwd();
const read = (p: string) => readFileSync(path.join(root, p), 'utf8');
const exists = (p: string) => existsSync(path.join(root, p));
const checks: Check[] = [];
const add = (c: Check) => checks.push(c);
const UA = { 'user-agent': 'cambio-submission-checker/1.0', accept: '*/*' };
/** Optional: GitHub's unauthenticated API limit is shared per IP; a read-only token avoids BLOCKED results. */
const GH = process.env.GITHUB_TOKEN ? { ...UA, authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : UA;

async function get(url: string, timeoutMs = 20_000): Promise<{ status: number; text: string } | null> {
  for (const delay of [0, 1500]) {
    if (delay) await new Promise((r) => setTimeout(r, delay));
    try {
      let res = await fetch(url, { headers: url.startsWith('https://api.github.com/') ? GH : UA, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
      // A token the API rejects (401) must not hide a public answer: retry anonymously.
      if (res.status === 401 && GH !== UA && url.startsWith('https://api.github.com/')) res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(timeoutMs) });
      return { status: res.status, text: await res.text() };
    } catch {
      /* retry once */
    }
  }
  return null;
}

const fields = JSON.parse(read('submission/submission-fields.json')) as {
  liveUrl: string; repoUrl: string; demoVideoUrl: string | null; track: string; team: { members: { name: string }[]; socialLinks: unknown };
  deckPath: string; judgeResponsePath: string; evidencePath: string; event: { deadlineUtc: string };
};
const repoSlug = new URL(fields.repoUrl).pathname.replace(/^\/|\/$/g, '');

// ------------------------------------------------------------------------------------------------
// Deployment

async function deployment() {
  if (OFFLINE) return add({ area: 'Deployment', name: 'Live app reachable', status: 'BLOCKED', detail: 'offline mode' });
  const home = await get(fields.liveUrl);
  add({ area: 'Deployment', name: 'Live app reachable', status: home?.status === 200 && /<title>Cambio<\/title>/.test(home.text) ? 'PASS' : 'FAIL', detail: home ? `HTTP ${home.status}` : 'unreachable' });

  const health = await get(`${fields.liveUrl}/api/health`);
  let h: { ok?: boolean; identity?: { durable?: boolean }; invoices?: { available?: boolean; durable?: boolean }; billing?: { enabled?: boolean } } | null;
  try { h = health ? JSON.parse(health.text) : null; } catch { h = null; }
  add({
    area: 'Deployment', name: 'API health: durable identity and invoice registry',
    status: h?.ok && h.identity?.durable && h.invoices?.available && h.invoices?.durable ? 'PASS' : 'FAIL',
    detail: health ? `HTTP ${health.status} ${health.text.slice(0, 160)}` : 'unreachable',
  });

  // Is the deployed build the current one? Fingerprint features that only exist in this commit's UI.
  const markers = ['payment-stepper', 'proof-verdict', 'merchant-pro', 'Pay with Cambio'];
  const entry = home?.text.match(/\/assets\/index-[A-Za-z0-9_-]+\.js/)?.[0];
  let bundle = '';
  if (entry) {
    const main = await get(`${fields.liveUrl}${entry}`);
    bundle = main?.text ?? '';
    const chunks = [...new Set(bundle.match(/assets\/[A-Za-z0-9_.-]+\.js/g) ?? [])].slice(0, 80);
    for (const c of chunks) bundle += (await get(`${fields.liveUrl}/${c}`, 15_000))?.text ?? '';
  }
  const missing = markers.filter((m) => !bundle.includes(m));
  add({
    area: 'Deployment', name: 'Production serves the current build (Wave 2 final features present)',
    status: !entry ? 'FAIL' : missing.length === 0 ? 'PASS' : 'BLOCKED',
    detail: missing.length ? `missing in the deployed bundle: ${missing.join(', ')}` : `all ${markers.length} feature markers found`,
    action: missing.length ? 'Merge this branch to main and let Vercel redeploy (owner).' : undefined,
  });
  add({
    area: 'Deployment', name: 'Merchant Pro billing enabled in production',
    status: h?.billing?.enabled ? 'PASS' : 'BLOCKED',
    detail: h?.billing ? `billing.enabled=${String(h.billing.enabled)}` : 'health does not report billing (older build)',
    action: h?.billing?.enabled ? undefined : 'Set PRO_TREASURY_ADDRESS (an owner-controlled testnet wallet) on Vercel and deploy firestore.indexes.json (owner).',
  });
}

// ------------------------------------------------------------------------------------------------
// Repository and CI

async function repository() {
  if (OFFLINE) return add({ area: 'Repository', name: 'Repository is public', status: 'BLOCKED', detail: 'offline mode' });
  const repo = await get(`https://api.github.com/repos/${repoSlug}`);
  let visibility = 'unknown';
  try { visibility = repo && repo.status === 200 ? String(JSON.parse(repo.text).visibility) : 'unknown'; } catch { /* keep unknown */ }
  // Definitive answers only: 200 with a visibility, or 404 (GitHub hides private repos from anonymous reads).
  const definitive = repo?.status === 404 || (repo?.status === 200 && visibility !== 'unknown');
  add({
    area: 'Repository', name: 'Repository is public',
    status: visibility === 'public' ? 'PASS' : definitive ? 'FAIL' : 'BLOCKED',
    detail: definitive || visibility === 'public' ? `visibility=${repo?.status === 404 ? 'private or missing (404)' : visibility}` : `GitHub API not readable (HTTP ${repo?.status ?? 'unreachable'}); set GITHUB_TOKEN to check`,
  });

  const runs = await get(`https://api.github.com/repos/${repoSlug}/actions/runs?branch=main&per_page=10`);
  try {
    const list = (JSON.parse(runs!.text).workflow_runs as { name: string; event: string; status: string; conclusion: string | null; head_sha: string; html_url: string }[]).filter((r) => r.name === 'CI');
    const latestPush = list.find((r) => r.event === 'push');
    const latestScheduled = list.find((r) => r.event === 'schedule');
    add({ area: 'Repository', name: 'CI green on main (latest push run)', status: latestPush?.conclusion === 'success' ? 'PASS' : latestPush ? 'FAIL' : 'BLOCKED', detail: latestPush ? `${latestPush.conclusion ?? latestPush.status} at ${latestPush.head_sha.slice(0, 7)} ${latestPush.html_url}` : 'no push run found' });
    add({ area: 'Repository', name: 'Daily live-chain CI (latest scheduled run)', status: latestScheduled?.conclusion === 'success' ? 'PASS' : latestScheduled ? 'FAIL' : 'BLOCKED', detail: latestScheduled ? `${latestScheduled.conclusion ?? latestScheduled.status} at ${latestScheduled.head_sha.slice(0, 7)} ${latestScheduled.html_url}` : 'no scheduled run found' });
  } catch {
    add({ area: 'Repository', name: 'CI green on main', status: 'BLOCKED', detail: 'GitHub API could not be read (rate limit); set GITHUB_TOKEN to check' });
  }
}

// ------------------------------------------------------------------------------------------------
// On-chain evidence (re-verified live, read-only)

async function evidence() {
  const doc = JSON.parse(read(fields.evidencePath)) as { proofs: { id: string; kind: string; hash: string | null; paymentLink?: string | null; expect?: Record<string, string> }[] };
  const required = ['musd_transfer', 'btc_to_musd_swap', 'signed_request_settlement'];
  const chain = MEZO_TESTNET;
  const client = createPublicClient({ transport: http(chain.rpcUrls[0], { timeout: 20_000, retryCount: 2 }) }) as unknown as EvidenceClient & { getCode: (a: { address: Hex }) => Promise<Hex | undefined>; verifyTypedData: (a: never) => Promise<boolean> };
  for (const kind of required) {
    const p = doc.proofs.find((x) => x.kind === kind);
    const label = { musd_transfer: 'Real MUSD transfer', btc_to_musd_swap: 'Real BTC → MUSD swap via the Mezo Router', signed_request_settlement: 'Real settlement of an EIP-712 signed invoice' }[kind]!;
    if (!p?.hash) {
      add({ area: 'Mezo evidence', name: label, status: 'BLOCKED', detail: 'no transaction recorded yet (PENDING)', action: 'Pay a signed invoice between two owner wallets in the app, then run npm run verify:evidence -- --discover <merchant> --write (submission/WAVE2_OWNER_ACTIONS.md §1).' });
      continue;
    }
    if (OFFLINE) {
      add({ area: 'Mezo evidence', name: label, status: 'BLOCKED', detail: `offline mode; recorded ${p.hash}` });
      continue;
    }
    const f = await fetchEvidence(client, p.hash as Hex);
    let r: EvidenceResult | null = null;
    if (f.ok) {
      if (kind === 'musd_transfer') r = checkMusdTransfer(chain, p.hash as Hex, f.tx, f.receipt, f.blockTimestampMs, p.expect);
      else if (kind === 'btc_to_musd_swap') r = checkBtcToMusdSwap(chain, p.hash as Hex, f.tx, f.receipt, f.blockTimestampMs, p.expect);
      else {
        const parsed = p.paymentLink ? parsePaymentLink(p.paymentLink) : null;
        if (parsed?.kind === 'signed') {
          const valid = await verifyRequestSignature(parsed.request, parsed.signature, (args) =>
            verifyWalletSignature({ signature: args.signature, verifyEoa: () => ecdsaTypedDataVerifier(args), getCode: () => client.getCode({ address: args.address }), verifyContract: () => client.verifyTypedData(args as never) })
          ).catch(() => null);
          r = checkSignedSettlement(chain, p.hash as Hex, parsed.request, valid, f.tx, f.receipt, f.blockTimestampMs);
        }
      }
    }
    const verdict = r?.verdict ?? 'INCONCLUSIVE';
    add({ area: 'Mezo evidence', name: label, status: verdict === 'PASS' ? 'PASS' : verdict === 'FAIL' ? 'FAIL' : 'BLOCKED', detail: `${verdict} — ${chain.explorerUrl}/tx/${p.hash}${f.ok ? '' : ` (${f.reason})`}` });
  }

  // Consistency: every hash cited in the README and judge-facing docs is a recorded proof, and no doc claims a pending proof passed.
  const recorded = new Set(doc.proofs.map((p) => p.hash?.toLowerCase()).filter(Boolean));
  const cited = new Set<string>();
  for (const f of judgeDocs()) for (const m of read(f).matchAll(/explorer\.test\.mezo\.org\/tx\/(0x[0-9a-fA-F]{64})/g)) cited.add(m[1].toLowerCase());
  const unknown = [...cited].filter((h) => !recorded.has(h));
  add({ area: 'Mezo evidence', name: 'Cited transaction hashes match the evidence file', status: unknown.length ? 'FAIL' : 'PASS', detail: unknown.length ? `cited but not recorded: ${unknown.join(', ')}` : `${cited.size} cited hash(es), all recorded` });
}

// ------------------------------------------------------------------------------------------------
// Materials and claims

function judgeDocs(): string[] {
  const files = ['README.md', 'SUBMISSION_PACKAGE.md'];
  for (const dir of ['submission', 'docs']) {
    for (const f of readdirSync(path.join(root, dir))) if (f.endsWith('.md')) files.push(`${dir}/${f}`);
  }
  return files.filter(exists);
}

function materials() {
  const deck = fields.deckPath;
  const deckOk = exists(deck) && statSync(path.join(root, deck)).size > 50_000 && read(deck).startsWith('%PDF');
  add({ area: 'Materials', name: 'Pitch deck PDF', status: deckOk ? 'PASS' : 'FAIL', detail: deckOk ? `${deck} (${Math.round(statSync(path.join(root, deck)).size / 1024)} KB)` : `${deck} missing or not a PDF` });
  add({ area: 'Materials', name: 'Two-minute demo video', status: fields.demoVideoUrl ? 'PASS' : 'BLOCKED', detail: fields.demoVideoUrl ?? 'not recorded yet', action: fields.demoVideoUrl ? undefined : 'Record it with submission/WAVE2_DEMO_GUIDE.md and put the URL in submission/submission-fields.json (owner).' });
  for (const [name, file] of [
    ['Wave 2 response to judge feedback', fields.judgeResponsePath],
    ['Demo guide', 'submission/WAVE2_DEMO_GUIDE.md'],
    ['Pitch script', 'submission/WAVE2_PITCH_SCRIPT.md'],
    ['Owner actions', 'submission/WAVE2_OWNER_ACTIONS.md'],
    ['Implementation audit', 'docs/WAVE2_IMPLEMENTATION_AUDIT.md'],
    ['Security report', 'docs/WAVE2_SECURITY_REPORT.md'],
    ['Technical verification', 'docs/WAVE2_TECHNICAL_VERIFICATION.md'],
    ['Performance report', 'docs/WAVE2_PERFORMANCE_REPORT.md'],
    ['Product validation', 'docs/WAVE2_PRODUCT_VALIDATION.md'],
    ['Business model', 'docs/WAVE2_BUSINESS_MODEL.md'],
  ] as const) {
    add({ area: 'Materials', name, status: exists(file) ? 'PASS' : 'FAIL', detail: file });
  }
  const readme = read('README.md');
  add({ area: 'Materials', name: 'README states track and team', status: /Track 2/.test(readme) && /Access (&|and) Distribution/.test(readme) && /Lushegs/.test(readme) ? 'PASS' : 'FAIL', detail: 'README.md' });
  add({ area: 'Materials', name: 'Team social links for the form', status: fields.team.socialLinks ? 'PASS' : 'BLOCKED', detail: fields.team.socialLinks ? 'present' : 'GitHub only', action: fields.team.socialLinks ? undefined : 'Add X/LinkedIn links to submission-fields.json if you want them on the form (owner; optional).' });

  // Unsupported claims the judges flagged, or that would contradict the repository.
  const banned: [RegExp, string][] = [
    [/naira/i, 'crypto-to-naira claims (no such product)'],
    [/solidity smart contracts?/i, '"Solidity smart contracts" (none exist)'],
    [/runs the Wave 1 build/i, 'stale "production runs Wave 1" claim'],
    [/\b(has been|was|is) (independently |externally )?audited\b/i, 'an audit claim (there is no audit)'],
  ];
  const hits: string[] = [];
  for (const f of judgeDocs()) {
    let heading = '';
    read(f).split('\n').forEach((line, i) => {
      if (/^#{1,6}\s/.test(line)) heading = line;
      // Lines under a "Not planned" / "Out of scope" heading are explicit non-claims.
      if (/not planned|out of scope|non-goals/i.test(heading)) return;
      for (const [re, what] of banned) {
        // A line that negates or records the removal of the claim ("no Solidity", "not audited", "showed … Inaccurate") is fine.
        if (re.test(line) && !/\b(no|not|never|without|removed|remove|replaced|showed|inaccurate|stale|fixed|isn['’]t|doesn['’]t|don['’]t|nor)\b/i.test(line)) hits.push(`${f}:${i + 1} ${what}`);
      }
    });
  }
  add({ area: 'Claims', name: 'No unsupported or contradicted claims in judge-facing docs', status: hits.length ? 'FAIL' : 'PASS', detail: hits.length ? hits.slice(0, 8).join('; ') : `${judgeDocs().length} files scanned` });
  add({ area: 'Claims', name: 'Contract claim matches the repo (no custom contracts)', status: readdirSync(root).some((f) => f === 'contracts' || f.endsWith('.sol')) ? 'FAIL' : 'PASS', detail: 'no contracts/ directory or .sol files' });
}

// ------------------------------------------------------------------------------------------------
// User validation

function users() {
  const data = 'pilot/participants.json';
  if (!exists(data)) {
    add({ area: 'User validation', name: 'Real pilot participants with consent', status: 'BLOCKED', detail: 'pilot/participants.json does not exist (only the example template). No user research has been run.', action: 'Recruit 3–5 merchants with docs/WAVE2_PRODUCT_VALIDATION.md, record consent, then run npm run pilot:metrics (owner).' });
    return;
  }
  try {
    // Only merchants who signed the consent form are listed (docs/WAVE2_PRODUCT_VALIDATION.md); the zero address is the template placeholder.
    const p = JSON.parse(read(data)) as { merchants?: { label?: string; address?: string }[] };
    const real = (p.merchants ?? []).filter((m) => typeof m.address === 'string' && /^0x[0-9a-fA-F]{40}$/.test(m.address) && !/^0x0{40}$/i.test(m.address));
    add({ area: 'User validation', name: 'Real pilot participants with consent', status: real.length >= 3 ? 'PASS' : 'BLOCKED', detail: `${real.length} consenting merchant(s) listed in pilot/participants.json (target ≥ 3); verify payments with npm run pilot:metrics` });
  } catch {
    add({ area: 'User validation', name: 'Real pilot participants with consent', status: 'FAIL', detail: 'pilot/participants.json is not valid JSON' });
  }
}

// ------------------------------------------------------------------------------------------------
// Cited URLs

async function urls() {
  if (OFFLINE) return add({ area: 'Links', name: 'Cited URLs resolve', status: 'BLOCKED', detail: 'offline mode' });
  const found = new Set<string>();
  for (const f of ['README.md', ...judgeDocs().filter((x) => x.startsWith('submission/'))]) {
    for (const m of read(f).matchAll(/https:\/\/[^\s)<>"'`\]]+/g)) {
      const u = m[0].replace(/[.,;:]+$/, '');
      if (/localhost|127\.0\.0\.1|example\.(com|org)|\{|\$|<|wa\.me|t\.me\/share/.test(u)) continue;
      found.add(u);
    }
  }
  const broken: string[] = [];
  const list = [...found];
  for (let i = 0; i < list.length; i += 6) {
    await Promise.all(list.slice(i, i + 6).map(async (u) => {
      const r = await get(u, 20_000);
      // The SPA serves every hash route from "/", and GitHub blob/tree pages 200 when the path exists on main.
      if (!r || r.status >= 400) broken.push(`${u} (${r ? r.status : 'unreachable'})`);
    }));
  }
  add({ area: 'Links', name: 'Cited URLs resolve', status: broken.length ? 'FAIL' : 'PASS', detail: broken.length ? broken.slice(0, 8).join('; ') : `${list.length} URL(s) checked` });
}

function deadline() {
  const ms = Date.parse(fields.event.deadlineUtc) - Date.now();
  add({ area: 'Timeline', name: 'Before the (earlier) AKINDO deadline', status: ms > 0 ? 'PASS' : 'FAIL', detail: `${fields.event.deadlineUtc} — ${ms > 0 ? `${(ms / 3_600_000).toFixed(1)} h left` : 'passed'}; confirm the date in the AKINDO UI` });
}

function gitSha(): string {
  try {
    const sha = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
    const dirty = execSync('git status --porcelain', { encoding: 'utf8' }).trim() ? ' + uncommitted changes' : '';
    return `${sha}${dirty}`;
  } catch {
    return 'unknown';
  }
}

function render(): string {
  const counts = { PASS: 0, FAIL: 0, BLOCKED: 0 } as Record<Status, number>;
  for (const c of checks) counts[c.status]++;
  const overall: Status = counts.FAIL ? 'FAIL' : counts.BLOCKED ? 'BLOCKED' : 'PASS';
  const icon = (s: Status) => (s === 'PASS' ? '✅ PASS' : s === 'FAIL' ? '❌ FAIL' : '⏳ BLOCKED');
  const lines = [
    '# Cambio — Wave 2 final readiness',
    '',
    `Generated by \`npm run check:submission -- --write\` on ${new Date().toISOString()} at commit \`${gitSha()}\`. Do not edit by hand; re-run the checker.`,
    '',
    `**Overall: ${icon(overall)}** — ${counts.PASS} pass, ${counts.FAIL} fail, ${counts.BLOCKED} blocked.`,
    '',
    'PASS = verified now from the named source. FAIL = fixable in the repo or deployment. BLOCKED = needs an owner action, a real transaction, real users, or the network was unreadable. BLOCKED is not ready.',
    '',
    '| Area | Check | Status | Detail | Owner action |',
    '| --- | --- | --- | --- | --- |',
    ...checks.map((c) => `| ${c.area} | ${c.name} | ${icon(c.status)} | ${c.detail.replace(/\|/g, '\\|')} | ${c.action ?? ''} |`),
    '',
  ];
  return lines.join('\n');
}

async function main() {
  await Promise.all([deployment(), repository()]);
  await evidence();
  materials();
  users();
  await urls();
  deadline();
  const order = ['Timeline', 'Deployment', 'Repository', 'Mezo evidence', 'Materials', 'Claims', 'User validation', 'Links'];
  checks.sort((a, b) => order.indexOf(a.area) - order.indexOf(b.area));
  const md = render();
  console.log(md);
  if (flag('write')) {
    writeFileSync(path.join(root, 'submission/WAVE2_FINAL_READINESS.md'), md);
    console.log('Wrote submission/WAVE2_FINAL_READINESS.md');
  }
  return checks.some((c) => c.status === 'FAIL') ? 1 : checks.some((c) => c.status === 'BLOCKED') ? 2 : 0;
}

main().then((code) => process.exit(code)).catch((err) => {
  console.error(`check-submission: ${(err as Error).message}`);
  process.exit(1);
});
