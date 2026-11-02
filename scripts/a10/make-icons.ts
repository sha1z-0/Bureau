/**
 * Renders the PWA icons from Bureau's insignia with the installed Chrome or
 * Edge (no image libraries). Run after changing the mark:
 *   npx tsx scripts/a10/make-icons.ts
 * Writes web/public/icons/*.png.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from '../../server/services/browser.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, '../../web/public/icons');

/** The insignia on parchment. `pad` is the share of the edge kept clear (maskable icons need ~10% each side). */
function svg(pad: number, round: boolean): string {
  const s = 64;
  const inner = s * (1 - pad * 2);
  const k = inner / 48;
  const o = s * pad + (inner - 48 * k) / 2;
  const t = (x: number, y: number) => `${(o + (x - 8) * k).toFixed(2)} ${(o + (y - 8) * k).toFixed(2)}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" ${round ? 'rx="14"' : ''} fill="#F2EADB"/>
  <path d="M${t(32, 8)} L${t(52, 49)} L${t(41.5, 49)} L${t(32, 29.5)} L${t(22.5, 49)} L${t(12, 49)} Z" fill="#8E1B1B"/>
  <path d="M${t(32, 8)} L${t(52, 49)} L${t(48, 49)} L${t(32, 16)} Z" fill="#6F1414"/>
  <path d="M${t(32, 36)} L${t(36.5, 49)} L${t(27.5, 49)} Z" fill="#A8842F"/>
  <rect x="${(o + 4 * k).toFixed(2)}" y="${(o + 45 * k).toFixed(2)}" width="${(40 * k).toFixed(2)}" height="${(5 * k).toFixed(2)}" rx="${(2.5 * k).toFixed(2)}" fill="#211A15"/>
  <rect x="${(o + 21 * k).toFixed(2)}" y="${(o + 45 * k).toFixed(2)}" width="${(6 * k).toFixed(2)}" height="${(5 * k).toFixed(2)}" fill="#A8842F"/>
</svg>`;
}

const TARGETS: { file: string; size: number; pad: number; round: boolean }[] = [
  { file: 'icon-192.png', size: 192, pad: 0.08, round: true },
  { file: 'icon-512.png', size: 512, pad: 0.08, round: true },
  { file: 'maskable-512.png', size: 512, pad: 0.16, round: false },
  { file: 'apple-touch-icon.png', size: 180, pad: 0.1, round: false },
];

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'icon.svg'), svg(0.08, true));
const browser = await launchBrowser(true);
try {
  const page = await browser.newPage();
  for (const t of TARGETS) {
    await page.setViewportSize({ width: t.size, height: t.size });
    await page.setContent(`<html><body style="margin:0;background:transparent">${svg(t.pad, t.round).replace('<svg ', `<svg width="${t.size}" height="${t.size}" `)}</body></html>`);
    await page.screenshot({ path: path.join(OUT, t.file), omitBackground: true, clip: { x: 0, y: 0, width: t.size, height: t.size } });
    console.log(`wrote ${t.file}`);
  }
} finally {
  await browser.close();
}
