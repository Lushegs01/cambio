// Captures the live production proof page for the recorded signed-invoice settlement (read-only, no wallet).
// node scripts/capture-proof.mjs <proof URL> <out.png>
import { chromium } from '@playwright/test';
import { existsSync } from 'node:fs';
const [url, out] = process.argv.slice(2);
const executablePath = existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const page = await browser.newPage({ viewport: { width: 393, height: 1500 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.goto(url);
const verdict = page.getByTestId('proof-verdict');
await verdict.waitFor();
await page.waitForFunction(() => document.querySelector('[data-testid="proof-verdict"]')?.getAttribute('data-verdict') !== 'loading', null, { timeout: 90_000 });
const v = await verdict.getAttribute('data-verdict');
console.log('verdict', v, 'checks', await page.locator('[data-testid="proof-checks"] li[data-ok="true"]').count(), '/', await page.locator('[data-testid="proof-checks"] li').count());
await page.screenshot({ path: out, fullPage: true });
await browser.close();
process.exit(v === 'verified' ? 0 : 1);
