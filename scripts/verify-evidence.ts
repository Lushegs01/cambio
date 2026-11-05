/**
 * Independently verifies Cambio's on-chain evidence against Mezo RPC. Read-only: it never signs or broadcasts.
 *
 *   npm run verify:evidence                       # verify every proof in submission/evidence/transaction-proofs.json
 *   npm run verify:evidence -- --write            # ...and record the results in that file
 *   npm run verify:evidence -- --kind musd_transfer --hash 0x…
 *   npm run verify:evidence -- --kind signed_request_settlement --hash 0x… --link 'https://…/#pay?r=…&s=…'
 *   npm run verify:evidence -- --scan 0xADDRESS   # find MUSD payments carrying a Cambio request id
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
  fetchEvidence,
  findSuffixedPayments,
  HASH_RE,
  inconclusive,
  type EvidenceClient,
  type EvidenceResult,
  type ProofKind,
} from '../src/lib/evidence.ts';
import { ecdsaTypedDataVerifier, parsePaymentLink, verifyRequestSignature } from '../src/lib/paymentRequest.ts';
import { verifyWalletSignature } from '../shared/signatureVerification.ts';

const DEFAULT_FILE = path.resolve('submission/evidence/transaction-proofs.json');
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

async function scan(address: Address) {
  const api = `${chain.explorerApiUrl}/api/v2/addresses/${address}`;
  const sent = await explorerPages(`${api}/transactions`, 20);
  const incoming = await explorerPages(`${api}/token-transfers?type=ERC-20&token=${chain.tokens.MUSD.address}`, 20);
  // Incoming transfers do not list calldata; read each candidate transaction from the RPC instead.
  const incomingHashes = [...new Set(incoming.map((t) => t.transaction_hash).filter((h): h is string => typeof h === 'string' && HASH_RE.test(h)))];
  const incomingRows = [];
  for (const hash of incomingHashes) {
    try {
      const tx = await client.getTransaction({ hash: hash as Hex });
      incomingRows.push({ hash, to: { hash: tx.to }, from: { hash: tx.from }, raw_input: tx.input });
    } catch {
      console.warn(`  ? could not read ${hash} from the RPC; it was not scanned`);
    }
  }
  const found = findSuffixedPayments(chain, [...sent, ...incomingRows] as never);
  const unique = [...new Map(found.map((f) => [f.hash.toLowerCase(), f])).values()];
  console.log(`Scanned ${sent.length} sent transactions and ${incomingHashes.length} incoming MUSD transfers for ${address}.`);
  if (!unique.length) console.log('No MUSD transfer carrying a Cambio request id (CMB2 suffix) was found.');
  for (const f of unique) {
    console.log(`  ${f.hash}  ${f.from} → ${f.recipient}  amount ${f.amount}  request ${f.requestId}`);
    console.log(`    ${explorerTxUrl(chain, f.hash)}`);
  }
  console.log('A suffix alone is not a settlement proof: verify it with --kind signed_request_settlement --hash … --link <signed payment link>.');
}

async function main() {
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
