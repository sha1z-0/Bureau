import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../config.ts';

/**
 * Text for the CV and letter PDFs, in any script the bundled fonts cover.
 *
 * Text that fits the standard PDF encoding (WinAnsi: ASCII, Latin-1, curly
 * quotes, dashes, bullet, euro) is drawn in Helvetica exactly as before, so
 * every Latin CV keeps its metrics, its page count and the one-page fit. Any
 * other string is drawn in Noto Sans, embedded and subset by pdfkit: Latin
 * Extended, Greek, Cyrillic and Vietnamese from Noto Sans, Arabic script
 * (Arabic, Urdu, Persian letters) from Noto Sans Arabic, switching font per
 * run inside the line.
 *
 * Arabic script: letters take their joined forms (initial, medial, final) from
 * the font's own shaping tables, and each word's letters run right to left.
 * The words of a right-to-left run are put in right-to-left order when the run
 * fits on one line (a name, a heading, a short phrase inside Latin text). A
 * right-to-left run too long for one line is wrapped as left-to-right text:
 * each word is correct but the words run left to right (there is no full bidi
 * algorithm), and digits inside an Arabic run are not re-ordered. Scripts with
 * no bundled font (CJK, Devanagari, Hebrew, emoji) show a missing-glyph box.
 *
 * Fonts: @fontsource/noto-sans and @fontsource/noto-sans-arabic 5.3.0 (Google
 * Fonts subsets, SIL Open Font License 1.1, licences in assets/fonts), as WOFF:
 * fontkit's subsetter breaks composite glyphs read from WOFF2. When the font
 * files are missing the text falls back to Helvetica, as before.
 */

export const FONT_DIR = path.join(ROOT, 'assets', 'fonts');

export type Weight = 'regular' | 'bold';

interface Face {
  id: string;
  file: string;
  ranges: [number, number][];
  rtl?: boolean;
}

/** Unicode ranges from each Fontsource subset's unicode.json. Order is preference. */
const FACES: Face[] = [
  {
    id: 'latin',
    file: 'noto-sans-latin',
    ranges: [[0x0, 0xff], [0x131, 0x131], [0x152, 0x153], [0x2bb, 0x2bc], [0x2c6, 0x2c6], [0x2da, 0x2da], [0x2dc, 0x2dc], [0x304, 0x304], [0x308, 0x308], [0x329, 0x329], [0x2000, 0x206f], [0x20ac, 0x20ac], [0x2122, 0x2122], [0x2191, 0x2191], [0x2193, 0x2193], [0x2212, 0x2212], [0x2215, 0x2215], [0xfeff, 0xfeff], [0xfffd, 0xfffd]],
  },
  {
    id: 'latin-ext',
    file: 'noto-sans-latin-ext',
    ranges: [[0x100, 0x2ba], [0x2bd, 0x2c5], [0x2c7, 0x2cc], [0x2ce, 0x2d7], [0x2dd, 0x2ff], [0x1d00, 0x1dbf], [0x1e00, 0x1e9f], [0x1ef2, 0x1eff], [0x2020, 0x2020], [0x20a0, 0x20ab], [0x20ad, 0x20c0], [0x2113, 0x2113], [0x2c60, 0x2c7f], [0xa720, 0xa7ff]],
  },
  {
    id: 'vietnamese',
    file: 'noto-sans-vietnamese',
    ranges: [[0x102, 0x103], [0x110, 0x111], [0x128, 0x129], [0x168, 0x169], [0x1a0, 0x1a1], [0x1af, 0x1b0], [0x300, 0x301], [0x303, 0x304], [0x308, 0x309], [0x323, 0x323], [0x329, 0x329], [0x1ea0, 0x1ef9], [0x20ab, 0x20ab]],
  },
  { id: 'greek', file: 'noto-sans-greek', ranges: [[0x370, 0x377], [0x37a, 0x37f], [0x384, 0x38a], [0x38c, 0x38c], [0x38e, 0x3a1], [0x3a3, 0x3ff]] },
  { id: 'cyrillic', file: 'noto-sans-cyrillic', ranges: [[0x301, 0x301], [0x400, 0x45f], [0x490, 0x491], [0x4b0, 0x4b1], [0x2116, 0x2116]] },
  {
    id: 'arabic',
    file: 'noto-sans-arabic-arabic',
    rtl: true,
    ranges: [[0x600, 0x6ff], [0x750, 0x77f], [0x870, 0x88e], [0x890, 0x891], [0x897, 0x8e1], [0x8e3, 0x8ff], [0x200c, 0x200e], [0x2010, 0x2011], [0x204f, 0x204f], [0x2e41, 0x2e41], [0xfb50, 0xfdff], [0xfe70, 0xfe74], [0xfe76, 0xfefc]],
  },
];

/** Code points the standard fonts' WinAnsi encoding maps beyond Latin-1 (pdfkit's WIN_ANSI_MAP). */
const WIN_ANSI_EXTRA = new Set([402, 8211, 8212, 8216, 8217, 8218, 8220, 8221, 8222, 8224, 8225, 8226, 8230, 8364, 8240, 8249, 8250, 710, 8482, 338, 339, 732, 352, 353, 376, 381, 382]);

/** True when Helvetica can draw every character (the path every Latin CV takes, unchanged). */
export function winAnsiSafe(text: string): boolean {
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (c === 9 || c === 10 || c === 13) continue;
    if ((c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || WIN_ANSI_EXTRA.has(c)) continue;
    return false;
  }
  return true;
}

function covers(face: Face, c: number): boolean {
  return face.ranges.some(([a, b]) => c >= a && c <= b);
}

const isSpace = (ch: string) => /\s/.test(ch);

/** Is the bundled font set on disk? Checked once. */
let present: boolean | null = null;
export function unicodeFontsAvailable(): boolean {
  if (present === null) present = FACES.every((f) => fs.existsSync(fontFile(f, 'regular')) && fs.existsSync(fontFile(f, 'bold')));
  return present;
}

function fontFile(face: Face, weight: Weight): string {
  return path.join(FONT_DIR, `${face.file}-${weight === 'bold' ? 700 : 400}-normal.woff`);
}

export interface Run {
  face: string;
  text: string;
  rtl: boolean;
}

/**
 * Split text into runs, one per bundled face. Spaces and other characters
 * every face shares stay with the run they sit in, so an Arabic phrase keeps
 * its inner spaces and splits from the Latin text around it only at its edges.
 */
export function splitRuns(text: string): Run[] {
  const runs: Run[] = [];
  const faceOf = (ch: string): Face => {
    const c = ch.codePointAt(0)!;
    return FACES.find((f) => covers(f, c)) ?? FACES[0];
  };
  const chars = [...text];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const last = runs[runs.length - 1];
    if (last && isSpace(ch)) {
      last.text += ch;
      continue;
    }
    const face = faceOf(ch);
    // Latin punctuation (brackets, commas, digits) between two runs of one script joins that script's run when the face has it.
    if (last && last.face === face.id) last.text += ch;
    else if (last && covers(FACES.find((f) => f.id === last.face)!, ch.codePointAt(0)!)) last.text += ch;
    else runs.push({ face: face.id, text: ch, rtl: !!face.rtl });
  }
  return runs;
}

/** Reverse the word order of a right-to-left run, keeping its outer whitespace where it was. */
export function visualOrder(text: string): string {
  const lead = /^\s*/.exec(text)![0];
  const trail = /\s*$/.exec(text)![0];
  const core = text.slice(lead.length, text.length - trail.length);
  if (!core) return text;
  return lead + core.split(/(\s+)/).reverse().join('') + trail;
}

type Doc = PDFKit.PDFDocument;
type TextOptions = PDFKit.Mixins.TextOptions;

const registered = new WeakSet<Doc>();

function fontName(face: string, weight: Weight) {
  return `noto-${face}-${weight}`;
}

function register(doc: Doc) {
  if (registered.has(doc)) return;
  for (const f of FACES) for (const w of ['regular', 'bold'] as const) doc.registerFont(fontName(f.id, w), fontFile(f, w));
  registered.add(doc);
}

/**
 * Draw text the way `doc.font(Helvetica…).fontSize(size).fillColor(color).text(text, opts)`
 * does, falling back to the bundled Unicode fonts for characters Helvetica cannot draw.
 */
export function drawText(doc: Doc, text: string, style: { weight: Weight; size: number; color: string }, opts: TextOptions): Doc {
  const helvetica = style.weight === 'bold' ? 'Helvetica-Bold' : 'Helvetica';
  if (winAnsiSafe(text) || !unicodeFontsAvailable()) return doc.font(helvetica).fontSize(style.size).fillColor(style.color).text(text, opts);
  register(doc);
  const runs = splitRuns(text);
  const width = typeof opts.width === 'number' ? opts.width : Infinity;
  doc.fontSize(style.size).fillColor(style.color);
  runs.forEach((r, i) => {
    doc.font(fontName(r.face, style.weight));
    // A right-to-left run reads right to left only when it fits on one line; a wrapping paragraph keeps reading order.
    const shown = r.rtl && doc.widthOfString(r.text.trim()) <= width ? visualOrder(r.text) : r.text;
    doc.text(shown, { ...opts, continued: i < runs.length - 1 ? true : !!opts.continued });
  });
  return doc;
}
