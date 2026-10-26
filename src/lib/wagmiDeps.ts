/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Production implementations of the chain dependencies, backed by the user's connected wallet (wagmi)
 * and the verified public RPCs. Signing always happens in the user's wallet; Cambio never sees keys.
 */

import { getConnection, getPublicClient, readContract, writeContract, getBalance } from 'wagmi/actions';
import type { Address, Hex } from 'viem';
import { erc20Abi, routerAbi } from '../config/abis';
import type { SwapDeps } from './swap';
import { getKnownChainConfig } from '../config/chains';
import { wagmiConfig } from '../config/walletConnect';
import type { TransferDeps, ReceiptWithLogs } from './musdTransfer';
import { readLedger, upsertLedgerEntry, updateLedgerEntry, type LedgerEntry, type ReceiptLike } from './transactions';

function routerFor(chainId: number): Address {
  const chain = getKnownChainConfig(chainId);
  if (!chain) throw new Error(`Unsupported chain ${chainId}`);
  return chain.router;
}

export function publicClientFor(chainId: number) {
  const client = getPublicClient(wagmiConfig, { chainId });
  if (!client) throw new Error(`No RPC client configured for chain ${chainId}`);
  return client;
}

export async function estimateFee(a: { chainId: number; from: Address; to: Address; data: Hex; value?: bigint }) {
  const client = publicClientFor(a.chainId);
  const gas = await client.estimateGas({ account: a.from, to: a.to, data: a.data, value: a.value });
  let perGas: bigint;
  try {
    const fees = await client.estimateFeesPerGas();
    perGas = fees.maxFeePerGas ?? (await client.getGasPrice());
  } catch {
    perGas = await client.getGasPrice();
  }
  return { gas, fee: gas * perGas };
}

export async function waitForReceipt(a: { chainId: number; hash: Hex; timeoutMs: number }): Promise<ReceiptWithLogs> {
  // viem's action returns reverted receipts as data; wagmi's wrapper would throw instead.
  return publicClientFor(a.chainId).waitForTransactionReceipt({ hash: a.hash, timeout: a.timeoutMs });
}

export async function getReceiptOrNull(chainId: number, hash: Hex): Promise<ReceiptWithLogs | null> {
  try {
    return await publicClientFor(chainId).getTransactionReceipt({ hash });
  } catch (err) {
    const name = (err as { name?: string }).name;
    if (name === 'TransactionReceiptNotFoundError') return null;
    throw err;
  }
}

export async function getBlockTimestamp(a: { chainId: number; blockNumber: bigint }): Promise<number> {
  const block = await publicClientFor(a.chainId).getBlock({ blockNumber: a.blockNumber });
  return Number(block.timestamp) * 1000;
}

export function connectionSnapshot(): { address?: Address; chainId?: number } {
  const c = getConnection(wagmiConfig);
  return { address: c.address, chainId: c.chainId };
}

export function createTransferDeps(): TransferDeps {
  return {
    getConnection: connectionSnapshot,
    readTokenBalance: ({ chainId, token, owner }) =>
      readContract(wagmiConfig, { chainId, address: token, abi: erc20Abi, functionName: 'balanceOf', args: [owner] }),
    readNativeBalance: async ({ chainId, owner }) => (await getBalance(wagmiConfig, { chainId, address: owner })).value,
    estimateFee,
    sendTransfer: ({ chainId, from, token, to, amount, dataSuffix }) =>
      writeContract(wagmiConfig, {
        chainId,
        account: from,
        address: token,
        abi: erc20Abi,
        functionName: 'transfer',
        args: [to, amount],
        dataSuffix,
      }),
    waitForReceipt,
    getBlockTimestamp,
    recordLedger: (entry: LedgerEntry) => upsertLedgerEntry(entry),
    updateLedger: (chainId, from, hash, patch) => updateLedgerEntry(chainId, from, hash, patch),
  };
}

export function createSwapDeps(chainId: number): SwapDeps {
  const client = publicClientFor(chainId);
  const swapArgs = (q: Parameters<SwapDeps['sendSwap']>[0]) =>
    [q.quote.amountIn, q.quote.minAmountOut, [q.quote.route], q.from, q.deadline] as const;
  return {
    getConnection: connectionSnapshot,
    quoteClient: client as never,
    readAllowance: ({ chainId: id, token, owner, spender }) =>
      readContract(wagmiConfig, { chainId: id, address: token, abi: erc20Abi, functionName: 'allowance', args: [owner, spender] }),
    readTokenBalance: ({ chainId: id, token, owner }) =>
      readContract(wagmiConfig, { chainId: id, address: token, abi: erc20Abi, functionName: 'balanceOf', args: [owner] }),
    readNativeBalance: async ({ chainId: id, owner }) => (await getBalance(wagmiConfig, { chainId: id, address: owner })).value,
    sendApprove: ({ chainId: id, from, token, spender, amount }) =>
      writeContract(wagmiConfig, { chainId: id, account: from, address: token, abi: erc20Abi, functionName: 'approve', args: [spender, amount] }),
    simulateSwap: async (a) => {
      const chain = a.quote.chainId;
      await publicClientFor(chain).simulateContract({
        account: a.from,
        address: routerFor(chain),
        abi: routerAbi,
        functionName: 'swapExactTokensForTokens',
        args: swapArgs(a),
      });
    },
    sendSwap: (a) =>
      writeContract(wagmiConfig, {
        chainId: a.chainId,
        account: a.from,
        address: routerFor(a.chainId),
        abi: routerAbi,
        functionName: 'swapExactTokensForTokens',
        args: swapArgs(a),
      }),
    waitForReceipt,
    getBlockTimestamp,
    recordLedger: (entry: LedgerEntry) => upsertLedgerEntry(entry),
    updateLedger: (id, from, hash, patch) => updateLedgerEntry(id, from, hash, patch),
  };
}

export { readLedger };
