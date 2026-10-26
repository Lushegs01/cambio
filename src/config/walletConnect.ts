import { createAppKit } from '@reown/appkit/react';
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi';
import { defineChain, type AppKitNetwork } from '@reown/appkit/networks';
import { QueryClient } from '@tanstack/react-query';
import { fallback, http, type Transport } from 'viem';
import { getEnabledChains, getDefaultChain, type MezoChainConfig } from './chains';

// Reown / WalletConnect Project ID. Set VITE_WALLETCONNECT_PROJECT_ID for any deployed build:
// the public fallback below is only suitable for local evaluation and may be rejected by Reown
// for origins it has not allow-listed.
const configuredProjectId =
  typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env.VITE_WALLETCONNECT_PROJECT_ID : undefined;
export const projectId = configuredProjectId || 'b56e18d47c72ab683b10814fe9495694';
if (!configuredProjectId && typeof console !== 'undefined') {
  console.warn('[cambio] VITE_WALLETCONNECT_PROJECT_ID is not set; using the shared evaluation project ID.');
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

function toAppKitNetwork(chain: MezoChainConfig): AppKitNetwork {
  return defineChain({
    id: chain.chainId,
    caipNetworkId: `eip155:${chain.chainId}`,
    chainNamespace: 'eip155',
    name: chain.name,
    nativeCurrency: { decimals: 18, name: 'Bitcoin', symbol: 'BTC' },
    rpcUrls: { default: { http: [...chain.rpcUrls] } },
    blockExplorers: { default: { name: `${chain.name} Explorer`, url: chain.explorerUrl } },
    testnet: chain.isTestnet,
  });
}

const enabledChains = getEnabledChains();
const appKitNetworks = enabledChains.map(toAppKitNetwork) as [AppKitNetwork, ...AppKitNetwork[]];
const defaultNetwork = appKitNetworks.find((n) => n.id === getDefaultChain().chainId) ?? appKitNetworks[0];

// Explicit transports: every read goes to the verified RPCs for that chain, with failover and a timeout,
// so a dead endpoint surfaces as an error instead of hanging or silently returning zero.
const transports = Object.fromEntries(
  enabledChains.map((c) => [
    c.chainId,
    fallback(c.rpcUrls.map((url) => http(url, { timeout: 10_000, retryCount: 1 }))),
  ])
) as Record<number, Transport>;

export const metadata = {
  name: 'Cambio',
  description: 'Non-custodial MUSD payments on Mezo',
  url: typeof window !== 'undefined' ? window.location.origin : 'https://cambio.finance',
  icons: [typeof window !== 'undefined' ? `${window.location.origin}/logo.png` : 'https://cambio.finance/logo.png'],
};

export const wagmiAdapter = new WagmiAdapter({
  projectId,
  networks: appKitNetworks,
  transports,
});

export const wagmiConfig = wagmiAdapter.wagmiConfig;

export const appKit = createAppKit({
  adapters: [wagmiAdapter],
  networks: appKitNetworks,
  defaultNetwork,
  allowUnsupportedChain: false,
  // Coinbase/Base's optional SDK connectors inject inline analytics even with AppKit analytics off.
  // Their browser extensions remain available through EIP-6963, and mobile wallets via WalletConnect.
  enableCoinbase: false,
  enableBaseAccount: false,
  projectId,
  metadata,
  themeMode: 'light',
  themeVariables: {
    '--w3m-accent': '#315EF7',
    '--w3m-border-radius-master': '1px',
    '--w3m-font-family': 'Inter, sans-serif',
  },
  features: {
    analytics: false,
    email: false,
    socials: false,
    swaps: false,
    onramp: false,
  },
});
