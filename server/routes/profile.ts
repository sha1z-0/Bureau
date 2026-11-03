import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import mammoth from 'mammoth';
import { z } from 'zod/v4';
import { digestPortfolio, extractProfile } from '../ai/profile.ts';
import { UPLOAD_DIR } from '../config.ts';
import { all, logEvent, now, run } from '../db.ts';
import { AppError } from '../errors.ts';
import { loadProfile, ProfileSchema, saveProfile } from '../services/profileStore.ts';
import { rescoreFromProfile } from '../services/scanner.ts';
import { refilterAfterProfileChange } from '../campaign/refilter.ts';
import { AI_LIMIT, body } from './util.ts';

const MAX_UPLOAD = 10 * 1024 * 1024;
const MAX_UNZIPPED = 40 * 1024 * 1024;

/** Sum the declared uncompressed sizes in a ZIP's central directory before any parser inflates it (zip-bomb guard). */
function zipExpandedSize(buf: Buffer): number {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0 || eocd + 22 > buf.length) return Infinity;
  const entries = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  let total = 0;
  for (let i = 0; i < entries; i++) {
    if (offset + 46 > buf.length || buf.readUInt32LE(offset) !== 0x02014b50) return Infinity;
    total += buf.readUInt32LE(offset + 24);
    offset += 46 + buf.readUInt16LE(offset + 28) + buf.readUInt16LE(offset + 30) + buf.readUInt16LE(offset + 32);
  }
  return total;
}

/** Identify by magic bytes, never by the filename or the browser's claimed type. */
function sniff(buf: Buffer, filename: string): 'pdf' | 'docx' | 'text' | null {
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (buf[0] === 0x50 && buf[1] === 0x4b && /\.docx$/i.test(filename)) return 'docx';
  if (/\.(txt|md|markdown)$/i.test(filename) && !buf.subarray(0, 4096).includes(0)) return 'text';
  return null;
}

export async function profileRoutes(app: FastifyInstance) {
  app.get('/api/profile', async () => {
    const documents = all('SELECT id, kind, filename, mime, size, created_at FROM documents ORDER BY created_at DESC');
    return { profile: loadProfile(), documents };
  });

  app.put('/api/profile', async (req) => {
    const profile = body(ProfileSchema, req.body);
    saveProfile(profile);
    rescoreFromProfile();
    refilterAfterProfileChange();
    return { profile };
  });

  app.post('/api/profile/upload', AI_LIMIT, async (req) => {
    const file = await req.file({ limits: { fileSize: MAX_UPLOAD, files: 1, fields: 4 } });
    if (!file) throw new AppError(400, 'NO_FILE', 'Choose a CV file to upload.');
    const buf = await file.toBuffer();
    if (file.file.truncated) throw new AppError(413, 'TOO_LARGE', 'CV files must be under 10 MB.');
    const kind = sniff(buf, file.filename);
    if (!kind) throw new AppError(415, 'UNSUPPORTED', 'Upload a PDF, DOCX, TXT or Markdown CV.');
    if (kind === 'docx' && zipExpandedSize(buf) > MAX_UNZIPPED) throw new AppError(413, 'TOO_LARGE', 'That DOCX expands to an unreasonable size.');
    const notesField = file.fields.notes as { value?: string } | undefined;
    const notes = typeof notesField?.value === 'string' ? notesField.value.slice(0, 4000) : '';

    const id = crypto.randomUUID();
    const storedAs = `${id}.${kind === 'text' ? 'txt' : kind}`;
    fs.writeFileSync(path.join(UPLOAD_DIR, storedAs), buf, { mode: 0o600 });
    run(
      'INSERT INTO documents (id, kind, filename, mime, stored_as, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      id,
      'cv',
      path.basename(file.filename).slice(0, 200),
      kind,
      storedAs,
      buf.length,
      now(),
    );

    let profile;
    if (kind === 'pdf') profile = await extractProfile({ pdf: buf, notes });
    else if (kind === 'docx') profile = await extractProfile({ text: (await mammoth.extractRawText({ buffer: buf })).value, notes });
    else profile = await extractProfile({ text: buf.toString('utf8'), notes });

    rescoreFromProfile();
    refilterAfterProfileChange();
    logEvent('profile', `Profile built from ${file.filename}`);
    return { profile };
  });

  app.post('/api/profile/portfolio', AI_LIMIT, async (req) => {
    const { urls } = body(z.object({ urls: z.array(z.string().url().max(2000)).min(1).max(6) }), req.body);
    const profile = await digestPortfolio(urls);
    logEvent('profile', `Portfolio read: ${urls.length} page(s)`);
    return { profile };
  });
}
