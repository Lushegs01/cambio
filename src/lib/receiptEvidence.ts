import { decodeEventLog, type Address, type Hex, type Log } from 'viem';
import { erc20Abi } from '../config/abis';
import type { LedgerEntry, LedgerStatus, ReceiptLike } from './transactions';

export interface ReceiptWithLogs extends ReceiptLike {
  logs: readonly Pick<Log, 'address' | 'topics' | 'data'>[];
}

function transfers(receipt: ReceiptLike & { logs?: ReceiptWithLogs['logs'] }) {
  return (receipt.logs ?? []).flatMap((log) => {
    try {
      const event = decodeEventLog({ abi: erc20Abi, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
      return event.eventName === 'Transfer' ? [{ token: log.address, ...event.args }] : [];
    } catch { return []; }
  });
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function receiptHasTransfer(receipt: ReceiptWithLogs, token: Address, from: Address, to: Address, amount: bigint): boolean {
  return transfers(receipt).some((e) => same(e.token, token) && same(e.from, from) && same(e.to, to) && e.value === amount);
}

export function receivedFromReceipt(receipt: ReceiptWithLogs, token: Address, to: Address): bigint {
  return transfers(receipt).filter((e) => same(e.token, token) && same(e.to, to)).reduce((sum, e) => sum + e.value, 0n);
}

/** Receipt success alone does not prove the intended financial operation happened. */
export function ledgerReceiptStatus(entry: LedgerEntry, receipt: ReceiptLike & { logs?: ReceiptWithLogs['logs'] }): LedgerStatus {
  if (receipt.status === 'reverted') return 'reverted';
  if (receipt.status !== 'success') return 'unknown';
  if (!receipt.logs) return 'unknown';
  const evidence = receipt as ReceiptWithLogs;
  if (entry.kind === 'transfer') {
    return receiptHasTransfer(evidence, entry.token, entry.from, entry.to, BigInt(entry.amount)) ? 'confirmed' : 'unknown';
  }
  if (entry.kind === 'swap' && entry.swap) {
    const spent = transfers(evidence).filter((e) => same(e.token, entry.token) && same(e.from, entry.from)).reduce((sum, e) => sum + e.value, 0n);
    const received = receivedFromReceipt(evidence, entry.swap.tokenOut, entry.from);
    return spent === BigInt(entry.amount) && received > 0n && received >= BigInt(entry.swap.minAmountOut) ? 'confirmed' : 'unknown';
  }
  return 'unknown';
}
