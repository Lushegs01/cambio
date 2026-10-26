import { explorerAddressUrl, explorerTxUrl, getDefaultChain, getKnownChainConfig } from '../config/chains';

/**
 * Format wallet address into shortened format: 0x12…89AB
 */
export function shortenAddress(address?: string | null, startChars = 6, endChars = 4): string {
  if (!address) return '';
  if (address.length <= startChars + endChars) return address;
  return `${address.slice(0, startChars)}…${address.slice(-endChars)}`;
}

function chainFor(chainId: number | string | null | undefined) {
  // No chain given: the default (testnet) explorer. An unknown non-Mezo chain: no link at all,
  // rather than a link to the wrong network's explorer.
  return chainId === null || chainId === undefined ? getDefaultChain() : getKnownChainConfig(chainId);
}

export function getExplorerAddressUrl(address?: string | null, chainId?: number | string | null): string | null {
  const chain = chainFor(chainId);
  return address && chain ? explorerAddressUrl(chain, address) : null;
}

export function getExplorerTxUrl(hash?: string | null, chainId?: number | string | null): string | null {
  const chain = chainFor(chainId);
  return hash && chain ? explorerTxUrl(chain, hash) : null;
}

export function formatDateTime(ms: number | null | undefined): string {
  if (!ms) return 'Time unknown';
  const d = new Date(ms);
  const sameDay = new Date().toDateString() === d.toDateString();
  return sameDay
    ? `Today, ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
    : d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
