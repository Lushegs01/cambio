/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Single source of truth for every network, token and contract Cambio touches.
 *
 * Every address below was checked on 2026-10-22 against:
 *  - the official Mezo docs (github.com/mezo-org/documentation:
 *    users/resources/contracts-reference.md and developers/features/mezo-pools.md), and
 *  - the live chains, by calling name()/symbol()/decimals() on each token, token0()/token1()/stable()
 *    on each pool, and Router.getAmountsOut() on each router.
 *
 * Do not add an address here without repeating that verification.
 */

import type { Address } from 'viem';

export type MezoNetworkKey = 'testnet' | 'mainnet';

export interface TokenConfig {
  symbol: 'MUSD' | 'BTC' | 'mUSDC' | 'mUSDT';
  name: string;
  /** ERC-20 contract. For BTC this is Mezo's BTC precompile, whose balanceOf mirrors the native balance. */
  address: Address;
  decimals: number;
  /** True for BTC: it is also the chain's native gas currency. */
  isNative: boolean;
}

export interface PoolConfig {
  address: Address;
  tokenA: TokenConfig['symbol'];
  tokenB: TokenConfig['symbol'];
  stable: boolean;
}

export interface MezoChainConfig {
  key: MezoNetworkKey;
  chainId: number;
  name: string;
  isTestnet: boolean;
  rpcUrls: readonly string[];
  explorerUrl: string;
  explorerApiUrl: string;
  faucetUrl: string | null;
  tokens: Record<TokenConfig['symbol'], TokenConfig>;
  /** Aerodrome-style router: swapExactTokensForTokens(amountIn, amountOutMin, Route[], to, deadline). */
  router: Address;
  poolFactory: Address;
  pools: readonly PoolConfig[];
}

const BTC_PRECOMPILE: Address = '0x7b7C000000000000000000000000000000000000';

export const MEZO_TESTNET: MezoChainConfig = {
  key: 'testnet',
  chainId: 31611,
  name: 'Mezo Testnet',
  isTestnet: true,
  rpcUrls: ['https://rpc.test.mezo.org'],
  explorerUrl: 'https://explorer.test.mezo.org',
  explorerApiUrl: 'https://api.explorer.test.mezo.org',
  faucetUrl: 'https://faucet.test.mezo.org',
  tokens: {
    MUSD: { symbol: 'MUSD', name: 'Mezo USD', address: '0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503', decimals: 18, isNative: false },
    BTC: { symbol: 'BTC', name: 'Bitcoin', address: BTC_PRECOMPILE, decimals: 18, isNative: true },
    mUSDC: { symbol: 'mUSDC', name: 'Mezo bridged USDC', address: '0xe1a26db653708A2AD8F824E92Db9852410e33A59', decimals: 6, isNative: false },
    mUSDT: { symbol: 'mUSDT', name: 'Mezo bridged USDT', address: '0x629320719a6190bd145C277226fd45e7648F950A', decimals: 6, isNative: false },
  },
  router: '0x9a1ff7FE3a0F69959A3fBa1F1e5ee18e1A9CD7E9',
  poolFactory: '0x4947243CC818b627A5D06d14C4eCe7398A23Ce1A',
  pools: [
    { address: '0xd16A5Df82120ED8D626a1a15232bFcE2366d6AA9', tokenA: 'MUSD', tokenB: 'BTC', stable: false },
    { address: '0x525F049A4494dA0a6c87E3C4df55f9929765Dc3e', tokenA: 'MUSD', tokenB: 'mUSDC', stable: true },
    { address: '0x27414B76CF00E24ed087adb56E26bAeEEe93494e', tokenA: 'MUSD', tokenB: 'mUSDT', stable: true },
  ],
};

export const MEZO_MAINNET: MezoChainConfig = {
  key: 'mainnet',
  chainId: 31612,
  name: 'Mezo Mainnet',
  isTestnet: false,
  rpcUrls: ['https://mezo.drpc.org', 'https://mezo-mainnet.boar.network'],
  explorerUrl: 'https://explorer.mezo.org',
  explorerApiUrl: 'https://api.explorer.mezo.org',
  faucetUrl: null,
  tokens: {
    MUSD: { symbol: 'MUSD', name: 'Mezo USD', address: '0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186', decimals: 18, isNative: false },
    BTC: { symbol: 'BTC', name: 'Bitcoin', address: BTC_PRECOMPILE, decimals: 18, isNative: true },
    mUSDC: { symbol: 'mUSDC', name: 'Mezo bridged USDC', address: '0x04671C72Aab5AC02A03c1098314b1BB6B560c197', decimals: 6, isNative: false },
    mUSDT: { symbol: 'mUSDT', name: 'Mezo bridged USDT', address: '0xeB5a5d39dE4Ea42C2Aa6A57EcA2894376683bB8E', decimals: 6, isNative: false },
  },
  router: '0x16A76d3cd3C1e3CE843C6680d6B37E9116b5C706',
  poolFactory: '0x83FE469C636C4081b87bA5b3Ae9991c6Ed104248',
  pools: [
    { address: '0x52e604c44417233b6CcEDDDc0d640A405Caacefb', tokenA: 'MUSD', tokenB: 'BTC', stable: false },
    { address: '0xEd812AEc0Fecc8fD882Ac3eccC43f3aA80A6c356', tokenA: 'MUSD', tokenB: 'mUSDC', stable: true },
    { address: '0x10906a9E9215939561597b4C8e4b98F93c02031A', tokenA: 'MUSD', tokenB: 'mUSDT', stable: true },
  ],
};

const ALL_CHAINS: readonly MezoChainConfig[] = [MEZO_TESTNET, MEZO_MAINNET];

/**
 * Mainnet carries real funds. It is only offered when explicitly enabled at build time,
 * so a default build can be demonstrated end-to-end without risking real money.
 */
export function isMainnetEnabled(): boolean {
  try {
    return import.meta.env?.VITE_ENABLE_MAINNET === 'true';
  } catch {
    return false;
  }
}

export function getEnabledChains(): readonly MezoChainConfig[] {
  return isMainnetEnabled() ? ALL_CHAINS : [MEZO_TESTNET];
}

export function toChainIdNumber(chainId: number | string | null | undefined): number | null {
  if (chainId === null || chainId === undefined || chainId === '') return null;
  if (typeof chainId === 'number') return Number.isSafeInteger(chainId) ? chainId : null;
  const raw = chainId.startsWith('eip155:') ? chainId.slice('eip155:'.length) : chainId;
  if (!/^(?:0x[0-9a-fA-F]+|[0-9]+)$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/** Returns the config only for chains this build supports; anything else is unsupported. */
export function getChainConfig(chainId: number | string | null | undefined): MezoChainConfig | null {
  const id = toChainIdNumber(chainId);
  if (id === null) return null;
  return getEnabledChains().find((c) => c.chainId === id) ?? null;
}

/** Like getChainConfig but ignores the mainnet build flag. Used to label links for any known Mezo chain. */
export function getKnownChainConfig(chainId: number | string | null | undefined): MezoChainConfig | null {
  const id = toChainIdNumber(chainId);
  if (id === null) return null;
  return ALL_CHAINS.find((c) => c.chainId === id) ?? null;
}

export function isSupportedChainId(chainId: number | string | null | undefined): boolean {
  return getChainConfig(chainId) !== null;
}

export function getDefaultChain(): MezoChainConfig {
  return MEZO_TESTNET;
}

export function findTokenByAddress(chain: MezoChainConfig, address: string): TokenConfig | null {
  const lower = address.toLowerCase();
  return Object.values(chain.tokens).find((t) => t.address.toLowerCase() === lower) ?? null;
}

export function findPool(
  chain: MezoChainConfig,
  a: TokenConfig['symbol'],
  b: TokenConfig['symbol']
): PoolConfig | null {
  return (
    chain.pools.find((p) => (p.tokenA === a && p.tokenB === b) || (p.tokenA === b && p.tokenB === a)) ?? null
  );
}

export function explorerTxUrl(chain: MezoChainConfig, hash: string): string {
  return `${chain.explorerUrl}/tx/${hash}`;
}

export function explorerAddressUrl(chain: MezoChainConfig, address: string): string {
  return `${chain.explorerUrl}/address/${address}`;
}

export function explorerTokenUrl(chain: MezoChainConfig, address: string): string {
  return `${chain.explorerUrl}/token/${address}`;
}
