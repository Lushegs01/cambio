/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Non-custodial MUSD transfer: preflight -> wallet signature -> broadcast -> receipt -> evidence check.
 * All chain access goes through TransferDeps so this exact code path is what the tests exercise.
 */

import { encodeFunctionData, getAddress, isAddress, type Address, type Hex } from 'viem';
import { erc20Abi } from '../config/abis';
import type { MezoChainConfig } from '../config/chains';
import { classifyTxError, TxPreflightError } from './txErrors';
import { formatTokenDisplay } from './amounts';
import { phaseFromReceipt, summarizeReceipt, type LedgerEntry, type LedgerPatch, type ReceiptLike, type TxPhase } from './transactions';

export type { ReceiptWithLogs } from './receiptEvidence';
import { receiptHasTransfer, type ReceiptWithLogs } from './receiptEvidence';
export { receiptHasTransfer } from './receiptEvidence';

export interface TransferDeps {
  getConnection(): { address?: Address; chainId?: number };
  readTokenBalance(a: { chainId: number; token: Address; owner: Address }): Promise<bigint>;
  readNativeBalance(a: { chainId: number; owner: Address }): Promise<bigint>;
  /** Estimates gas for the exact calldata. Rejects if the call would revert. */
  estimateFee(a: { chainId: number; from: Address; to: Address; data: Hex }): Promise<{ gas: bigint; fee: bigint }>;
  sendTransfer(a: { chainId: number; from: Address; token: Address; to: Address; amount: bigint; dataSuffix?: Hex }): Promise<Hex>;
  waitForReceipt(a: { chainId: number; hash: Hex; timeoutMs: number }): Promise<ReceiptWithLogs>;
  getBlockTimestamp(a: { chainId: number; blockNumber: bigint }): Promise<number>;
  recordLedger?(entry: LedgerEntry): void;
  updateLedger?(chainId: number, from: Address, hash: Hex, patch: LedgerPatch): void;
  now?(): number;
}

export interface TransferParams {
  chain: MezoChainConfig;
  from: Address;
  recipient: string;
  amount: bigint;
  memo?: string;
  requestId?: string;
  requestCreatedAt?: number;
  requestExpiresAt?: number;
  /** Extra calldata appended after the ABI-encoded args (ignored by the token; used to bind a payment request). */
  dataSuffix?: Hex;
}

function assertRequestTime(deps: TransferDeps, params: TransferParams) {
  const now = Math.floor((deps.now ?? Date.now)() / 1000);
  if (params.requestCreatedAt !== undefined && now < params.requestCreatedAt) throw new TxPreflightError('invalid_input', 'This request is not active yet. Check its creation time.');
  if (params.requestExpiresAt !== undefined && now >= params.requestExpiresAt) throw new TxPreflightError('invalid_input', 'This request expired before the wallet prompt.');
}

export interface TransferPreview {
  recipient: Address;
  amount: bigint;
  gas: bigint;
  estimatedFee: bigint;
  musdBalance: bigint;
  btcBalance: bigint;
}

export const RECEIPT_TIMEOUT_MS = 120_000;

function validateRecipient(chain: MezoChainConfig, from: Address, raw: string): Address {
  if (!isAddress(raw, { strict: false })) throw new TxPreflightError('invalid_input', 'Recipient is not a valid address.');
  const to = getAddress(raw);
  if (/^0x0{40}$/i.test(to)) throw new TxPreflightError('invalid_input', 'Cannot send to the zero address.');
  if (to.toLowerCase() === from.toLowerCase()) throw new TxPreflightError('invalid_input', 'You cannot send MUSD to your own address.');
  const tokenAddrs = Object.values(chain.tokens).map((t) => t.address.toLowerCase());
  if (tokenAddrs.includes(to.toLowerCase()) || to.toLowerCase() === chain.router.toLowerCase()) {
    throw new TxPreflightError('invalid_input', 'That address is a token or router contract. Tokens sent there are lost.');
  }
  return to;
}

function assertSameChainAndAccount(deps: TransferDeps, chain: MezoChainConfig, from: Address) {
  const conn = deps.getConnection();
  if (!conn.address) throw new TxPreflightError('not_connected', 'Connect a wallet to continue.');
  if (conn.address.toLowerCase() !== from.toLowerCase()) {
    throw new TxPreflightError('invalid_input', 'The connected account changed. Review the transfer again.');
  }
  if (conn.chainId !== chain.chainId) {
    throw new TxPreflightError('wrong_chain', `Your wallet must be on ${chain.name} (chain ${chain.chainId}).`);
  }
}

/** Fresh on-chain checks run before the wallet is ever asked to sign. */
export async function previewTransfer(deps: TransferDeps, p: TransferParams): Promise<TransferPreview> {
  assertSameChainAndAccount(deps, p.chain, p.from);
  assertRequestTime(deps, p);
  const recipient = validateRecipient(p.chain, p.from, p.recipient);
  if (p.amount <= 0n || p.amount >= (1n << 256n)) throw new TxPreflightError('invalid_input', 'Amount must be positive and fit in uint256.');

  const musd = p.chain.tokens.MUSD;
  const [musdBalance, btcBalance] = await Promise.all([
    deps.readTokenBalance({ chainId: p.chain.chainId, token: musd.address, owner: p.from }),
    deps.readNativeBalance({ chainId: p.chain.chainId, owner: p.from }),
  ]);
  if (p.amount > musdBalance) {
    throw new TxPreflightError(
      'insufficient_token',
      `Insufficient MUSD: you have ${formatTokenDisplay(musdBalance, musd.decimals)} MUSD.`
    );
  }

  const data = (encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [recipient, p.amount] }) +
    (p.dataSuffix ? p.dataSuffix.slice(2) : '')) as Hex;
  const { gas, fee } = await deps.estimateFee({ chainId: p.chain.chainId, from: p.from, to: musd.address, data });
  if (fee > btcBalance) {
    throw new TxPreflightError('insufficient_gas', 'Not enough BTC on this network to pay the network fee.');
  }
  return { recipient, amount: p.amount, gas, estimatedFee: fee, musdBalance, btcBalance };
}

/**
 * Executes the transfer and reports every phase through onPhase. Never throws: the final phase
 * is always one of confirmed / reverted / rejected / failed / unknown.
 */
export async function executeMusdTransfer(
  deps: TransferDeps,
  p: TransferParams,
  onPhase: (phase: TxPhase) => void
): Promise<TxPhase> {
  const now = deps.now ?? Date.now;
  const finish = (phase: TxPhase) => {
    onPhase(phase);
    return phase;
  };

  let preview: TransferPreview;
  try {
    onPhase({ phase: 'preparing', step: 'Checking balance, network and fee' });
    preview = await previewTransfer(deps, p);
    // Re-check immediately before prompting: the wallet may have switched while we were estimating.
    assertSameChainAndAccount(deps, p.chain, p.from);
    assertRequestTime(deps, p);
  } catch (err) {
    const c = classifyTxError(err);
    return finish({ phase: 'failed', code: c.code, message: c.message });
  }

  const musd = p.chain.tokens.MUSD;
  let hash: Hex;
  try {
    onPhase({ phase: 'awaiting_signature', step: 'Confirm the transfer in your wallet' });
    hash = await deps.sendTransfer({
      chainId: p.chain.chainId,
      from: p.from,
      token: musd.address,
      to: preview.recipient,
      amount: p.amount,
      dataSuffix: p.dataSuffix,
    });
  } catch (err) {
    const c = classifyTxError(err);
    return finish(c.code === 'rejected' ? { phase: 'rejected', message: c.message } : { phase: 'failed', code: c.code, message: c.message });
  }

  const submittedAt = now();
  deps.recordLedger?.({
    mode: 'real',
    kind: 'transfer',
    chainId: p.chain.chainId,
    hash,
    from: p.from,
    to: preview.recipient,
    token: musd.address,
    symbol: musd.symbol,
    decimals: musd.decimals,
    amount: p.amount.toString(),
    status: 'pending',
    submittedAt,
    memo: p.memo?.slice(0, 140) || undefined,
    requestId: p.requestId,
  });
  onPhase({ phase: 'pending', hash, submittedAt, step: 'Waiting for the network to include the transaction' });

  let receipt: ReceiptWithLogs;
  try {
    receipt = await deps.waitForReceipt({ chainId: p.chain.chainId, hash, timeoutMs: RECEIPT_TIMEOUT_MS });
  } catch {
    deps.updateLedger?.(p.chain.chainId, p.from, hash, { status: 'unknown' });
    return finish({
      phase: 'unknown',
      hash,
      message:
        'The transaction was broadcast, but Cambio could not confirm its outcome yet. It may still succeed. Check the explorer or try again shortly.',
    });
  }

  let blockTimestamp: number | null = null;
  try {
    blockTimestamp = await deps.getBlockTimestamp({ chainId: p.chain.chainId, blockNumber: receipt.blockNumber });
  } catch {
    blockTimestamp = null;
  }
  const summary = summarizeReceipt(receipt, blockTimestamp);

  if (summary.status === 'success' && !receiptHasTransfer(receipt, musd.address, p.from, preview.recipient, p.amount)) {
    deps.updateLedger?.(p.chain.chainId, p.from, hash, { status: 'unknown', blockNumber: summary.blockNumber, blockTimestamp });
    return finish({
      phase: 'unknown',
      hash,
      message: 'The transaction was mined, but its receipt has no matching MUSD Transfer event. Verify it on the explorer before relying on it.',
    });
  }

  deps.updateLedger?.(p.chain.chainId, p.from, hash, {
    status: summary.status === 'success' ? 'confirmed' : 'reverted',
    blockNumber: summary.blockNumber,
    blockTimestamp,
  });
  return finish(phaseFromReceipt(hash, summary));
}
