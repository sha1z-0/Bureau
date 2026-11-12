// Renders design/render/hero.html to design/shots/hero.png with the Chrome or Edge you already have.
// Usage: node design/render/render.mjs
import { chromium } from 'playwright-core';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, '../shots/hero.png');

const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch({ channel: 'msedge' }));
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1.5 });
await page.goto(pathToFileURL(path.join(here, 'hero.html')).href);
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(300);
await page.screenshot({ path: out });
await browser.close();
console.log('wrote', out);
