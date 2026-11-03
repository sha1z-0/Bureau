import PDFDocument from 'pdfkit';
import { LEARNING_GROUP_NAME, type TailoredCv } from '../writer/cvSchema.ts';
import { drawText } from '../writer/pdfText.ts';

/**
 * ATS-first PDFs (A04). One column, real selectable text in the standard PDF
 * fonts (Helvetica; text Helvetica cannot encode, such as a non-Latin name, is
 * drawn in embedded Noto Sans, see server/writer/pdfText.ts), plain section
 * headings in reading order, no tables, text boxes, images or letter-spaced headings (character spacing makes some
 * parsers read "S U M M A R Y"). A single crimson rule is the only ornament.
 * The selfcheck round-trips the output through PDF-to-text extraction.
 */

export interface RenderedPdf {
  buffer: Buffer;
  pages: number;
}

const INK = '#1F1A17';
const MUTED = '#4A4038';
const ACCENT = '#8E1B1B';
const LEARNING = new RegExp(`^(${LEARNING_GROUP_NAME}|learning now|learning|in progress)$`, 'i');

function collect(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
}

export async function renderCvPdfWithPages(cv: TailoredCv, paper: 'A4' | 'LETTER' = 'A4'): Promise<RenderedPdf> {
  const margin = { top: 44, bottom: 44, left: 54, right: 54 };
  const doc = new PDFDocument({
    size: paper,
    margins: margin,
    bufferPages: true,
    info: { Title: `${cv.name} - CV`, Author: cv.name, Subject: cv.headline || 'Curriculum vitae' },
  });
  const done = collect(doc);
  const width = doc.page.width - margin.left - margin.right;

  drawText(doc, cv.name, { weight: 'bold', size: 19, color: INK }, { width });
  if (cv.headline) drawText(doc, cv.headline, { weight: 'regular', size: 11, color: MUTED }, { width });
  const contact = [cv.contact.email, cv.contact.phone, cv.contact.location].filter(Boolean).join(' | ');
  if (contact) {
    doc.moveDown(0.25);
    drawText(doc, contact, { weight: 'regular', size: 9, color: MUTED }, { width });
  }
  if (cv.contact.links.length) {
    drawText(doc, cv.contact.links.map((l) => l.url).join(' | '), { weight: 'regular', size: 9, color: MUTED }, { width });
  }
  doc.moveDown(0.45);
  doc.moveTo(margin.left, doc.y).lineTo(margin.left + width, doc.y).lineWidth(1.1).strokeColor(ACCENT).stroke();

  const heading = (label: string) => {
    doc.moveDown(0.7);
    drawText(doc, label.toUpperCase(), { weight: 'bold', size: 10.5, color: ACCENT }, { width });
    doc.moveDown(0.2);
  };
  const body = (text: string, opts: PDFKit.Mixins.TextOptions) => drawText(doc, text, { weight: 'regular', size: 9.6, color: INK }, opts);
  const bullets = (items: string[]) => {
    for (const b of items) body(`•  ${b}`, { width, paragraphGap: 1.5, lineGap: 0.8 });
  };

  if (cv.summary) {
    heading('Summary');
    body(cv.summary, { width, lineGap: 1.2 });
  }

  const regular = cv.skills.filter((s) => !LEARNING.test(s.group.trim()) && s.items.length);
  const learning = cv.skills.filter((s) => LEARNING.test(s.group.trim())).flatMap((s) => s.items);
  if (regular.length) {
    heading('Skills');
    for (const s of regular) {
      drawText(doc, `${s.group}: `, { weight: 'bold', size: 9.6, color: INK }, { width, continued: true });
      body(s.items.join(', '), { width });
    }
  }
  if (learning.length) {
    heading(LEARNING_GROUP_NAME);
    body(learning.join(', '), { width });
  }

  if (cv.experience.length) {
    heading('Experience');
    for (const e of cv.experience) {
      drawText(doc, e.role, { weight: 'bold', size: 10.3, color: INK }, { width });
      drawText(doc, [e.company, e.location, `${e.start} – ${e.end}`].filter(Boolean).join(' | '), { weight: 'regular', size: 9.2, color: MUTED }, { width });
      doc.moveDown(0.15);
      bullets(e.bullets);
      doc.moveDown(0.35);
    }
  }

  if (cv.projects.length) {
    heading('Projects');
    for (const p of cv.projects) {
      drawText(doc, p.name, { weight: 'bold', size: 10, color: INK }, { width });
      if (p.link) drawText(doc, p.link, { weight: 'regular', size: 9, color: MUTED }, { width });
      if (p.description) body(p.description, { width, lineGap: 0.8 });
      bullets(p.highlights);
      doc.moveDown(0.3);
    }
  }

  if (cv.education.length) {
    heading('Education');
    for (const ed of cv.education) {
      drawText(doc, [ed.degree, ed.school].filter(Boolean).join(', '), { weight: 'bold', size: 10, color: INK }, { width });
      const dates = [ed.start, ed.end].filter(Boolean).join(' – ');
      if (dates) drawText(doc, dates, { weight: 'regular', size: 9, color: MUTED }, { width });
      if (ed.details) body(ed.details, { width });
      doc.moveDown(0.25);
    }
  }

  if (cv.certifications.length) {
    heading('Certifications');
    bullets(cv.certifications);
  }

  const pages = doc.bufferedPageRange().count;
  doc.end();
  return { buffer: await done, pages };
}

export async function renderCvPdf(cv: TailoredCv, paper: 'A4' | 'LETTER' = 'A4'): Promise<Buffer> {
  return (await renderCvPdfWithPages(cv, paper)).buffer;
}

export function cvFilename(name: string) {
  const safe = name.replace(/[^\p{L}\p{N} ]/gu, '').trim().replace(/\s+/g, '-') || 'CV';
  return `${safe}-CV.pdf`;
}

export function letterFilename(name: string) {
  const safe = name.replace(/[^\p{L}\p{N} ]/gu, '').trim().replace(/\s+/g, '-') || 'Cover';
  return `${safe}-Cover-Letter.pdf`;
}

/** Some forms want the cover letter as a file rather than text. */
export async function renderLetterPdf(name: string, letter: string, contact = ''): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margins: { top: 64, bottom: 64, left: 70, right: 70 }, info: { Title: `${name} - Cover letter`, Author: name } });
  const done = collect(doc);
  const width = doc.page.width - 140;
  drawText(doc, name, { weight: 'bold', size: 16, color: INK }, { width });
  if (contact) drawText(doc, contact, { weight: 'regular', size: 9, color: MUTED }, { width });
  doc.moveDown(0.3).moveTo(70, doc.y).lineTo(doc.page.width - 70, doc.y).lineWidth(1).strokeColor(ACCENT).stroke();
  doc.moveDown(1.2);
  drawText(doc, letter, { weight: 'regular', size: 10.5, color: INK }, { width, lineGap: 3, paragraphGap: 8 });
  doc.end();
  return done;
}
