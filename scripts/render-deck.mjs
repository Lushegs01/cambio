// Renders submission/deck/CAMBIO_FINAL_PITCH_DECK.html to submission/CAMBIO_FINAL_PITCH_DECK.pdf with Chromium.
import { chromium } from '@playwright/test';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const executablePath = process.env.PW_CHROMIUM_PATH || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const page = await browser.newPage();
await page.goto(pathToFileURL(path.resolve('submission/deck/CAMBIO_FINAL_PITCH_DECK.html')).href, { waitUntil: 'networkidle' });
await page.pdf({ path: 'submission/CAMBIO_FINAL_PITCH_DECK.pdf', width: '1280px', height: '720px', printBackground: true, preferCSSPageSize: true });
await browser.close();
console.log('Wrote submission/CAMBIO_FINAL_PITCH_DECK.pdf');
