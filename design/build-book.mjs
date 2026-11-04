// Builds design/design-book.html from design/design-book.src.html and the shipped stylesheet,
// so every specimen is drawn by the real tokens and classes. Run: node design/build-book.mjs
// The result is one file: styles, fonts and swatch values are all inside it.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const tokens = read('web/src/styles/tokens.css');
const app = read('web/src/styles/app.css').replace(/@import[^;]+;\s*/g, '');
let src = read('design/design-book.src.html');

/* ── Fonts: the faces in web/src/assets/fonts, and the code face the app imports ── */
const b64 = (p) => fs.readFileSync(path.join(root, p)).toString('base64');
const face = (family, weight, file) => `@font-face{font-family:'${family}';font-weight:${weight};font-style:normal;font-display:swap;src:url(data:font/woff2;base64,${b64(file)}) format('woff2')}`;
const fonts = [
  face('Newsreader', '300 700', 'web/src/assets/fonts/newsreader-latin.woff2'),
  face('Hanken Grotesk', '300 800', 'web/src/assets/fonts/hanken-grotesk-latin.woff2'),
  face('IBM Plex Mono', '400', 'node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2'),
].join('\n');

/* ── Night in Rome as a scope, so a day and a night specimen can sit side by side ── */
const css = (tokens + '\n' + app).replace(/\/\*[\s\S]*?\*\//g, '');
const night = [...css.matchAll(/([^{}]*\[data-theme='dark'\][^{}]*)\{([^{}]*)\}/g)]
  .map(([, sel, body]) => {
    const list = sel.trim().split(',').map((s) => s.trim().replace(/:root\[data-theme='dark'\]/g, '.bk-night'));
    return `${list.join(',')}{${body}}`;
  })
  .join('\n');

/* ── The phone's top and tab bars live in a media query; lift them for the phone specimen ── */
const phoneRules = [...app.matchAll(/@media \(max-width: 820px\) \{([\s\S]*?)\n\}/g)]
  .flatMap((m) => [...m[1].matchAll(/^ {2}(\.t(?:abbar|opbar)[^{]*)\{([^}]*)\}/gm)])
  .map(([, sel, body]) => `${sel.split(',').map((s) => `.bk-phone ${s.trim()}`).join(',')}{${body}}`)
  .join('\n');

/* ── Swatches and contrast, read from the tokens ── */
const block = (re) => (tokens.match(re) ?? [, ''])[1];
const parse = (text) => Object.fromEntries([...text.matchAll(/--([\w-]+):\s*([^;]+);/g)].map(([, k, v]) => [k, v.trim()]));
const day = parse(block(/:root,[\s\S]*?\{([\s\S]*?)\n\}/));
const dark = { ...day, ...parse(block(/:root\[data-theme='dark'\],[\s\S]*?\{([\s\S]*?)\n\}/)) };
const hex = (map, name) => {
  let v = map[name];
  for (let i = 0; i < 6 && v?.startsWith('var('); i++) v = map[v.slice(6, -1)];
  return v?.startsWith('#') ? v.toUpperCase() : null;
};
const lum = (h) => {
  const [r, g, b] = h.slice(1).match(/../g).map((x) => parseInt(x, 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return ((x + 0.05) / (y + 0.05)).toFixed(1);
};

const PALETTE = [
  ['Parchment', 'bg', 'Page ground'],
  ['Linen', 'surface', 'Sheets, lists, panels'],
  ['Field', 'field', 'Inside inputs'],
  ['Vellum', 'well', 'Wells, tracks, tab groups'],
  ['Lane', 'lane', 'Pipeline lanes'],
  ['Hover', 'hover', 'Rows under the pointer'],
  ['Selected', 'selected', 'Chosen rows and steps'],
  ['Leather rail', 'rail', 'Sidebar and phone top bar'],
  ['Ink', 'text', 'Text and icons'],
  ['Ink 2', 'text-2', 'Secondary text'],
  ['Ink 3', 'text-3', 'Quiet text, still AA'],
  ['Sash', 'accent', 'Links, the current selection'],
  ['Sash fill', 'accent-fill', 'Primary buttons, counts, switches'],
  ['Brass', 'focus', 'Focus rings only'],
  ['Warning', 'warn', 'Needs attention'],
  ['Olive', 'good', 'Success, verified'],
  ['Leather', 'leather', 'Data marks'],
  ['Sash band', 'sash-band', 'The campaign band'],
];
const swatch = ([name, key, role]) => {
  const [a, b] = [hex(day, key), hex(dark, key)];
  return `<div class="bk-sw"><div class="bk-chip"><i style="background:${a}"></i><i style="background:${b}"></i></div><b>${name}</b><code>--${key}</code><span class="num">${a} · ${b}</span><small>${role}</small></div>`;
};

const PAIRS = [
  ['Ink on parchment', 'text', 'bg', 4.5],
  ['Ink 2 on linen', 'text-2', 'surface', 4.5],
  ['Ink 3 on linen', 'text-3', 'surface', 4.5],
  ['Ink 3 on vellum', 'text-3', 'well', 4.5],
  ['Sash on linen', 'accent', 'surface', 4.5],
  ['Label on sash fill', 'on-accent', 'accent-fill', 4.5],
  ['Warning on its tint', 'warn', 'warn-soft', 4.5],
  ['Olive on its tint', 'good', 'good-soft', 4.5],
  ['Focus ring on parchment', 'focus', 'bg', 3],
];
const contrast = PAIRS.map(([n, f, g, need]) => `<tr><td>${n}</td><td class="num">${ratio(hex(day, f), hex(day, g))}</td><td class="num">${ratio(hex(dark, f), hex(dark, g))}</td><td class="num">${need}</td></tr>`).join('');

const SIZES = [...tokens.matchAll(/--(t-\w+):\s*([\d.]+)rem/g)].slice(0, 7).map(([, k, v]) => [k, v]);
const scale = SIZES.map(([k, v]) => `${v} rem`).join(' · ');

/* ── Each [pair] block is drawn twice: by day and by night ── */
src = src.replace(/<!--pair(?::([\w-]+))?-->([\s\S]*?)<!--\/pair-->/g, (_, cls, body) => {
  const panel = (scope, label) => `<div class="bk-panel ${scope}"><div class="bk-tag">${label}</div>${body}</div>`;
  return `<div class="bk-pair ${cls ?? ''}">${panel('bk-day', 'Day')}${panel('bk-night', 'Night in Rome')}</div>`;
});

const stamp = new Date().toISOString().slice(0, 10);
const out = src
  .replace('/*FONTS*/', () => fonts)
  .replace('/*APP*/', () => tokens.replace(/\/\*[\s\S]*?\*\//g, '') + '\n' + app)
  .replace('/*NIGHT*/', () => night)
  .replace('/*PHONE*/', () => phoneRules)
  .replace('<!--PALETTE-->', () => PALETTE.map(swatch).join('\n'))
  .replace('<!--CONTRAST-->', () => contrast)
  .replaceAll('<!--SCALE-->', () => scale)
  .replaceAll('<!--DATE-->', () => stamp);

fs.writeFileSync(path.join(here, 'design-book.html'), out);
console.log(`design-book.html: ${(out.length / 1024).toFixed(0)} KB, ${PALETTE.length} swatches, ${PAIRS.length} contrast pairs`);
