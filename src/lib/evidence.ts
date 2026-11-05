/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Independent verification of on-chain transaction evidence.
 *
 * Every check takes data read from a trusted RPC (transaction, receipt, block) and decides one of:
 *   PASS          every required fact was read and matches,
 *   FAIL          at least one fact was read and contradicts the claim,
 *   INCONCLUSIVE  some required fact could not be read (RPC error, missing link, not yet mined).
 * Unavailable data is never turned into a PASS.
 */

import { decodeFunctionData, getAddress, isHex, type Address, type Hex } from 'viem';
import { erc20Abi, routerAbi } from '../config/abis';
import type { MezoChainConfig } from '../config/chains';
import { receiptHasTransfer, receivedFromReceipt, type ReceiptWithLogs } from './receiptEvidence';
import { REQUEST_SUFFIX_MAGIC, verifySettlement, type SignedPaymentRequest } from './paymentRequest';
import { NOT_FOUND_RETRY_DELAYS_MS, retryNotFound } from './rpcRetry';

export type Verdict = 'PASS' | 'FAIL' | 'INCONCLUSIVE';
export type ProofKind = 'musd_transfer' | 'btc_to_musd_swap' | 'signed_request_settlement';

export interface EvidenceCheck {
  name: string;
  /** true = verified, false = contradicted, null = could not be evaluated. */
  ok: boolean | null;
  detail: string;
}

export interface EvidenceResult {
  kind: ProofKind;
  hash: Hex | null;
  verdict: Verdict;
  checks: EvidenceCheck[];
  /** Decoded, human-readable facts (base units are kept as decimal strings). */
  facts: Record<string, string>;
}

export interface EvidenceTx {
  hash: Hex;
  from: Address;
  to: Address | null;
  input: Hex;
  chainId?: number;
  blockNumber?: bigint | null;
}

export interface EvidenceReceipt extends ReceiptWithLogs {
  transactionHash?: Hex;
}

export const HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const same = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
const TRANSFER_SELECTOR = '0xa9059cbb';

export function verdictOf(checks: EvidenceCheck[]): Verdict {
  if (checks.some((c) => c.ok === false)) return 'FAIL';
  if (checks.length === 0 || checks.some((c) => c.ok === null)) return 'INCONCLUSIVE';
  return 'PASS';
}

function result(kind: ProofKind, hash: Hex | null, checks: EvidenceCheck[], facts: Record<string, string>): EvidenceResult {
  return { kind, hash, verdict: verdictOf(checks), checks, facts };
}

export function inconclusive(kind: ProofKind, hash: Hex | null, reason: string): EvidenceResult {
  return result(kind, hash, [{ name: 'evidence available', ok: null, detail: reason }], {});
}

/** Splits MUSD.transfer calldata into its ABI part and any trailing bytes (Cambio's request-id suffix). */
export function splitTransferCalldata(input: Hex): { to: Address; amount: bigint; suffix: Hex | null } | null {
  if (!isHex(input) || !input.toLowerCase().startsWith(TRANSFER_SELECTOR) || input.length < 138) return null;
  try {
    const base = input.slice(0, 138) as Hex;
    const { args } = decodeFunctionData({ abi: erc20Abi, data: base });
    const [to, amount] = args as readonly [Address, bigint];
    const rest = input.slice(138);
    return { to: getAddress(to), amount, suffix: rest ? (`0x${rest}` as Hex) : null };
  } catch {
    return null;
  }
}

/** Extracts the 16-byte request id from a Cambio "CMB2" calldata suffix, or null. */
export function requestIdFromSuffix(suffix: Hex | null): Hex | null {
  if (!suffix) return null;
  const s = suffix.toLowerCase();
  const magic = REQUEST_SUFFIX_MAGIC.slice(2);
  if (s.length !== 2 + 8 + 32 || !s.startsWith(`0x${magic}`)) return null;
  return `0x${s.slice(10)}` as Hex;
}

function baseChecks(chain: MezoChainConfig, hash: Hex, tx: EvidenceTx, receipt: EvidenceReceipt, blockTimestampMs: number | null): EvidenceCheck[] {
  return [
    { name: 'hash matches', ok: same(tx.hash, hash) && (!receipt.transactionHash || same(receipt.transactionHash, hash)), detail: `RPC returned ${tx.hash}` },
    {
      name: 'network',
      ok: tx.chainId === undefined ? null : tx.chainId === chain.chainId,
      detail: tx.chainId === undefined ? 'Transaction did not report a chain id' : `chain ${tx.chainId} (expected ${chain.chainId})`,
    },
    { name: 'receipt status', ok: receipt.status === 'success', detail: `status=${receipt.status} in block ${receipt.blockNumber}` },
    {
      name: 'block timestamp',
      ok: blockTimestampMs === null ? null : Number.isSafeInteger(blockTimestampMs) && blockTimestampMs > 0,
      detail: blockTimestampMs === null ? 'Block timestamp could not be read' : new Date(blockTimestampMs).toISOString(),
    },
  ];
}

function baseFacts(chain: MezoChainConfig, tx: EvidenceTx, receipt: EvidenceReceipt, blockTimestampMs: number | null): Record<string, string> {
  const facts: Record<string, string> = {
    chainId: String(chain.chainId),
    from: getAddress(tx.from),
    to: tx.to ? getAddress(tx.to) : 'contract creation',
    blockNumber: receipt.blockNumber.toString(),
    gasUsed: receipt.gasUsed.toString(),
  };
  if (receipt.effectiveGasPrice != null) facts.feeWei = (receipt.gasUsed * receipt.effectiveGasPrice).toString();
  if (blockTimestampMs !== null) facts.blockTime = new Date(blockTimestampMs).toISOString();
  return facts;
}

/** A wallet-approved MUSD.transfer whose receipt proves the exact Transfer event. */
export function checkMusdTransfer(
  chain: MezoChainConfig,
  hash: Hex,
  tx: EvidenceTx,
  receipt: EvidenceReceipt,
  blockTimestampMs: number | null,
  expect: { from?: string; to?: string; amount?: string } = {}
): EvidenceResult {
  const musd = chain.tokens.MUSD;
  const checks = baseChecks(chain, hash, tx, receipt, blockTimestampMs);
  const facts = baseFacts(chain, tx, receipt, blockTimestampMs);
  checks.push({ name: 'target is MUSD', ok: same(tx.to, musd.address), detail: `to=${tx.to} (MUSD ${musd.address})` });
  const call = splitTransferCalldata(tx.input);
  checks.push({ name: 'calldata is transfer(to, amount)', ok: !!call, detail: call ? `selector ${TRANSFER_SELECTOR}` : 'Input is not an ERC-20 transfer' });
  if (call) {
    facts.recipient = call.to;
    facts.amount = call.amount.toString();
    facts.calldataSuffix = call.suffix ?? 'none';
    const requestId = requestIdFromSuffix(call.suffix);
    if (requestId) facts.requestId = requestId;
    checks.push({
      name: 'Transfer event matches calldata',
      ok: receiptHasTransfer(receipt, musd.address, tx.from, call.to, call.amount),
      detail: `Transfer(${tx.from} → ${call.to}, ${call.amount}) emitted by MUSD`,
    });
    if (expect.to) checks.push({ name: 'expected recipient', ok: same(call.to, expect.to), detail: `expected ${expect.to}` });
    if (expect.amount) checks.push({ name: 'expected amount', ok: call.amount.toString() === expect.amount, detail: `expected ${expect.amount}` });
  }
  if (expect.from) checks.push({ name: 'expected sender', ok: same(tx.from, expect.from), detail: `expected ${expect.from}` });
  return result('musd_transfer', hash, checks, facts);
}

/** A swap through the configured Mezo Router that spent BTC and delivered at least amountOutMin MUSD to the recipient. */
export function checkBtcToMusdSwap(
  chain: MezoChainConfig,
  hash: Hex,
  tx: EvidenceTx,
  receipt: EvidenceReceipt,
  blockTimestampMs: number | null,
  expect: { trader?: string } = {}
): EvidenceResult {
  const btc = chain.tokens.BTC;
  const musd = chain.tokens.MUSD;
  const checks = baseChecks(chain, hash, tx, receipt, blockTimestampMs);
  const facts = baseFacts(chain, tx, receipt, blockTimestampMs);
  checks.push({ name: 'target is Mezo Router', ok: same(tx.to, chain.router), detail: `to=${tx.to} (Router ${chain.router})` });

  let decoded: { amountIn: bigint; amountOutMin: bigint; routes: readonly { from: Address; to: Address; stable: boolean; factory: Address }[]; to: Address; deadline: bigint } | null = null;
  try {
    const d = decodeFunctionData({ abi: routerAbi, data: tx.input });
    if (d.functionName === 'swapExactTokensForTokens') {
      const [amountIn, amountOutMin, routes, to, deadline] = d.args as readonly [bigint, bigint, readonly { from: Address; to: Address; stable: boolean; factory: Address }[], Address, bigint];
      decoded = { amountIn, amountOutMin, routes, to, deadline };
    }
  } catch {
    decoded = null;
  }
  checks.push({ name: 'calldata is swapExactTokensForTokens', ok: !!decoded, detail: decoded ? 'decoded with the Router ABI' : 'Input does not decode as a Router swap' });
  if (decoded) {
    const first = decoded.routes[0];
    const last = decoded.routes[decoded.routes.length - 1];
    const pool = chain.pools.find((p) => p.tokenA === 'MUSD' && p.tokenB === 'BTC' && p.stable === false);
    facts.amountIn = decoded.amountIn.toString();
    facts.amountOutMin = decoded.amountOutMin.toString();
    facts.recipient = getAddress(decoded.to);
    facts.deadline = decoded.deadline.toString();
    if (pool) facts.pool = pool.address;
    checks.push({ name: 'route BTC → MUSD', ok: !!first && !!last && same(first.from, btc.address) && same(last.to, musd.address), detail: `${first?.from} → ${last?.to}` });
    checks.push({ name: 'route uses Mezo PoolFactory', ok: decoded.routes.every((r) => same(r.factory, chain.poolFactory)), detail: `factory ${first?.factory}` });
    const spent = receiptHasTransfer(receipt, btc.address, tx.from, pool?.address ?? '0x0000000000000000000000000000000000000000', decoded.amountIn);
    checks.push({ name: 'BTC paid into MUSD/BTC pool', ok: !!pool && spent, detail: `Transfer(${tx.from} → ${pool?.address}, ${decoded.amountIn}) on the BTC precompile` });
    const received = receivedFromReceipt(receipt, musd.address, decoded.to);
    facts.amountOut = received.toString();
    checks.push({
      name: 'MUSD received ≥ amountOutMin',
      ok: received > 0n && received >= decoded.amountOutMin,
      detail: `received ${received}, router minimum ${decoded.amountOutMin}`,
    });
    if (expect.trader) checks.push({ name: 'expected trader', ok: same(tx.from, expect.trader) && same(decoded.to, expect.trader), detail: `expected ${expect.trader}` });
  }
  return result('btc_to_musd_swap', hash, checks, facts);
}

/**
 * A payment that settles a specific EIP-712-signed Cambio request: exact calldata (recipient, amount,
 * request id), successful receipt, matching MUSD Transfer and a block time within the request window.
 */
export function checkSignedSettlement(
  chain: MezoChainConfig,
  hash: Hex,
  request: SignedPaymentRequest,
  signatureValid: boolean | null,
  tx: EvidenceTx,
  receipt: EvidenceReceipt,
  blockTimestampMs: number | null
): EvidenceResult {
  const transfer = checkMusdTransfer(chain, hash, tx, receipt, blockTimestampMs, { to: request.recipient, amount: request.amount });
  const checks = [...transfer.checks];
  const facts: Record<string, string> = { ...transfer.facts, signedRequestId: request.id, requestCreatedAt: new Date(request.createdAt * 1000).toISOString(), requestExpiresAt: new Date(request.expiresAt * 1000).toISOString() };
  checks.push({
    name: 'request signed by recipient (EIP-712)',
    ok: signatureValid,
    detail: signatureValid === null ? 'Signature could not be verified' : signatureValid ? `signed by ${request.recipient}` : 'Signature does not verify for the recipient',
  });
  checks.push({ name: 'request chain', ok: request.chainId === chain.chainId, detail: `request for chain ${request.chainId}` });
  const settlement = verifySettlement(request, tx, receipt, blockTimestampMs);
  const settled = settlement.status === 'settled' || settlement.status === 'settled_after_expiry';
  checks.push({
    name: 'calldata binds request id, recipient and amount',
    ok: blockTimestampMs === null && settlement.status === 'mismatch' && /time/i.test(settlement.reason) ? null : settled,
    detail: settled ? `settled${settlement.status === 'settled_after_expiry' ? ' after expiry' : ''}` : settlement.status === 'mismatch' ? settlement.reason : settlement.status,
  });
  if (settlement.status === 'settled_after_expiry') facts.late = 'true';
  return result('signed_request_settlement', hash, checks, facts);
}

/** Minimal client surface the verifier needs; satisfied by a viem PublicClient. */
export interface EvidenceClient {
  getTransaction(a: { hash: Hex }): Promise<EvidenceTx>;
  getTransactionReceipt(a: { hash: Hex }): Promise<EvidenceReceipt>;
  getBlock(a: { blockNumber: bigint }): Promise<{ timestamp: bigint }>;
}

export type Fetched =
  | { ok: true; tx: EvidenceTx; receipt: EvidenceReceipt; blockTimestampMs: number | null }
  | { ok: false; reason: string };

/** Reads tx, receipt and block. Any read failure is reported, never guessed. */
export async function fetchEvidence(client: EvidenceClient, hash: Hex, retryDelays: readonly number[] = NOT_FOUND_RETRY_DELAYS_MS): Promise<Fetched> {
  if (!HASH_RE.test(hash)) return { ok: false, reason: 'Not a 32-byte transaction hash' };
  let tx: EvidenceTx;
  let receipt: EvidenceReceipt;
  try {
    // Load-balanced RPC nodes can briefly disagree; a single "not found" is retried before it counts.
    [tx, receipt] = await Promise.all([
      retryNotFound(() => client.getTransaction({ hash }), retryDelays),
      retryNotFound(() => client.getTransactionReceipt({ hash }), retryDelays),
    ]);
  } catch (err) {
    const name = (err as { name?: string }).name ?? '';
    return { ok: false, reason: /NotFound/i.test(name) ? 'Transaction or receipt not found on this network (yet)' : 'RPC could not return the transaction and receipt' };
  }
  let blockTimestampMs: number | null = null;
  try {
    blockTimestampMs = Number((await client.getBlock({ blockNumber: receipt.blockNumber })).timestamp) * 1000;
  } catch {
    blockTimestampMs = null;
  }
  return { ok: true, tx, receipt, blockTimestampMs };
}

/** Explorer transaction rows that carry a Cambio request-id suffix on an MUSD transfer. */
export function findSuffixedPayments(
  chain: MezoChainConfig,
  rows: readonly { hash?: unknown; to?: unknown; raw_input?: unknown; from?: unknown; result?: unknown }[]
): { hash: Hex; from: Address; recipient: Address; amount: bigint; requestId: Hex }[] {
  const out: { hash: Hex; from: Address; recipient: Address; amount: bigint; requestId: Hex }[] = [];
  for (const row of rows) {
    const hash = row.hash;
    const to = (row.to as { hash?: string } | null)?.hash;
    const from = (row.from as { hash?: string } | null)?.hash;
    const input = row.raw_input;
    if (typeof hash !== 'string' || !HASH_RE.test(hash) || typeof input !== 'string' || typeof from !== 'string') continue;
    if (!same(to, chain.tokens.MUSD.address)) continue;
    const call = splitTransferCalldata(input as Hex);
    const requestId = call ? requestIdFromSuffix(call.suffix) : null;
    if (call && requestId) out.push({ hash: hash as Hex, from: getAddress(from), recipient: call.to, amount: call.amount, requestId });
  }
  return out;
}
