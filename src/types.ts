import type { Address } from 'viem';
import type { MezoChainConfig } from './config/chains';
import type { WalletBalances } from './lib/balances';

export type NavItemKey = 'overview' | 'send' | 'receive' | 'request' | 'swap' | 'activity' | 'notifications' | 'settings';

export type WalletConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'reconnecting';

/**
 * Everything the UI knows about the connected wallet.
 * `chain` is non-null only for a network this build supports; every Mezo-specific action requires it.
 * Balances are typed per asset (see lib/balances.ts): native BTC and the MUSD ERC-20 are never mixed.
 */
export interface WalletState {
  isConnected: boolean;
  status: WalletConnectionStatus;
  address: Address | null;
  walletName: string | null;
  chainId: number | null;
  networkName: string | null;
  chain: MezoChainConfig | null;
  isSupportedNetwork: boolean;
  balances: WalletBalances;
  /** Verified username from the identity API, or null. */
  username: string | null;
  /** 'demo' means every balance and transaction shown is simulated. */
  dataMode: 'real' | 'demo';
}

export interface NotificationItem {
  id: string;
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
  type: 'system' | 'payment' | 'wallet';
}

export type FiatCurrencyCode = 'USD' | 'NGN' | 'EUR' | 'GBP' | 'CAD' | 'GHS' | 'KES' | 'ZAR';

export interface SupportedCurrency {
  code: FiatCurrencyCode;
  name: string;
  symbol: string;
  flag: string;
  locale: string;
  decimals: number;
}

