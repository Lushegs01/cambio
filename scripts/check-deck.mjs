// Checks submission/deck/CAMBIO_FINAL_PITCH_DECK.html for content that overflows a 1280×720 slide, and
// optionally writes a PNG per slide: node scripts/check-deck.mjs [outDir]. Exit 1 if any slide overflows.
import { chromium } from '@playwright/test';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const out = process.argv[2];
const executablePath = process.env.PW_CHROMIUM_PATH || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(pathToFileURL(path.resolve('submission/deck/CAMBIO_FINAL_PITCH_DECK.html')).href, { waitUntil: 'networkidle' });
const slides = await page.$$('section.slide');
let bad = 0;
for (const [i, el] of slides.entries()) {
  const overflow = await el.evaluate((n) => {
    const s = n.getBoundingClientRect();
    return [...n.querySelectorAll('*')].filter((c) => !c.closest('.foot')).some((c) => c.getBoundingClientRect().bottom > s.bottom - 40);
  });
  if (overflow) bad++;
  console.log(`slide ${i + 1}: ${overflow ? 'OVERFLOWS into the footer area' : 'ok'}`);
  if (out) await el.screenshot({ path: path.join(out, `slide-${i + 1}.png`) });
}
await browser.close();
process.exit(bad ? 1 : 0);
