/**
 * Test-only helpers. Nothing here is imported by production code.
 */
import { defineChain, encodeAbiParameters, encodeEventTopics, getAddress, type Address, type Hex } from 'viem';
import { erc20Abi } from '../src/config/abis';
import type { ReceiptWithLogs } from '../src/lib/musdTransfer';

export const mezoTestnetLike = defineChain({
  id: 31611,
  name: 'Mezo Testnet',
  nativeCurrency: { name: 'Bitcoin', symbol: 'BTC', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.test.mezo.org'] } },
});

export const ALICE: Address = getAddress('0x00000000000000000000000000000000000a11ce');
export const BOB: Address = getAddress('0x0000000000000000000000000000000000000b0b');
export const HASH = ('0x' + 'ab'.repeat(32)) as Hex;

export function transferLog(token: Address, from: Address, to: Address, value: bigint) {
  return {
    address: token,
    topics: encodeEventTopics({ abi: erc20Abi, eventName: 'Transfer', args: { from, to } }) as [Hex, ...Hex[]],
    data: encodeAbiParameters([{ type: 'uint256' }], [value]),
  };
}

export function receipt(status: 'success' | 'reverted', logs: ReceiptWithLogs['logs'] = []): ReceiptWithLogs {
  return { status, blockNumber: 1234n, gasUsed: 34_000n, effectiveGasPrice: 150n, logs };
}

/** In-memory Storage for ledger tests. */
export class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
}
