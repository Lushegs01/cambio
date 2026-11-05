/**
 * Pilot traction metrics derived only from the chain (and, when available, the public invoice registry).
 * Read-only. Never counts anything that cannot be re-verified from a transaction hash.
 *
 *   npm run pilot:metrics -- [--file pilot/participants.json] [--out submission/evidence/pilot-metrics.json]
 *
 * For each consenting merchant address it reports:
 *  - cambioPayments: incoming MUSD transfers whose calldata carries a Cambio request id (CMB2 suffix)
 *  - verifiedSettlements: of those, payments that fully verify against the signed request stored in the
 *    registry (exact calldata, receipt, Transfer event, block time), with time from request to payment
 *  - uniquePayers and the MUSD total of verified settlements
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createPublicClient, getAddress, http, isAddress, type Address, type Hex } from 'viem';
import { MEZO_TESTNET } from '../src/config/chains.ts';
import { fetchExplorerTransfersPage, type ExplorerPageParams } from '../src/lib/activity.ts';
import { requestIdFromSuffix, splitTransferCalldata } from '../src/lib/evidence.ts';
import { verifyPaymentTx } from '../src/lib/requestSettlement.ts';
import { validateSignedRequestShape, type SignedPaymentRequest } from '../src/lib/paymentRequest.ts';
import { formatUnitsExact } from '../src/lib/amounts.ts';

const chain = MEZO_TESTNET;
const client = createPublicClient({ transport: http(chain.rpcUrls[0], { timeout: 20_000, retryCount: 2 }) });
const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i === -1 ? undefined : process.argv[i + 1]; };
const fetchUA: typeof fetch = (input, init) => fetch(input, { ...init, headers: { ...(init?.headers ?? {}), 'user-agent': 'cambio-pilot-metrics/1.0' } });

async function registryRequest(base: string | undefined, recipient: Address, id: Hex): Promise<SignedPaymentRequest | null> {
  if (!base) return null;
  try {
    const res = await fetchUA(`${base.replace(/\/+$/, '')}/api/invoices/${recipient}/${id}`, { headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    const body = (await res.json()) as { invoice?: { request?: unknown } };
    return body.invoice?.request && !validateSignedRequestShape(body.invoice.request) ? (body.invoice.request as SignedPaymentRequest) : null;
  } catch {
    return null;
  }
}

async function main() {
  const file = path.resolve(arg('file') ?? 'pilot/participants.json');
  const cfg = JSON.parse(readFileSync(file, 'utf8')) as { registry?: string; since?: string; merchants: { label: string; address: string }[] };
  const since = cfg.since ? Date.parse(cfg.since) : 0;
  const report = [];
  for (const m of cfg.merchants) {
    if (!isAddress(m.address, { strict: false }) || /^0x0{40}$/i.test(m.address)) { console.warn(`skipping ${m.label}: invalid address`); continue; }
    const owner = getAddress(m.address);
    const hashes = new Set<Hex>();
    let params: ExplorerPageParams | null = null;
    let complete = false;
    for (let page = 0; page < 20; page++) {
      const p = await fetchExplorerTransfersPage(chain, owner, params, fetchUA);
      for (const i of p.items) if (i.kind === 'receive' && i.hash && (i.timestamp === null || i.timestamp >= since)) hashes.add(i.hash);
      if (!p.next || (p.oldest !== null && p.oldest < since)) { complete = true; break; }
      params = p.next;
    }
    let cambioPayments = 0;
    const verified: { hash: Hex; payer: string; amount: string; secondsToPay: number | null }[] = [];
    for (const hash of hashes) {
      const tx = await client.getTransaction({ hash }).catch(() => null);
      const call = tx?.to && tx.to.toLowerCase() === chain.tokens.MUSD.address.toLowerCase() ? splitTransferCalldata(tx.input) : null;
      const requestId = call ? requestIdFromSuffix(call.suffix) : null;
      if (!call || !requestId || call.to.toLowerCase() !== owner.toLowerCase()) continue;
      cambioPayments++;
      const request = await registryRequest(cfg.registry, owner, requestId);
      if (!request) continue;
      const check = await verifyPaymentTx(client as never, request, hash);
      if (check.state !== 'settled') continue;
      verified.push({ hash, payer: check.result.payer, amount: request.amount, secondsToPay: check.result.paidAt ? Math.round(check.result.paidAt / 1000 - request.createdAt) : null });
    }
    const total = verified.reduce((s, v) => s + BigInt(v.amount), 0n);
    const times = verified.map((v) => v.secondsToPay).filter((t): t is number => t !== null).sort((a, b) => a - b);
    report.push({
      label: m.label,
      address: owner,
      historyComplete: complete,
      incomingTransfersScanned: hashes.size,
      cambioPayments,
      verifiedSettlements: verified.length,
      uniquePayers: new Set(verified.map((v) => v.payer.toLowerCase())).size,
      verifiedMusd: formatUnitsExact(total, 18),
      medianSecondsToPay: times.length ? times[Math.floor(times.length / 2)] : null,
      settlements: verified,
    });
  }
  const totals = {
    merchants: report.length,
    cambioPayments: report.reduce((s, r) => s + r.cambioPayments, 0),
    verifiedSettlements: report.reduce((s, r) => s + r.verifiedSettlements, 0),
    uniquePayers: new Set(report.flatMap((r) => r.settlements.map((s) => s.payer.toLowerCase()))).size,
  };
  const out = { generatedAt: new Date().toISOString(), chainId: chain.chainId, since: cfg.since ?? null, totals, merchants: report };
  const target = arg('out');
  if (target) writeFileSync(path.resolve(target), `${JSON.stringify(out, null, 2)}\n`);
  console.log(JSON.stringify(totals, null, 2));
  for (const r of report) console.log(`${r.label}: ${r.verifiedSettlements} verified / ${r.cambioPayments} Cambio-tagged payments, ${r.verifiedMusd} MUSD, ${r.uniquePayers} payers${r.historyComplete ? '' : ' (history incomplete)'}`);
}

main().catch((err) => { console.error(`pilot-metrics: ${(err as Error).message}`); process.exit(1); });
