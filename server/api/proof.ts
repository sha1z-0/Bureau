import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { DATA_DIR } from '../config.ts';
import { AppError } from '../errors.ts';

/**
 * Proof screenshots from external agents are untrusted bytes. They are
 * decoded, size-limited, identified by magic bytes, and then rebuilt:
 *  - PNG: every chunk CRC is checked, the image data is inflated to exactly
 *    the size the header promises, and a fresh PNG is written with only
 *    IHDR / PLTE / tRNS / IDAT / IEND (text, EXIF, ICC and trailing bytes go).
 *  - JPEG: the marker structure is walked; APPn (except Adobe APP14) and COM
 *    segments and anything after EOI are dropped.
 * The result is stored as `<uuid>.png|jpg` in DATA_DIR/shots. Nothing the
 * agent sent (file name, path) is used.
 */

export const SHOT_DIR = path.join(DATA_DIR, 'shots');
export const MAX_PROOF_BYTES = 4 * 1024 * 1024;
const MAX_PIXELS = 40_000_000;

function bad(msg: string): never {
  throw new AppError(400, 'BAD_SCREENSHOT', msg);
}

export function decodeProof(input: string): Buffer {
  let s = input.trim();
  const dataUrl = /^data:image\/(png|jpe?g);base64,/i.exec(s);
  if (dataUrl) s = s.slice(dataUrl[0].length);
  s = s.replace(/\s+/g, '');
  if (!s.length || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(s)) bad('proofScreenshot must be base64 (PNG or JPEG).');
  if (Math.floor((s.length * 3) / 4) > MAX_PROOF_BYTES + 3) bad('proofScreenshot is larger than 4 MB.');
  const buf = Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  if (buf.length > MAX_PROOF_BYTES) bad('proofScreenshot is larger than 4 MB.');
  if (buf.length < 60) bad('proofScreenshot is too small to be an image.');
  return buf;
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function sniff(buf: Buffer): 'png' | 'jpeg' | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIG)) return 'png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  return null;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
}

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const DEPTHS: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };

function rawSize(w: number, h: number, bitsPerPixel: number, interlace: number): number {
  const row = (width: number) => 1 + Math.ceil((width * bitsPerPixel) / 8);
  if (!interlace) return h * row(w);
  // Adam7 passes: [x0, y0, dx, dy].
  const passes = [
    [0, 0, 8, 8],
    [4, 0, 8, 8],
    [0, 4, 4, 8],
    [2, 0, 4, 4],
    [0, 2, 2, 4],
    [1, 0, 2, 2],
    [0, 1, 1, 2],
  ];
  let total = 0;
  for (const [x0, y0, dx, dy] of passes) {
    const pw = Math.ceil((w - x0) / dx);
    const ph = Math.ceil((h - y0) / dy);
    if (pw > 0 && ph > 0) total += ph * row(pw);
  }
  return total;
}

export function sanitizePng(buf: Buffer): Buffer {
  let off = 8;
  let ihdr: Buffer | null = null;
  let plte: Buffer | null = null;
  let trns: Buffer | null = null;
  const idat: Buffer[] = [];
  let ended = false;
  while (off + 12 <= buf.length) {
    const len = buf.readUInt32BE(off);
    if (len > buf.length - off - 12) bad('PNG chunk runs past the end of the file.');
    const type = buf.toString('latin1', off + 4, off + 8);
    if (!/^[A-Za-z]{4}$/.test(type)) bad('PNG chunk type is invalid.');
    const data = buf.subarray(off + 8, off + 8 + len);
    const crc = buf.readUInt32BE(off + 8 + len);
    if ((zlib.crc32(buf.subarray(off + 4, off + 8 + len)) >>> 0) !== crc) bad('PNG chunk checksum is wrong.');
    off += 12 + len;
    if (!ihdr && type !== 'IHDR') bad('PNG must start with IHDR.');
    if (type === 'IHDR') {
      if (ihdr || len !== 13) bad('PNG header is invalid.');
      ihdr = Buffer.from(data);
    } else if (type === 'PLTE') plte = Buffer.from(data);
    else if (type === 'tRNS') trns = Buffer.from(data);
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') {
      ended = true;
      break;
    } else if (!(type.charCodeAt(0) & 0x20)) bad(`PNG has an unknown critical chunk (${type}).`);
  }
  if (!ihdr || !ended || !idat.length) bad('PNG is incomplete.');
  const h = ihdr!;
  const w = h.readUInt32BE(0);
  const ht = h.readUInt32BE(4);
  const depth = h[8];
  const color = h[9];
  if (!w || !ht || w > 20_000 || ht > 20_000 || w * ht > MAX_PIXELS) bad('PNG dimensions are out of range.');
  if (!(color in CHANNELS) || !DEPTHS[color].includes(depth) || h[10] !== 0 || h[11] !== 0 || h[12] > 1) bad('PNG header is invalid.');
  if (color === 3 && (!plte || plte.length % 3 || plte.length > 768)) bad('PNG palette is missing or invalid.');
  const expected = rawSize(w, ht, CHANNELS[color] * depth, h[12]);
  let raw: Buffer;
  try {
    raw = zlib.inflateSync(Buffer.concat(idat), { maxOutputLength: expected + 1 });
  } catch {
    return bad('PNG image data is corrupt.');
  }
  if (raw.length !== expected) bad('PNG image data does not match its header.');
  if (!h[12]) {
    const stride = 1 + Math.ceil((w * CHANNELS[color] * depth) / 8);
    for (let y = 0; y < ht; y++) if (raw[y * stride] > 4) bad('PNG row filter is invalid.');
  }
  const parts = [PNG_SIG, chunk('IHDR', h)];
  if (plte && (color === 3 || color === 2 || color === 6)) parts.push(chunk('PLTE', plte));
  if (trns && trns.length <= 256) parts.push(chunk('tRNS', trns));
  parts.push(chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}

export function sanitizeJpeg(buf: Buffer): Buffer {
  const out: Buffer[] = [Buffer.from([0xff, 0xd8])];
  let off = 2;
  let sawFrame = false;
  let sawScan = false;
  while (off < buf.length) {
    if (buf[off] !== 0xff) bad('JPEG structure is invalid.');
    while (off < buf.length && buf[off] === 0xff) off++; // fill bytes
    if (off >= buf.length) bad('JPEG is truncated.');
    const marker = buf[off++];
    if (marker === 0xd9) {
      if (!sawFrame || !sawScan) bad('JPEG has no image data.');
      out.push(Buffer.from([0xff, 0xd9]));
      return Buffer.concat(out);
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) bad('JPEG has a stray marker.');
    if (off + 2 > buf.length) bad('JPEG is truncated.');
    const len = buf.readUInt16BE(off);
    if (len < 2 || off + len > buf.length) bad('JPEG segment runs past the end of the file.');
    const seg = buf.subarray(off - 2, off + len);
    off += len;
    const isApp = marker >= 0xe0 && marker <= 0xef;
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (len < 8) bad('JPEG frame header is invalid.');
      const fh = seg.readUInt16BE(5);
      const fw = seg.readUInt16BE(7);
      if (!fh || !fw || fw * fh > MAX_PIXELS) bad('JPEG dimensions are out of range.');
      sawFrame = true;
    }
    if ((isApp && marker !== 0xee) || marker === 0xfe) continue; // metadata: EXIF, XMP, ICC, comments
    out.push(seg);
    if (marker === 0xda) {
      if (!sawFrame) bad('JPEG scan before frame header.');
      sawScan = true;
      // Entropy-coded data runs to the next marker that is not a stuffed 0x00 or a restart marker.
      const start = off;
      while (off < buf.length) {
        if (buf[off] === 0xff && off + 1 < buf.length) {
          const n = buf[off + 1];
          if (n === 0x00 || (n >= 0xd0 && n <= 0xd7)) {
            off += 2;
            continue;
          }
          if (n === 0xff) {
            off++;
            continue;
          }
          break;
        }
        off++;
      }
      out.push(buf.subarray(start, off));
    }
  }
  return bad('JPEG has no end marker.');
}

/** Decode, check and store a proof screenshot. Returns the stored file name (inside SHOT_DIR). */
export function storeProof(input: string): { name: string; file: string; type: 'png' | 'jpeg'; bytes: number } {
  const buf = decodeProof(input);
  const type = sniff(buf);
  if (!type) return bad('proofScreenshot must be a PNG or JPEG image.');
  const clean = type === 'png' ? sanitizePng(buf) : sanitizeJpeg(buf);
  fs.mkdirSync(SHOT_DIR, { recursive: true, mode: 0o700 });
  const name = `${crypto.randomUUID()}.${type === 'png' ? 'png' : 'jpg'}`;
  const file = path.join(SHOT_DIR, name);
  fs.writeFileSync(file, clean, { mode: 0o600, flag: 'wx' });
  return { name, file, type, bytes: clean.length };
}
