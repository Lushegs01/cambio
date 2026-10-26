/**
 * Browser end-to-end tests against the production build served by server.js.
 * They read live Mezo Testnet state through the injected test wallet but never broadcast
 * a transaction (the test wallet declines every eth_sendTransaction).
 */
import { expect, test, type Page } from '@playwright/test';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { buildPaymentRequest, encodePaymentLink, typedDataFor } from '../../src/lib/paymentRequest';
import { MEZO_TESTNET } from '../../src/config/chains';
import { connectTestWallet, dismissUsernamePrompt, installTestWallet } from './testWallet';

/** A public Mezo Testnet pool contract that holds MUSD and BTC. Used read-only ("watch" mode); no key exists for it here. */
const FUNDED_WATCH_ADDRESS = MEZO_TESTNET.pools[0].address;
const runtimeErrors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const errors: string[] = []; runtimeErrors.set(page, errors);
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    (window as any).__cspViolations = [];
    window.addEventListener('securitypolicyviolation', (event) => (window as any).__cspViolations.push(`${event.violatedDirective}: ${event.blockedURI}`));
  });
});
test.afterEach(async ({ page }) => {
  expect(runtimeErrors.get(page) ?? []).toEqual([]);
  if (!page.isClosed()) expect(await page.evaluate(() => (window as any).__cspViolations ?? [])).toEqual([]);
});

function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

async function signedLink(baseURL: string, over: { lifetimeSeconds?: number; nowSeconds?: number; amount?: bigint } = {}) {
  const recipient = privateKeyToAccount(generatePrivateKey());
  const req = buildPaymentRequest({
    chain: MEZO_TESTNET,
    recipient: recipient.address,
    amount: over.amount ?? 3n * 10n ** 18n,
    memo: 'E2E invoice',
    lifetimeSeconds: over.lifetimeSeconds ?? 3600,
    nowSeconds: over.nowSeconds,
  });
  const sig = await recipient.signTypedData(typedDataFor(req));
  return { url: encodePaymentLink(baseURL, req, sig), recipient: recipient.address, req };
}

test('landing → dashboard loads without runtime errors and serves the API', async ({ page, request }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await expect(page.locator('body')).toContainText(/cambio/i);
  await page.goto('/app');
  await expect(page.getByText(/MUSD balance/i).first()).toBeVisible();
  const health = await request.get('/api/health');
  const sqlite = process.env.E2E_IDENTITY_STORE === 'sqlite';
  expect((await health.json()).identity).toMatchObject({ available: true, durable: sqlite, kind: sqlite ? 'sqlite' : 'memory' });
  expect(errors).toEqual([]);
});

test('receive shows no address at all until a wallet is connected', async ({ page }) => {
  await page.goto('/app');
  await page.getByRole('button', { name: /^receive$/i }).first().click();
  await expect(page.getByText(/connect a wallet to get your receiving address/i)).toBeVisible();
  await expect(page.locator('text=/0x[0-9a-fA-F]{40}/')).toHaveCount(0);
});

test('connecting reads real Mezo Testnet balances (BTC and MUSD separately)', async ({ page }) => {
  const { address } = await installTestWallet(page, { privateKey: generatePrivateKey() });
  await page.goto('/app');
  await connectTestWallet(page);
  await expect(page.getByText(/Mezo Testnet/).first()).toBeVisible();
  // A brand-new key really holds nothing on testnet: both balances read as 0 from the chain.
  await expect(page.getByText(/BTC for fees/)).toBeVisible();
  await expect(page.getByText('0.00').first()).toBeVisible();
  await expect(page.getByText(new RegExp(address.slice(0, 6))).first()).toBeVisible();
});

test('claims a @username with a real wallet signature verified by the server, then resolves it from another session', async ({ page, browser, baseURL, request }) => {
  const key = generatePrivateKey();
  const { address } = await installTestWallet(page, { privateKey: key });
  await page.goto('/app');
  await connectTestWallet(page);
  const name = `e2e${Date.now().toString(36).slice(-8)}`;
  // The claim dialog opens automatically for a wallet without a username.
  const input = page.getByRole('textbox', { name: 'Username' });
  await expect(input).toBeVisible();
  if (process.env.E2E_IDENTITY_STORE === 'sqlite') await expect(page.getByText(/Development registry:/)).toHaveCount(0);
  await input.fill(name);
  await expect(page.getByText('Available')).toBeVisible();
  await page.getByRole('button', { name: /sign & claim username/i }).click();
  await expect(page.getByText(`@${name} is now verified for this wallet.`)).toBeVisible();

  const rec = await (await request.get(`/api/identity/username/${name}`)).json();
  expect(rec.record).toMatchObject({ username: name, address, verified: true });

  // A different person, in a separate browser context, resolves the name through the registry.
  const ctx = await browser.newContext({ baseURL });
  const other = await ctx.newPage();
  await installTestWallet(other, { privateKey: generatePrivateKey() });
  await other.goto('/app');
  await connectTestWallet(other);
  await dismissUsernamePrompt(other);
  await other.getByRole('button', { name: /^send musd$/i }).first().click();
  await other.getByLabel(/recipient/i).fill(`@${name}`);
  await expect(other.getByText('Verified username')).toBeVisible();
  await expect(other.getByText(address).first()).toBeVisible();
  await ctx.close();
});

test('a declined signature does not claim a username', async ({ page, request }) => {
  await installTestWallet(page, { privateKey: generatePrivateKey(), rejectSignatures: true });
  await page.goto('/app');
  await connectTestWallet(page);
  const name = `nope${Date.now().toString(36).slice(-6)}`;
  await page.getByRole('textbox', { name: 'Username' }).fill(name);
  await expect(page.getByText('Available')).toBeVisible();
  await page.getByRole('button', { name: /sign & claim username/i }).click();
  await expect(page.getByText(/signature request was declined/i)).toBeVisible();
  expect((await (await request.get(`/api/identity/username/${name}`)).json()).record).toBeNull();
});

test('a signed request opened in a separate session runs the real on-chain preflight, then respects a wallet rejection', async ({ browser, baseURL }) => {
  const { url } = await signedLink(baseURL!);
  const ctx = await browser.newContext({ baseURL });
  const page = await ctx.newPage();
  await installTestWallet(page, { watchAddress: FUNDED_WATCH_ADDRESS });
  await page.goto(url);
  await expect(page.getByText(/signed by the recipient’s wallet/i)).toBeVisible();
  await expect(page.getByText('3.00').first()).toBeVisible();
  await connectTestWallet(page);
  await dismissUsernamePrompt(page);
  await page.getByRole('button', { name: /review payment of 3\.00 musd/i }).click();
  await expect(page.getByText(/paying a request signed by the recipient/i)).toBeVisible();
  await page.getByRole('button', { name: /review transfer/i }).click();
  // Preflight read the real MUSD/BTC balances and estimated gas for the exact calldata (incl. request id).
  await expect(page.getByText(/BTC \(estimate\)/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Mezo Testnet \(chain 31611\)/).first()).toBeVisible();
  await page.getByRole('button', { name: /confirm in wallet/i }).click();
  await expect(page.getByText('Cancelled in wallet')).toBeVisible();
  await expect(page.getByText(/nothing was sent/i)).toBeVisible();
  await ctx.close();
});

test('a tampered signed link is refused before any payment UI is offered', async ({ page, baseURL }) => {
  const { url } = await signedLink(baseURL!);
  const u = new URL(url);
  const params = new URLSearchParams(u.hash.slice(u.hash.indexOf('?') + 1));
  const payload = JSON.parse(Buffer.from(params.get('r')!, 'base64url').toString('utf8'));
  payload.recipient = privateKeyToAccount(generatePrivateKey()).address; // attacker swaps in their own address
  params.set('r', Buffer.from(JSON.stringify(payload)).toString('base64url'));
  await page.goto(`/#pay?${params.toString()}`);
  await expect(page.getByText(/signature check failed — do not pay/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /review payment/i })).toHaveCount(0);
});

test('expired and malformed links are not payable', async ({ page, baseURL }) => {
  const { url } = await signedLink(baseURL!, { nowSeconds: Math.floor(Date.now() / 1000) - 7200, lifetimeSeconds: 3600 });
  await page.goto(url);
  await expect(page.getByText(/this request has expired/i)).toBeVisible();
  await page.goto('/#pay?r=not-base64!!&s=0x00');
  await expect(page.getByText(/this payment link is not valid/i)).toBeVisible();
});

test('sending more MUSD than the wallet really holds is stopped by a live balance check', async ({ page }) => {
  await installTestWallet(page, { privateKey: generatePrivateKey() });
  await page.goto('/app');
  await connectTestWallet(page);
  await dismissUsernamePrompt(page);
  await page.getByRole('button', { name: /^send musd$/i }).first().click();
  await page.getByLabel(/recipient/i).fill(FUNDED_WATCH_ADDRESS);
  await page.getByLabel(/amount \(musd\)/i).fill('1');
  await expect(page.getByText('Valid address')).toBeVisible();
  await page.getByRole('button', { name: /review transfer/i }).click();
  await expect(page.getByText(/exceeds your balance of 0\.00 MUSD/i)).toBeVisible();
});

test('a network change in the wallet is detected, hides balances, and can be switched back from the app', async ({ page }) => {
  await installTestWallet(page, { privateKey: generatePrivateKey() });
  await page.goto('/app');
  await connectTestWallet(page);
  await dismissUsernamePrompt(page);
  await expect(page.getByText(/BTC for fees/)).toBeVisible();
  // The user switches their wallet to Ethereum mainnet.
  await page.evaluate(() => (window as any).__cambioTestWallet.setChain('0x1'));
  await expect(page.getByText(/unsupported network \(chain 1\)/i).first()).toBeVisible();
  await expect(page.getByText(/BTC for fees/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: /switch to mezo testnet/i }).first()).toBeVisible();
  // AppKit also opens its own "Switch Network" dialog; pick Mezo Testnet there, as a user would.
  const appkitDialog = page.getByRole('alertdialog');
  await expect(appkitDialog.getByText(/switch network/i)).toBeVisible();
  await appkitDialog.getByText('Mezo Testnet').first().click();
  await expect(page.getByText(/BTC for fees/)).toBeVisible();
  await expect(page.getByRole('button', { name: /switch to mezo testnet/i })).toHaveCount(0);
});

test('swap shows a live router quote with the on-chain pool fee, and stops at the wallet', async ({ page }) => {
  await installTestWallet(page, { watchAddress: FUNDED_WATCH_ADDRESS });
  await page.goto('/app/swap');
  await connectTestWallet(page);
  await dismissUsernamePrompt(page);
  await page.getByLabel(/you pay/i).fill('1');
  await expect(page.getByText(/Router\.getAmountsOut · block \d+/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('0.04%')).toBeVisible(); // testnet MUSD/BTC fee read from PoolFactory.getFee
  await page.getByRole('button', { name: /review swap/i }).click();
  await page.getByRole('button', { name: /confirm in wallet/i }).click();
  await expect(page.getByText('Cancelled in wallet')).toBeVisible({ timeout: 30_000 });
});

test('disconnecting clears wallet state', async ({ page }) => {
  await installTestWallet(page, { privateKey: generatePrivateKey() });
  await page.goto('/app');
  await connectTestWallet(page);
  await dismissUsernamePrompt(page);
  await expect(page.getByText(/BTC for fees/)).toBeVisible();
  await page.getByRole('button', { name: /connected wallet menu/i }).click();
  await page.getByRole('button', { name: /disconnect wallet/i }).first().click();
  await expect(page.getByText(/No wallet connected/i)).toBeVisible();
  await expect(page.getByText(/BTC for fees/)).toHaveCount(0);
});

test('@mobile core screens fit a phone without horizontal scrolling', async ({ page, baseURL }) => {
  await page.goto('/app');
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(await overflow()).toBeLessThanOrEqual(1);
  await page.getByRole('button', { name: /open sidebar menu/i }).click();
  await expect(page.getByRole('dialog', { name: /navigation/i })).toBeVisible();
  await page.getByRole('dialog', { name: /navigation/i }).getByRole('button', { name: /send musd/i }).click();
  await expect(page.getByRole('heading', { name: /send musd/i })).toBeVisible();
  await page.getByLabel(/close dialog/i).click();
  const { url } = await signedLink(baseURL!);
  await page.goto(url);
  await expect(page.getByText(/signed by the recipient’s wallet/i)).toBeVisible();
  expect(await overflow()).toBeLessThanOrEqual(1);
});

test('hash navigation replaces the request recipient and resets verification', async ({ page, baseURL }) => {
  const first = await signedLink(baseURL!); const second = await signedLink(baseURL!);
  await page.goto(first.url); await expect(page.getByText(first.recipient, { exact: true })).toBeVisible();
  await page.goto(second.url); await expect(page.getByText(second.recipient, { exact: true })).toBeVisible();
  await expect(page.getByText(first.recipient, { exact: true })).toHaveCount(0);
  await expect(page.getByText(/signed by the recipient’s wallet/i)).toBeVisible();
  await page.reload(); await expect(page.getByText(second.recipient, { exact: true })).toBeVisible();
});

test('storage denial does not crash startup or theme controls', async ({ page }) => {
  await page.addInitScript(() => {
    const deny = () => { throw new DOMException('Storage disabled', 'SecurityError'); };
    Object.defineProperty(window, 'localStorage', { get: deny });
  });
  await page.goto('/app'); await expect(page.getByText(/MUSD balance/i).first()).toBeVisible();
  await page.getByRole('button', { name: /switch to dark mode/i }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('direct routes, assets and API errors are served by production Express with CSP', async ({ request, page }) => {
  for (const path of ['/app/activity', '/app/request', '/app/swap', '/app/settings', '/pay?to=0x0000000000000000000000000000000000000b0b']) {
    const res = await request.get(path); expect(res.status()).toBe(200); expect(res.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
  }
  for (const path of ['/manifest.json', '/logo.png', '/theme-init.js']) expect((await request.get(path)).status()).toBe(200);
  expect((await request.get('/api/unknown')).status()).toBe(404);
  expect((await request.get('/assets/not-a-real-chunk.js')).status()).toBe(404);
  await page.goto('/app/settings'); await page.reload(); await expect(page.getByRole('heading', { name: /settings/i }).first()).toBeVisible();
});

test('recipient creates a signed request through its real wallet signature and opens it', async ({ page }) => {
  await installTestWallet(page, { privateKey: generatePrivateKey() });
  await page.goto('/app/request'); await connectTestWallet(page); await dismissUsernamePrompt(page);
  await page.getByLabel(/amount/i).first().fill('5');
  await page.getByRole('button', { name: /sign & create request/i }).click();
  await expect(page.getByText('Signed request', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^preview$/i }).click();
  await expect(page.getByText(/signed by the recipient’s wallet/i)).toBeVisible();
});

test('empty testnet pool is unavailable and quotes are labeled as test liquidity', async ({ page }) => {
  await installTestWallet(page, { watchAddress: FUNDED_WATCH_ADDRESS });
  await page.goto('/app/swap'); await connectTestWallet(page); await dismissUsernamePrompt(page);
  await expect(page.getByText(/not market rates/i)).toBeVisible();
  await page.getByRole('radio', { name: /^mUSDT$/ }).last().click();
  await page.getByLabel(/you pay/i).fill('1');
  await expect(page.getByText(/insufficient liquidity/i)).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole('button', { name: /review swap/i })).toBeDisabled();
});
