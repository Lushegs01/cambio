// @vitest-environment jsdom
/**
 * "Open in MetaMask" for phone browsers: which pages get the link, what it points to, and where it is shown.
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { BrowserEnvironment } from '../src/lib/openInWallet';
import { MEZO_TESTNET } from '../src/config/chains';
import { buildPaymentRequest, encodePaymentLink, parsePaymentLink } from '../src/lib/paymentRequest';
import { ALICE } from './helpers';

const browser = vi.hoisted(() => ({ env: null as BrowserEnvironment | null, href: '' }));
vi.mock('../src/lib/openInWallet', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/openInWallet')>();
  return { ...actual, currentBrowserEnvironment: () => browser.env, currentPageHref: () => browser.href };
});

const { METAMASK_DAPP_LINK_PREFIX, isPhoneOrTablet, metaMaskDappLink, openInMetaMaskHref } = await import('../src/lib/openInWallet');
const { OpenInMetaMask } = await import('../src/components/OpenInMetaMask');
const { FirstTimeNotice } = await import('../src/components/FirstTimeNotice');

const UA = {
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1',
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  windowsChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
};
const env = (userAgent: string, over: Partial<BrowserEnvironment> = {}): BrowserEnvironment => ({ userAgent, maxTouchPoints: 0, hasInjectedWallet: false, ...over });

/** Mirrors MetaMask mobile's handling of a /dapp/ universal link: the rest of the URL, opened over https. */
const pageMetaMaskOpens = (link: string) => `https://${link.slice(METAMASK_DAPP_LINK_PREFIX.length)}`;

afterEach(cleanup);

describe('metaMaskDappLink', () => {
  it('points MetaMask at the same page, keeping path, query and fragment', () => {
    expect(metaMaskDappLink('https://cambio-five.vercel.app/app')).toBe('https://link.metamask.io/dapp/cambio-five.vercel.app/app');
    expect(metaMaskDappLink('https://cambio.example:8443/app/request?x=1#top')).toBe('https://link.metamask.io/dapp/cambio.example:8443/app/request?x=1#top');
  });

  it('carries a signed payment link into MetaMask unchanged', () => {
    const req = buildPaymentRequest({ chain: MEZO_TESTNET, recipient: ALICE, amount: 5n * 10n ** 18n, memo: 'Invoice #7 & tip', lifetimeSeconds: 3600 });
    const payLink = encodePaymentLink('https://cambio-five.vercel.app', req, `0x${'ab'.repeat(65)}`);
    const link = metaMaskDappLink(payLink)!;
    expect(pageMetaMaskOpens(link)).toBe(payLink);
    expect(parsePaymentLink(pageMetaMaskOpens(link))).toEqual(parsePaymentLink(payLink));
  });

  it('offers no link for plain-HTTP pages, credentials in the URL, or unparseable input', () => {
    expect(metaMaskDappLink('http://localhost:3000/app')).toBeNull();
    expect(metaMaskDappLink('https://user:pw@cambio.example/app')).toBeNull();
    expect(metaMaskDappLink('not a url')).toBeNull();
  });
});

describe('when the link is offered', () => {
  it('detects phones and tablets, including iPadOS with its Mac user agent', () => {
    expect(isPhoneOrTablet(env(UA.iphoneChrome))).toBe(true);
    expect(isPhoneOrTablet(env(UA.iphoneSafari))).toBe(true);
    expect(isPhoneOrTablet(env(UA.androidChrome))).toBe(true);
    expect(isPhoneOrTablet(env(UA.macSafari, { maxTouchPoints: 5 }))).toBe(true);
    expect(isPhoneOrTablet(env(UA.macSafari))).toBe(false);
    expect(isPhoneOrTablet(env(UA.windowsChrome))).toBe(false);
  });

  it('is offered in phone browsers without a wallet, and not on desktops or inside a wallet browser', () => {
    const page = 'https://cambio-five.vercel.app/app';
    expect(openInMetaMaskHref(env(UA.iphoneChrome), page)).toBe('https://link.metamask.io/dapp/cambio-five.vercel.app/app');
    expect(openInMetaMaskHref(env(UA.androidChrome), page)).not.toBeNull();
    expect(openInMetaMaskHref(env(UA.iphoneSafari, { hasInjectedWallet: true }), page)).toBeNull();
    expect(openInMetaMaskHref(env(UA.windowsChrome), page)).toBeNull();
    expect(openInMetaMaskHref(null, page)).toBeNull();
  });
});

describe('OpenInMetaMask', () => {
  it('renders a plain link the user taps, pointing at the current page', () => {
    browser.env = env(UA.iphoneChrome);
    browser.href = 'https://cambio-five.vercel.app/app';
    render(<OpenInMetaMask />);
    const link = screen.getByRole('link', { name: /open in metamask app/i });
    expect(link.getAttribute('href')).toBe('https://link.metamask.io/dapp/cambio-five.vercel.app/app');
    expect(link.getAttribute('target')).toBeNull();
  });

  it('follows in-app navigation that happened after it rendered', () => {
    browser.env = env(UA.iphoneChrome);
    browser.href = 'https://cambio-five.vercel.app/';
    render(<OpenInMetaMask />);
    const link = screen.getByRole('link', { name: /open in metamask app/i }) as HTMLAnchorElement;
    browser.href = 'https://cambio-five.vercel.app/app/request';
    link.addEventListener('click', (e) => e.preventDefault());
    link.click();
    expect(link.getAttribute('href')).toBe('https://link.metamask.io/dapp/cambio-five.vercel.app/app/request');
  });

  it('is shown next to Connect Wallet on a phone, and absent on a desktop', () => {
    browser.href = 'https://cambio-five.vercel.app/app';
    browser.env = env(UA.iphoneChrome);
    render(<FirstTimeNotice onConnectWallet={() => undefined} />);
    expect(screen.getByRole('button', { name: /connect wallet/i })).toBeTruthy();
    expect(screen.getByRole('link', { name: /open in metamask app/i })).toBeTruthy();
    cleanup();

    browser.env = env(UA.windowsChrome);
    render(<FirstTimeNotice onConnectWallet={() => undefined} />);
    expect(screen.getByRole('button', { name: /connect wallet/i })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /open in metamask app/i })).toBeNull();
  });
});
