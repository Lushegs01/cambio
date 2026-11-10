/**
 * Independently verifies Cambio's on-chain evidence against Mezo RPC. Read-only: it never signs or broadcasts.
 *
 *   npm run verify:evidence                       # verify every proof in submission/evidence/transaction-proofs.json
 *   npm run verify:evidence -- --write            # ...and record the results in that file
 *   npm run verify:evidence -- --kind musd_transfer --hash 0x…
 *   npm run verify:evidence -- --kind signed_request_settlement --hash 0x… --link 'https://…/#pay?r=…&s=…'
 *   npm run verify:evidence -- --scan 0xADDRESS   # find MUSD payments carrying a Cambio request id
 *   npm run verify:evidence -- --discover 0xMERCHANT [--registry https://cambio-five.vercel.app] [--write]
 *       # find CMB2 payments to a merchant, fetch each signed request from the public invoice registry
 *       # by its on-chain request id, verify signature + settlement, and (with --write) record the
 *       # first PASS as the signed-request-settlement proof.
 *
 * Exit code: 0 = all PASS, 1 = any FAIL, 2 = otherwise INCONCLUSIVE (missing evidence or unreadable data).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createPublicClient, getAddress, http, isAddress, type Address, type Hex } from 'viem';
import { MEZO_TESTNET, explorerTxUrl, type MezoChainConfig } from '../src/config/chains.ts';
import {
  checkBtcToMusdSwap,
  checkMusdTransfer,
  checkSignedSettlement,
  discoverSignedSettlements,
  fetchEvidence,
  findSuffixedPayments,
  HASH_RE,
  inconclusive,
  type EvidenceClient,
  type EvidenceResult,
  type ProofKind,
} from '../src/lib/evidence.ts';
import { ecdsaTypedDataVerifier, encodePaymentLink, parsePaymentLink, validateSignedRequestShape, verifyRequestSignature, type SignedPaymentRequest } from '../src/lib/paymentRequest.ts';
import { EVIDENCE_RETRY_DELAYS_MS, retryRead } from '../src/lib/rpcRetry.ts';
import { verifyWalletSignature } from '../shared/signatureVerification.ts';

const DEFAULT_FILE = path.resolve('submission/evidence/transaction-proofs.json');
const DEFAULT_REGISTRY = 'https://cambio-five.vercel.app';
const KINDS: ProofKind[] = ['musd_transfer', 'btc_to_musd_swap', 'signed_request_settlement'];
const USER_AGENT = 'cambio-evidence-verifier/1.0';

interface ProofEntry {
  id: string;
  kind: ProofKind;
  title?: string;
  hash: string | null;
  paymentLink?: string | null;
  expect?: Record<string, string>;
  verification?: unknown;
  [extra: string]: unknown;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const chain: MezoChainConfig = MEZO_TESTNET;
const rpc = arg('rpc') ?? chain.rpcUrls[0];
const client = createPublicClient({ transport: http(rpc, { timeout: 20_000, retryCount: 2 }) });

async function verifyProof(kind: ProofKind, hash: string | null, opts: { link?: string | null; expect?: Record<string, string> } = {}): Promise<EvidenceResult> {
  if (!hash) return inconclusive(kind, null, 'No transaction hash has been supplied for this proof.');
  if (!HASH_RE.test(hash)) return inconclusive(kind, null, `"${hash}" is not a 32-byte transaction hash.`);
  const h = hash as Hex;
  const fetched = await fetchEvidence(client as unknown as EvidenceClient, h);
  if (!fetched.ok) return inconclusive(kind, h, fetched.reason);
  const { tx, receipt, blockTimestampMs } = fetched;

  if (kind === 'musd_transfer') return checkMusdTransfer(chain, h, tx, receipt, blockTimestampMs, opts.expect);
  if (kind === 'btc_to_musd_swap') return checkBtcToMusdSwap(chain, h, tx, receipt, blockTimestampMs, opts.expect);

  if (!opts.link) return inconclusive(kind, h, 'A signed-request settlement can only be proven together with the signed payment link (r= and s=).');
  const parsed = parsePaymentLink(opts.link);
  if (!parsed || parsed.kind !== 'signed') return inconclusive(kind, h, parsed?.kind === 'invalid' ? `Payment link is invalid: ${parsed.error}` : 'The supplied link is not a signed Cambio request.');
  let signatureValid: boolean | null;
  try {
    signatureValid = await verifyRequestSignature(parsed.request, parsed.signature, (args) =>
      verifyWalletSignature({
        signature: args.signature,
        verifyEoa: () => ecdsaTypedDataVerifier(args),
        getCode: () => client.getCode({ address: args.address }),
        verifyContract: () => client.verifyTypedData(args),
      })
    );
  } catch {
    signatureValid = null;
  }
  return checkSignedSettlement(chain, h, parsed.request, signatureValid, tx, receipt, blockTimestampMs);
}

function print(label: string, r: EvidenceResult) {
  const mark = r.verdict === 'PASS' ? '✓' : r.verdict === 'FAIL' ? '✗' : '?';
  console.log(`\n${mark} ${label}: ${r.verdict}${r.hash ? `  ${explorerTxUrl(chain, r.hash)}` : ''}`);
  for (const c of r.checks) console.log(`    ${c.ok === true ? '✓' : c.ok === false ? '✗' : '?'} ${c.name} — ${c.detail}`);
  for (const [k, v] of Object.entries(r.facts)) console.log(`      ${k}: ${v}`);
}

async function explorerPages(url: string, maxPages: number): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  let params = '';
  for (let page = 0; page < maxPages; page++) {
    const res = await fetch(`${url}${params}`, { headers: { accept: 'application/json', 'user-agent': USER_AGENT } });
    if (!res.ok) throw new Error(`Explorer responded ${res.status}`);
    const body = (await res.json()) as { items?: Record<string, unknown>[]; next_page_params?: Record<string, string | number> | null };
    rows.push(...(body.items ?? []));
    if (!body.next_page_params) return rows;
    params = `${url.includes('?') ? '&' : '?'}${new URLSearchParams(Object.entries(body.next_page_params).map(([k, v]) => [k, String(v)])).toString()}`;
  }
  console.warn(`  ! stopped after ${maxPages} explorer pages; older history was not scanned`);
  return rows;
}

type Found = ReturnType<typeof findSuffixedPayments>[number];

async function scan(address: Address, quiet = false): Promise<{ found: Found[]; unreadable: string[] }> {
  const api = `${chain.explorerApiUrl}/api/v2/addresses/${address}`;
  const sent = await explorerPages(`${api}/transactions`, 20);
  const incoming = await explorerPages(`${api}/token-transfers?type=ERC-20&token=${chain.tokens.MUSD.address}`, 20);
  // Incoming transfers do not list calldata; read each candidate transaction from the RPC instead.
  const incomingHashes = [...new Set(incoming.map((t) => t.transaction_hash).filter((h): h is string => typeof h === 'string' && HASH_RE.test(h)))];
  const incomingRows = [];
  const unreadable: string[] = [];
  for (const hash of incomingHashes) {
    try {
      const tx = await retryRead(() => client.getTransaction({ hash: hash as Hex }), EVIDENCE_RETRY_DELAYS_MS);
      incomingRows.push({ hash, to: { hash: tx.to }, from: { hash: tx.from }, raw_input: tx.input });
    } catch {
      unreadable.push(hash);
      console.warn(`  ? could not read ${hash} from the RPC after retries; it was not scanned`);
    }
  }
  const found = findSuffixedPayments(chain, [...sent, ...incomingRows] as never);
  const unique = [...new Map(found.map((f) => [f.hash.toLowerCase(), f])).values()];
  if (quiet) return { found: unique, unreadable };
  console.log(`Scanned ${sent.length} sent transactions and ${incomingHashes.length} incoming MUSD transfers for ${address}.`);
  if (unreadable.length) console.log(`INCOMPLETE: ${unreadable.length} transaction(s) could not be read, so absence is not proven.`);
  if (!unique.length) console.log('No MUSD transfer carrying a Cambio request id (CMB2 suffix) was found.');
  for (const f of unique) {
    console.log(`  ${f.hash}  ${f.from} → ${f.recipient}  amount ${f.amount}  request ${f.requestId}`);
    console.log(`    ${explorerTxUrl(chain, f.hash)}`);
  }
  console.log('A suffix alone is not a settlement proof: verify it with --kind signed_request_settlement --hash … --link <signed payment link>, or use --discover.');
  return { found: unique, unreadable };
}

/** Public, unauthenticated registry read: GET /api/invoices/:recipient/:id (the id is a 16-byte capability). */
async function fetchSignedRequest(registry: string, recipient: Address, id: Hex): Promise<{ request: SignedPaymentRequest; signature: Hex } | { error: string }> {
  const url = `${registry.replace(/\/+$/, '')}/api/invoices/${recipient}/${id}`;
  for (const delay of [0, 1000, 3000]) {
    if (delay) await new Promise((r) => setTimeout(r, delay));
    let res: Response;
    try {
      res = await fetch(url, { headers: { accept: 'application/json', 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(20_000) });
    } catch {
      continue;
    }
    if (res.status === 404) return { error: 'not stored in the registry (the invoice was not created through Cambio, or on another deployment)' };
    if (!res.ok) continue;
    const body = (await res.json().catch(() => null)) as { invoice?: { request?: unknown; signature?: unknown } } | null;
    const request = body?.invoice?.request;
    const signature = body?.invoice?.signature;
    if (validateSignedRequestShape(request) || typeof signature !== 'string' || !/^0x[0-9a-fA-F]+$/.test(signature)) return { error: 'registry returned a malformed invoice' };
    return { request: request as SignedPaymentRequest, signature: signature as Hex };
  }
  return { error: `registry ${registry} could not be read` };
}

/**
 * Finds payments to `merchant` that carry a Cambio request id, recovers each signed request from the
 * registry, and verifies it end to end. The registry is only a source of the signed payload: the
 * EIP-712 signature and the settlement are both re-verified here, so a tampered registry cannot PASS.
 */
async function discover(merchant: Address, registry: string): Promise<{ result: EvidenceResult; link: string } | null> {
  const { found, unreadable } = await scan(merchant, true);
  const toMerchant = found.filter((f) => f.recipient.toLowerCase() === merchant.toLowerCase());
  console.log(`Found ${toMerchant.length} MUSD payment(s) to ${merchant} carrying a CMB2 request id.`);
  if (unreadable.length) console.log(`Note: ${unreadable.length} incoming transaction(s) could not be read; re-run if nothing is found.`);
  const outcomes = await discoverSignedSettlements(
    toMerchant,
    merchant,
    (recipient, id) => fetchSignedRequest(registry, recipient, id),
    (request, signature) => encodePaymentLink(registry, request, signature),
    (hash, link) => verifyProof('signed_request_settlement', hash, { link })
  );
  let best: { result: EvidenceResult; link: string } | null = null;
  for (const o of outcomes) {
    if (o.status === 'no_signed_request') {
      console.log(`\n? ${o.hash}: signed request ${o.requestId} ${o.reason}. Verify manually with --kind signed_request_settlement --hash ${o.hash} --link <link>.`);
      continue;
    }
    print(`Signed-request settlement ${o.hash.slice(0, 10)}…`, o.result);
    if (o.status === 'verified' && !best) best = { result: o.result, link: o.link };
  }
  return best;
}

async function main() {
  const discoverTarget = arg('discover');
  if (discoverTarget) {
    if (!isAddress(discoverTarget, { strict: false })) throw new Error('--discover needs the merchant (recipient) 0x address');
    const registry = arg('registry') ?? DEFAULT_REGISTRY;
    const best = await discover(getAddress(discoverTarget), registry);
    if (!best) {
      console.log('\nNo verifiable signed-request settlement was found. Nothing was recorded.');
      return 2;
    }
    console.log(`\nPASS: ${best.result.hash} settles a signed Cambio request.`);
    if (flag('write')) {
      const file = path.resolve(arg('file') ?? DEFAULT_FILE);
      const doc = JSON.parse(readFileSync(file, 'utf8')) as { proofs: ProofEntry[] };
      const entry = doc.proofs.find((p) => p.kind === 'signed_request_settlement');
      if (!entry) throw new Error('The evidence file has no signed_request_settlement entry.');
      entry.hash = best.result.hash;
      entry.paymentLink = best.link;
      entry.discoveredAt = new Date().toISOString();
      entry.discoveredVia = `npm run verify:evidence -- --discover ${getAddress(discoverTarget)} --registry ${registry}`;
      writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
      console.log(`Recorded it in ${path.relative(process.cwd(), file)}. Run \`npm run verify:evidence -- --write\` to refresh every verdict.`);
    } else console.log('Re-run with --write to record it as the signed-request-settlement proof.');
    return 0;
  }

  const scanTarget = arg('scan');
  if (scanTarget) {
    if (!isAddress(scanTarget, { strict: false })) throw new Error('--scan needs a 0x address');
    await scan(getAddress(scanTarget));
    return 0;
  }

  const kind = arg('kind') as ProofKind | undefined;
  if (kind) {
    if (!KINDS.includes(kind)) throw new Error(`--kind must be one of ${KINDS.join(', ')}`);
    const r = await verifyProof(kind, arg('hash') ?? null, { link: arg('link') ?? null });
    print(kind, r);
    return r.verdict === 'PASS' ? 0 : r.verdict === 'FAIL' ? 1 : 2;
  }

  const file = path.resolve(arg('file') ?? DEFAULT_FILE);
  const doc = JSON.parse(readFileSync(file, 'utf8')) as { network?: { chainId?: number }; proofs: ProofEntry[] };
  if (doc.network?.chainId !== undefined && doc.network.chainId !== chain.chainId) throw new Error(`Evidence file is for chain ${doc.network.chainId}; this verifier checks ${chain.chainId}.`);
  const head = await client.getBlockNumber().catch(() => null);
  let worst = 0;
  for (const proof of doc.proofs) {
    if (!KINDS.includes(proof.kind)) throw new Error(`Unknown proof kind ${proof.kind}`);
    const r = await verifyProof(proof.kind, proof.hash, { link: proof.paymentLink ?? null, expect: proof.expect });
    print(proof.title ?? proof.id, r);
    worst = Math.max(worst, r.verdict === 'FAIL' ? 2 : r.verdict === 'INCONCLUSIVE' ? 1 : 0);
    proof.verification = {
      verdict: r.verdict,
      verifiedAt: new Date().toISOString(),
      rpc,
      headBlockAtCheck: head?.toString() ?? null,
      explorerUrl: r.hash ? explorerTxUrl(chain, r.hash) : null,
      checks: r.checks,
      facts: r.facts,
    };
  }
  if (flag('write')) {
    writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
    console.log(`\nRecorded results in ${path.relative(process.cwd(), file)}`);
  }
  return worst === 2 ? 1 : worst === 1 ? 2 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`verify-evidence: ${(err as Error).message}`);
    process.exit(2);
  });
