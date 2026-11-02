import PDFDocument from 'pdfkit';
import type { TailoredCv } from '../ai/tailor.ts';

/**
 * ATS-first PDF: one column, real selectable text in standard fonts, plain
 * section headings, no tables or text boxes. A single crimson rule is the only
 * ornament — recruiters' parsers ignore it, humans notice it.
 */
export function renderCvPdf(cv: TailoredCv, paper: 'A4' | 'LETTER' = 'A4'): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: paper, margins: { top: 46, bottom: 46, left: 54, right: 54 }, info: { Title: `${cv.name} — CV`, Author: cv.name } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const INK = '#1F1A17';
    const MUTED = '#5A4E45';
    const ACCENT = '#8E1B1B';
    const width = doc.page.width - 108;

    doc.font('Helvetica-Bold').fontSize(20).fillColor(INK).text(cv.name);
    if (cv.headline) doc.font('Helvetica').fontSize(11).fillColor(MUTED).text(cv.headline);
    const contact = [cv.contact.email, cv.contact.phone, cv.contact.location, ...cv.contact.links.map((l) => l.url)].filter(Boolean).join('  |  ');
    doc.moveDown(0.3).fontSize(9).fillColor(MUTED).text(contact, { width });
    doc.moveDown(0.5).moveTo(54, doc.y).lineTo(54 + width, doc.y).lineWidth(1.2).strokeColor(ACCENT).stroke();

    const heading = (label: string) => {
      doc.moveDown(0.8).font('Helvetica-Bold').fontSize(10.5).fillColor(ACCENT).text(label.toUpperCase(), { characterSpacing: 1.1 });
      doc.moveDown(0.25);
    };
    const body = () => doc.font('Helvetica').fontSize(9.8).fillColor(INK);
    const bullets = (items: string[]) => {
      for (const b of items) {
        body().text(`•  ${b}`, { width, indent: 0, paragraphGap: 2, lineGap: 1 });
      }
    };

    if (cv.summary) {
      heading('Summary');
      body().text(cv.summary, { width, lineGap: 1.5 });
    }

    if (cv.skills.length) {
      heading('Skills');
      for (const s of cv.skills) {
        doc.font('Helvetica-Bold').fontSize(9.8).fillColor(INK).text(`${s.group}: `, { continued: true });
        body().text(s.items.join(', '), { width });
      }
    }

    if (cv.experience.length) {
      heading('Experience');
      for (const e of cv.experience) {
        doc.font('Helvetica-Bold').fontSize(10.5).fillColor(INK).text(`${e.role} — ${e.company}`, { width });
        doc.font('Helvetica').fontSize(9).fillColor(MUTED).text([`${e.start} – ${e.end}`, e.location].filter(Boolean).join('  ·  '));
        doc.moveDown(0.2);
        bullets(e.bullets);
        doc.moveDown(0.45);
      }
    }

    if (cv.projects.length) {
      heading('Projects');
      for (const p of cv.projects) {
        doc.font('Helvetica-Bold').fontSize(10.2).fillColor(INK).text(p.name, { continued: !!p.link });
        if (p.link) doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(`  ${p.link}`);
        if (p.description) body().text(p.description, { width });
        bullets(p.highlights);
        doc.moveDown(0.35);
      }
    }

    if (cv.education.length) {
      heading('Education');
      for (const ed of cv.education) {
        doc.font('Helvetica-Bold').fontSize(10.2).fillColor(INK).text(`${ed.degree}${ed.school ? ` — ${ed.school}` : ''}`, { width });
        doc.font('Helvetica').fontSize(9).fillColor(MUTED).text([ed.start, ed.end].filter(Boolean).join(' – '));
        if (ed.details) body().text(ed.details, { width });
        doc.moveDown(0.3);
      }
    }

    if (cv.certifications.length) {
      heading('Certifications');
      bullets(cv.certifications);
    }

    doc.end();
  });
}

export function cvFilename(name: string) {
  const safe = name.replace(/[^\p{L}\p{N} ]/gu, '').trim().replace(/\s+/g, '-') || 'CV';
  return `${safe}-CV.pdf`;
}

/** Some forms want the cover letter as a file rather than text. */
export function renderLetterPdf(name: string, letter: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margins: { top: 64, bottom: 64, left: 70, right: 70 }, info: { Title: `${name} — Cover letter`, Author: name } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.font('Helvetica-Bold').fontSize(16).fillColor('#1F1A17').text(name);
    doc.moveDown(0.3).moveTo(70, doc.y).lineTo(doc.page.width - 70, doc.y).lineWidth(1).strokeColor('#8E1B1B').stroke();
    doc.moveDown(1.2).font('Helvetica').fontSize(10.5).fillColor('#1F1A17').text(letter, { lineGap: 3, paragraphGap: 8 });
    doc.end();
  });
}
