/**
 * Captures app screenshots from a locally running production build (same setup as record-demo.ts):
 *
 *   npx tsx demo/screenshots.ts        # writes demo/screenshots/*.png
 *
 * Reads live Mezo Testnet state through the e2e test wallet, which never broadcasts.
 */
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Browser, Page } from '@playwright/test';
import { generatePrivateKey } from 'viem/accounts';
import { MEZO_TESTNET } from '../src/config/chains';
import { installTestWallet } from '../tests/e2e/testWallet';

const BASE = process.env.DEMO_BASE_URL || 'http://localhost:4173';
const OUT = path.resolve('demo/screenshots');
const FUNDED_WATCH_ADDRESS = MEZO_TESTNET.pools[0].address;
const executablePath = existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function newPage(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2, colorScheme: 'dark' });
  // tsx (esbuild keepNames) wraps named functions in __name(); define it so serialized init scripts run in the page.
  await ctx.addInitScript({ content: 'window.__name = (f) => f;' });
  await ctx.addInitScript(() => { try { localStorage.setItem('cambio_theme', 'dark'); } catch { /* optional */ } });
  return ctx.newPage();
}

async function connect(page: Page) {
  await page.getByRole('button', { name: /connect wallet/i }).first().click();
  await page.getByText('Cambio Test Wallet').first().click({ timeout: 30_000 });
}

async function dismissUsername(page: Page) {
  const later = page.getByRole('button', { name: /i’ll do this later/i });
  try { await later.waitFor({ state: 'visible', timeout: 6_000 }); await later.click(); } catch { /* not shown */ }
}

async function shot(page: Page, name: string) {
  await page.mouse.move(0, 0);
  await sleep(900);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log(`saved ${name}.png`);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  // DEMO_PLAYWRIGHT lets you use a Playwright install that matches the local browsers.
  const pw = await import(process.env.DEMO_PLAYWRIGHT || '@playwright/test');
  const chromium = pw.chromium ?? pw.default.chromium;
  const browser: Browser = await chromium.launch({ executablePath });
  const recipientKey = generatePrivateKey();
  const username = `maya${Date.now().toString(36).slice(-3)}`;

  const landing = await newPage(browser);
  await landing.goto(`${BASE}/`);
  await landing.getByText('Money moves simpler.').waitFor();
  await landing.evaluate(() => document.fonts.ready);
  await shot(landing, '1-landing');

  // The recipient claims a username, then signs a request.
  const recipient = await newPage(browser);
  await installTestWallet(recipient, { privateKey: recipientKey });
  await recipient.goto(`${BASE}/app`);
  await connect(recipient);
  await recipient.getByRole('textbox', { name: 'Username' }).fill(username);
  await recipient.getByText('Available').waitFor();
  await recipient.getByRole('button', { name: /sign & claim username/i }).click();
  await recipient.getByText(`@${username} is now verified for this wallet.`).waitFor();
  await recipient.getByRole('navigation', { name: 'Main Navigation' }).getByRole('button', { name: /^request$/i }).click();
  await recipient.getByLabel(/amount/i).first().fill('250');
  await recipient.locator('#request-note').fill('Invoice #042 — brand identity');
  await recipient.getByRole('button', { name: /sign & create request/i }).click();
  await recipient.getByText('Signed request', { exact: true }).waitFor();
  const link = await recipient.getByLabel('Payment link').inputValue();
  await shot(recipient, '3-signed-request');

  // A payer with real testnet balances.
  const payer = await newPage(browser);
  await installTestWallet(payer, { watchAddress: FUNDED_WATCH_ADDRESS });
  await payer.goto(`${BASE}/app`);
  await connect(payer);
  await dismissUsername(payer);
  await payer.getByText(/BTC for fees/).waitFor({ timeout: 30_000 });
  await shot(payer, '2-dashboard');

  await payer.getByRole('navigation', { name: 'Main Navigation' }).getByRole('button', { name: /^swap$/i }).click();
  await payer.getByLabel(/you pay/i).fill('100');
  await payer.getByText(/Router\.getAmountsOut · block \d+/).waitFor({ timeout: 30_000 });
  await shot(payer, '5-swap');

  // Same payer opens the signed link and reaches the live preflight review.
  await payer.goto(link);
  await payer.getByText(/signed by the recipient’s wallet/i).waitFor();
  await connect(payer);
  await dismissUsername(payer);
  await payer.getByRole('button', { name: /review payment of 250\.00 musd/i }).click();
  await payer.getByRole('button', { name: /review transfer/i }).click();
  await payer.getByText(/BTC \(estimate\)/).waitFor({ timeout: 30_000 });
  await shot(payer, '4-pay-review');

  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
