/**
 * Records the Cambio demo video against a locally running production build.
 *
 *   npm run build
 *   PORT=4173 NODE_ENV=production IDENTITY_STORE=memory ALLOW_NON_DURABLE_IDENTITY=true node server.js &
 *   npx tsx demo/record-demo.ts        # writes demo/out/scene-*.webm + demo/out/scenes.json
 *   bash demo/assemble.sh              # writes demo/cambio-demo.mp4
 *
 * Every app scene is the real UI reading live Mezo Testnet state through the e2e test wallet
 * (tests/e2e/testWallet.ts). That wallet declines eth_sendTransaction, so nothing is broadcast.
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { existsSync } from 'node:fs';
import type { Browser, Locator, Page } from '@playwright/test';
import { generatePrivateKey } from 'viem/accounts';
import { MEZO_TESTNET } from '../src/config/chains';
import { installTestWallet } from '../tests/e2e/testWallet';

const BASE = process.env.DEMO_BASE_URL || 'http://localhost:4173';
const W = 1600;
const H = 900;
const OUT = path.resolve('demo/out');
const CARDS = readFileSync(path.resolve('demo/cards.html'), 'utf8');
const FUNDED_WATCH_ADDRESS = MEZO_TESTNET.pools[0].address;
const executablePath = existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;

/** Fake cursor, click ripple and lower-third captions, drawn into the page so they appear in the recording. */
function overlayScript() {
  const install = () => {
    if (document.getElementById('__demo_cursor')) return;
    const style = document.createElement('style');
    style.textContent = `
      #__demo_cursor{position:fixed;left:0;top:0;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;
        background:rgba(255,255,255,.95);border:2px solid #111;box-shadow:0 4px 18px rgba(0,0,0,.45);z-index:2147483647;
        pointer-events:none;transition:transform .12s ease;}
      #__demo_cursor.down{transform:scale(.7)}
      .__demo_ripple{position:fixed;width:16px;height:16px;margin:-8px 0 0 -8px;border-radius:50%;border:3px solid #F7931A;
        z-index:2147483646;pointer-events:none;animation:__rip .6s ease-out forwards}
      @keyframes __rip{to{transform:scale(4.5);opacity:0}}
      #__demo_cap{position:fixed;left:50%;bottom:40px;transform:translate(-50%,30px);opacity:0;z-index:2147483645;pointer-events:none;
        padding:18px 30px;border-radius:20px;background:rgba(12,12,13,.86);backdrop-filter:blur(14px);border:1px solid rgba(255,255,255,.12);
        box-shadow:0 20px 60px rgba(0,0,0,.45);color:#F5F5F7;font-family:Inter,system-ui,sans-serif;text-align:center;
        transition:opacity .45s ease,transform .45s cubic-bezier(.2,.8,.2,1);max-width:1200px}
      #__demo_cap.on{opacity:1;transform:translate(-50%,0)}
      #__demo_cap b{display:block;font-size:26px;font-weight:700;letter-spacing:-.02em}
      #__demo_cap span{display:block;font-size:17px;color:#A8A8AE;margin-top:6px}
      #__demo_cap i{font-style:normal;color:#F7931A;font-weight:700;font-size:13px;letter-spacing:.18em;text-transform:uppercase;display:block;margin-bottom:6px}`;
    document.documentElement.appendChild(style);
    const cur = document.createElement('div');
    cur.id = '__demo_cursor';
    cur.style.transform = 'translate(-100px,-100px)';
    document.documentElement.appendChild(cur);
    const cap = document.createElement('div');
    cap.id = '__demo_cap';
    document.documentElement.appendChild(cap);
    let x = (window as any).__demoX ?? -100;
    let y = (window as any).__demoY ?? -100;
    const place = () => { cur.style.left = `${x}px`; cur.style.top = `${y}px`; cur.style.transform = ''; };
    place();
    window.addEventListener('mousemove', (e) => { x = e.clientX; y = e.clientY; (window as any).__demoX = x; (window as any).__demoY = y; place(); }, true);
    window.addEventListener('mousedown', (e) => {
      cur.classList.add('down');
      const r = document.createElement('div');
      r.className = '__demo_ripple'; r.style.left = `${e.clientX}px`; r.style.top = `${e.clientY}px`;
      document.documentElement.appendChild(r); setTimeout(() => r.remove(), 700);
    }, true);
    window.addEventListener('mouseup', () => cur.classList.remove('down'), true);
    (window as any).__demoCaption = (step: string, title: string, sub: string) => {
      if (!title) { cap.classList.remove('on'); return; }
      cap.innerHTML = `${step ? `<i>${step}</i>` : ''}<b>${title}</b>${sub ? `<span>${sub}</span>` : ''}`;
      cap.classList.add('on');
    };
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install); else install();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pointer = new WeakMap<Page, { x: number; y: number }>();

async function moveTo(page: Page, target: Locator) {
  await target.scrollIntoViewIfNeeded();
  const box = (await target.boundingBox())!;
  const to = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const from = pointer.get(page) ?? { x: W * 0.62, y: H * 0.72 };
  const steps = 28;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; // easeInOutCubic
    await page.mouse.move(from.x + (to.x - from.x) * e, from.y + (to.y - from.y) * e);
    await sleep(12);
  }
  pointer.set(page, to);
}

async function click(page: Page, target: Locator, pause = 350) {
  await target.waitFor({ state: 'visible', timeout: 30_000 });
  await moveTo(page, target);
  await sleep(180);
  await target.click({ delay: 90 });
  await sleep(pause);
}

async function type(page: Page, target: Locator, text: string) {
  await click(page, target, 150);
  await page.keyboard.type(text, { delay: 85 });
}

async function caption(page: Page, step: string, title: string, sub = '') {
  await page.evaluate(([s, t, u]) => (window as any).__demoCaption?.(s, t, u), [step, title, sub]);
}

async function connect(page: Page) {
  await click(page, page.getByRole('button', { name: /connect wallet/i }).first(), 900);
  await click(page, page.getByText('Cambio Test Wallet').first(), 600);
}

async function dismissUsername(page: Page) {
  const later = page.getByRole('button', { name: /i’ll do this later/i });
  try { await later.waitFor({ state: 'visible', timeout: 6_000 }); await click(page, later, 400); } catch { /* not shown */ }
}

interface SceneInfo { name: string; file: string; start: number; end: number }
const scenes: SceneInfo[] = [];

/** Records one scene in its own context. `start`/`end` mark the useful span (seconds into the raw video). */
async function scene(browser: Browser, name: string, run: (page: Page, mark: () => void) => Promise<void>) {
  const ctx = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: 1,
    colorScheme: 'dark',
    recordVideo: { dir: OUT, size: { width: W, height: H } },
  });
  // tsx (esbuild keepNames) wraps named functions in __name(); define it so serialized init scripts run in the page.
  await ctx.addInitScript({ content: 'window.__name = (f) => f;' });
  await ctx.addInitScript(() => { try { localStorage.setItem('cambio_theme', 'dark'); } catch { /* optional */ } });
  await ctx.addInitScript(overlayScript);
  await ctx.route('**/__card*', (route) => route.fulfill({ contentType: 'text/html', body: CARDS }));
  const page = await ctx.newPage();
  const t0 = Date.now();
  let start = 0;
  try {
    await run(page, () => { start = (Date.now() - t0) / 1000; });
  } catch (e) {
    await page.screenshot({ path: path.join(OUT, `failed-${name}.png`) }).catch(() => {});
    throw e;
  }
  const end = (Date.now() - t0) / 1000;
  const video = page.video()!;
  await ctx.close();
  const file = path.join(OUT, `scene-${String(scenes.length).padStart(2, '0')}-${name}.webm`);
  await video.saveAs(file);
  await video.delete();
  scenes.push({ name, file, start, end });
  console.log(`recorded ${name}: ${start.toFixed(1)}s → ${end.toFixed(1)}s`);
}

async function card(browser: Browser, name: string, holdMs: number) {
  await scene(browser, `card-${name}`, async (page, mark) => {
    await page.goto(`${BASE}/__card?card=${name}`);
    await page.evaluate(() => document.fonts.ready);
    // The page re-runs its entrance animation on reload, so marking after load keeps it whole.
    await page.reload();
    await page.evaluate(() => document.fonts.ready);
    mark();
    await sleep(holdMs);
  });
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  // DEMO_PLAYWRIGHT lets you use a Playwright install whose bundled ffmpeg matches the local browsers.
  const pw = await import(process.env.DEMO_PLAYWRIGHT || '@playwright/test');
  const chromium = pw.chromium ?? pw.default.chromium;
  const browser: Browser = await chromium.launch({ executablePath });
  const recipientKey = generatePrivateKey();
  const username = `maya${Date.now().toString(36).slice(-3)}`;
  let paymentLink = '';

  const skipCards = process.env.DEMO_SKIP_CARDS === '1';
  if (!skipCards) {
    await card(browser, 'intro', 4200);
    await card(browser, 'problem', 4600);
    await card(browser, 'solution', 3200);
  }

  // 1. Landing → dashboard, connect a wallet and claim a verified username.
  await scene(browser, 'landing', async (page, mark) => {
    await page.goto(`${BASE}/`);
    await page.getByText('Money moves simpler.').waitFor();
    await page.evaluate(() => document.fonts.ready);
    await sleep(600);
    mark();
    await sleep(1600);
    await click(page, page.getByRole('button', { name: /explore cambio dashboard/i }), 900);
  });

  await scene(browser, 'username', async (page, mark) => {
    await installTestWallet(page, { privateKey: recipientKey });
    await page.goto(`${BASE}/app`);
    await page.getByText(/MUSD balance/i).first().waitFor();
    await sleep(800);
    mark();
    await caption(page, 'Step 1 · Identity', 'Connect a wallet, claim a @username', 'No more pasting 42-character addresses');
    await connect(page);
    const input = page.getByRole('textbox', { name: 'Username' });
    await input.waitFor({ timeout: 30_000 });
    await sleep(500);
    await type(page, input, username);
    await page.getByText('Available').waitFor();
    await sleep(500);
    await caption(page, 'Step 1 · Identity', 'Signed by the wallet, verified by the server', 'EIP-4361 challenge · single-use nonce · atomic registry write');
    await click(page, page.getByRole('button', { name: /sign & claim username/i }), 200);
    await page.getByText(`@${username} is now verified for this wallet.`).waitFor();
    await sleep(2600);
  });

  // 2. The recipient signs a payment request.
  await scene(browser, 'request', async (page, mark) => {
    await installTestWallet(page, { privateKey: recipientKey });
    await page.goto(`${BASE}/app/request`);
    await connect(page);
    await dismissUsername(page);
    await page.getByRole('heading', { name: 'Request MUSD' }).first().waitFor();
    await sleep(800);
    mark();
    await caption(page, 'Step 2 · Request', 'Create a payment request', 'Amount, note and expiry');
    await type(page, page.getByLabel(/amount/i).first(), '250');
    await sleep(300);
    await type(page, page.locator('#request-note'), 'Invoice #042 — brand identity');
    await sleep(500);
    await caption(page, 'Step 2 · Request', 'EIP-712 signed by the recipient’s wallet', 'Recipient, amount, token, network, id and expiry are bound to the signature');
    await click(page, page.getByRole('button', { name: /sign & create request/i }), 300);
    await page.getByText('Signed request', { exact: true }).waitFor();
    paymentLink = await page.getByLabel('Payment link').inputValue();
    await moveTo(page, page.getByLabel('Payment link'));
    await caption(page, 'Step 2 · Request', 'Share the link or QR code', 'Tamper-proof: any edit breaks the signature');
    await sleep(3400);
  });

  // 3. A payer opens the link: verification, then the live on-chain preflight up to the wallet prompt.
  await scene(browser, 'pay', async (page, mark) => {
    await installTestWallet(page, { watchAddress: FUNDED_WATCH_ADDRESS });
    await page.goto(paymentLink);
    await page.getByText(/signed by the recipient’s wallet/i).waitFor();
    await sleep(700);
    mark();
    await caption(page, 'Step 3 · Pay', 'The payer’s browser verifies the signature first', 'Only then is a Pay button offered');
    await sleep(2800);
    await connect(page);
    await dismissUsername(page);
    await click(page, page.getByRole('button', { name: /review payment of 250\.00 musd/i }), 900);
    await caption(page, 'Step 3 · Pay', 'Full transparency before signing', 'Network, MUSD contract, full recipient address');
    await click(page, page.getByRole('button', { name: /review transfer/i }), 300);
    await page.getByText(/BTC \(estimate\)/).waitFor({ timeout: 30_000 });
    await caption(page, 'Step 3 · Pay', 'Live preflight against Mezo Testnet', 'Real balances and fee estimate for the exact calldata, including the request id');
    await moveTo(page, page.getByRole('button', { name: /confirm in wallet/i }));
    await sleep(3800);
  });

  // 4. A tampered link is refused.
  await scene(browser, 'tamper', async (page, mark) => {
    const u = new URL(paymentLink);
    const params = new URLSearchParams(u.hash.slice(u.hash.indexOf('?') + 1));
    const payload = JSON.parse(Buffer.from(params.get('r')!, 'base64url').toString('utf8'));
    payload.amount = (BigInt(payload.amount) * 10n).toString();
    params.set('r', Buffer.from(JSON.stringify(payload)).toString('base64url'));
    await page.goto(`${BASE}/#pay?${params.toString()}`);
    await page.getByText(/signature check failed — do not pay/i).waitFor();
    await sleep(600);
    mark();
    await caption(page, 'Security', 'Someone edits the amount 250 → 2,500', 'Signature check fails. No payment UI is offered.');
    await sleep(4200);
  });

  // 5. Real balances and a live swap quote.
  await scene(browser, 'swap', async (page, mark) => {
    await installTestWallet(page, { watchAddress: FUNDED_WATCH_ADDRESS });
    await page.goto(`${BASE}/app`);
    await connect(page);
    await dismissUsername(page);
    await page.getByText(/BTC for fees/).waitFor({ timeout: 30_000 });
    await sleep(1200);
    mark();
    await caption(page, 'Dashboard', 'Real BTC and MUSD balances', 'Read straight from Mezo, never a fake zero');
    await sleep(2800);
    await click(page, page.getByRole('navigation', { name: 'Main Navigation' }).getByRole('button', { name: /^swap$/i }), 1500);
    await caption(page, 'Swap', 'MUSD ⇄ BTC via Mezo’s official Router', 'Live getAmountsOut quote · pool fee from PoolFactory');
    await type(page, page.getByLabel(/you pay/i), '100');
    await page.getByText(/Router\.getAmountsOut · block \d+/).waitFor({ timeout: 30_000 });
    await sleep(3600);
  });

  if (!skipCards) await card(browser, 'outro', 5200);

  await browser.close();
  writeFileSync(path.join(OUT, 'scenes.json'), JSON.stringify(scenes, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
