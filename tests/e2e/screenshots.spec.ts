/**
 * Deck screenshots from the real production build (live Mezo Testnet reads; the injected test wallet
 * never broadcasts). Opt-in: CAPTURE_SCREENSHOTS=1 npx playwright test screenshots --project desktop
 * Writes submission/screenshots/*.png. Nothing shown is simulated; captions in the deck say how each was taken.
 */
import { expect, test } from '@playwright/test';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { buildPaymentRequest, encodePaymentLink, typedDataFor } from '../../src/lib/paymentRequest';
import { MEZO_TESTNET } from '../../src/config/chains';
import { connectTestWallet, dismissUsernamePrompt, installTestWallet } from './testWallet';

test.skip(!process.env.CAPTURE_SCREENSHOTS, 'set CAPTURE_SCREENSHOTS=1 to capture deck screenshots');
const OUT = 'submission/screenshots';
const FUNDED_WATCH_ADDRESS = MEZO_TESTNET.pools[0].address;
const REAL_PLAIN_TRANSFER = '0x8e39d309561c8d2c8447756c6166d330837e051ee6ba258e6b5427e5b851065e';
const phone = { viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

test('phone: signed invoice with the payment stepper', async ({ browser, baseURL }) => {
  const merchant = privateKeyToAccount(generatePrivateKey());
  const req = buildPaymentRequest({ chain: MEZO_TESTNET, recipient: merchant.address, amount: 25n * 10n ** 18n, memo: 'Logo design — final files', lifetimeSeconds: 7 * 86_400 });
  const url = encodePaymentLink(baseURL!, req, await merchant.signTypedData(typedDataFor(req)));
  const ctx = await browser.newContext({ baseURL, ...phone });
  const page = await ctx.newPage();
  await installTestWallet(page, { watchAddress: FUNDED_WATCH_ADDRESS });
  await page.goto(url);
  await connectTestWallet(page);
  await dismissUsernamePrompt(page);
  await expect(page.getByTestId('payment-stepper').locator('[data-step="confirm"]')).toHaveAttribute('data-status', 'current', { timeout: 30_000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/phone-payment-stepper.png` });
  await ctx.close();
});

test('phone: proof viewer rejects a real plain transfer claimed as a settlement', async ({ browser, baseURL, request }) => {
  const merchant = privateKeyToAccount(generatePrivateKey());
  const own = buildPaymentRequest({ chain: MEZO_TESTNET, recipient: merchant.address, amount: 10n * 10n ** 18n, memo: 'Consulting — October', lifetimeSeconds: 7 * 86_400 });
  const signature = await merchant.signTypedData(typedDataFor(own));
  expect((await request.post('/api/invoices', { data: { request: own, signature } })).status()).toBe(201);
  const ctx = await browser.newContext({ baseURL, ...phone, viewport: { width: 393, height: 1500 } });
  const page = await ctx.newPage();
  await page.goto(`/#proof/${merchant.address}/${own.id}?tx=${REAL_PLAIN_TRANSFER}`);
  await expect(page.getByTestId('proof-verdict')).toHaveAttribute('data-verdict', 'failed', { timeout: 60_000 });
  await page.screenshot({ path: `${OUT}/phone-proof-rejects-plain-transfer.png`, fullPage: true });
  await ctx.close();
});

test('desktop: request sharing and Merchant Pro card', async ({ browser, baseURL }) => {
  const ctx = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await installTestWallet(page, { privateKey: generatePrivateKey() });
  await page.goto('/app/request');
  await connectTestWallet(page);
  await dismissUsernamePrompt(page);
  await page.getByLabel(/amount/i).first().fill('25');
  await page.getByLabel(/note/i).fill('Logo design — final files');
  await page.getByRole('button', { name: /sign & create request/i }).click();
  await expect(page.getByText('Saved to the invoice registry')).toBeVisible();
  await page.getByRole('button', { name: /sign in to sync across devices/i }).click();
  await expect(page.getByTestId('merchant-pro')).toContainText('9 MUSD per 30 days');
  await page.screenshot({ path: `${OUT}/desktop-share-and-pro.png`, fullPage: true });
  await page.getByTestId('merchant-pro').screenshot({ path: `${OUT}/desktop-merchant-pro.png` });
  await ctx.close();
});
