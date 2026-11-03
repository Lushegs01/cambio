/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * "Open in MetaMask" for phone browsers.
 *
 * Chrome or Safari on a phone has no wallet built in, so Connect Wallet hands off to the wallet app over
 * WalletConnect. The wallet SDK only opens the app after it has created the WalletConnect pairing, a second
 * or more after the tap, and iOS does not let a page open another app unless that happens straight from a
 * tap. A plain link that the user taps does not have that problem, so on phones we also offer MetaMask's
 * documented link that opens this page inside the MetaMask app's browser, where the wallet is built in and
 * no hand-off is needed.
 */

/** MetaMask's universal link that opens a site in the MetaMask mobile app's browser. */
export const METAMASK_DAPP_LINK_PREFIX = 'https://link.metamask.io/dapp/';

export interface BrowserEnvironment {
  userAgent: string;
  maxTouchPoints: number;
  /** True when a wallet has injected a provider into the page (window.ethereum). */
  hasInjectedWallet: boolean;
}

/**
 * The link that opens `pageHref` inside MetaMask, or null when it cannot be offered. The path, query and
 * fragment are kept, so a payment link opens the same request inside MetaMask. MetaMask always loads the
 * target over HTTPS, so plain-HTTP pages (local development) get no link.
 */
export function metaMaskDappLink(pageHref: string): string | null {
  let url: URL;
  try {
    url = new URL(pageHref);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return null;
  return `${METAMASK_DAPP_LINK_PREFIX}${url.host}${url.pathname}${url.search}${url.hash}`;
}

/** iPhone, iPod, iPad (including iPadOS's Mac-style user agent) and Android. */
export function isPhoneOrTablet(env: Pick<BrowserEnvironment, 'userAgent' | 'maxTouchPoints'>): boolean {
  if (/iPhone|iPad|iPod|Android/i.test(env.userAgent)) return true;
  // iPadOS reports a Mac user agent by default; Macs have no touch screen.
  return /Macintosh/.test(env.userAgent) && env.maxTouchPoints > 1;
}

/**
 * The "Open in MetaMask" link for this page, or null when it should not be shown: on desktops (extensions
 * connect directly) and inside a wallet's own browser (MetaMask's included), where a wallet is injected.
 */
export function openInMetaMaskHref(env: BrowserEnvironment | null, pageHref: string): string | null {
  if (!env || !isPhoneOrTablet(env) || env.hasInjectedWallet) return null;
  return metaMaskDappLink(pageHref);
}

export function currentBrowserEnvironment(): BrowserEnvironment | null {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return null;
  return {
    userAgent: navigator.userAgent || '',
    maxTouchPoints: navigator.maxTouchPoints || 0,
    hasInjectedWallet: Boolean((window as Window & { ethereum?: unknown }).ethereum),
  };
}

export function currentPageHref(): string {
  return typeof window === 'undefined' ? '' : window.location.href;
}
