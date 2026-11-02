import { z } from 'zod/v4';
import type { EvidenceMap } from '../contracts/writer.ts';
import { renderCvPdfWithPages } from '../services/cvPdf.ts';
import type { WriterAi } from './ai.ts';
import { jobBlock, type WriterContext } from './context.ts';
import { LEARNING_GROUP_NAME, TailoredCvSchema, type TailoredCv } from './cvSchema.ts';
import { evidenceForPrompt, writerSystem } from './evidence.ts';
import { CV_FIX_SYSTEM, CV_SYSTEM } from './prompts.ts';
import { aliasesOf, factBacks, LEARNING_GROUP, type CodeIssue } from './truth.ts';

/**
 * Step 4: the tailored CV. Claude chooses, orders and phrases; code then
 * pins everything that must be verbatim (name, contact, employers, titles,
 * dates, education), drops any skill no fact backs, moves learning-list skills
 * into "Currently learning", and trims to one page for candidates under ~6
 * years of experience (measured on the rendered PDF).
 */

export const CvOutSchema = z.object({
  cv: TailoredCvSchema,
  emphasis: z.array(z.string()),
  keywordsUsed: z.array(z.string()),
});
export type CvOut = z.infer<typeof CvOutSchema>;

export async function writeCv(ctx: WriterContext, evidence: EvidenceMap, ai: WriterAi, instructions = ''): Promise<CvOut> {
  const content = `${jobBlock(ctx)}

${evidenceForPrompt(evidence)}
${instructions ? `\nThe candidate's own instructions:\n${instructions}\n` : ''}
Write the tailored CV for this job.`;
  return ai.ask({ task: 'write_cv', label: 'cv', system: writerSystem(ctx, CV_SYSTEM), content, schema: CvOutSchema, maxTokens: 12000 });
}

export async function fixCv(ctx: WriterContext, cv: TailoredCv, issues: CodeIssue[], ai: WriterAi): Promise<TailoredCv> {
  const content = `${jobBlock(ctx)}

<tailored_cv>
${JSON.stringify(cv, null, 1)}
</tailored_cv>

Flagged claims:
${issues.map((i) => `- ${i.claim}: ${i.reason}`).join('\n')}

Return the corrected CV.`;
  const out = await ai.ask({ task: 'write_cv', label: 'cv_fix', system: writerSystem(ctx, CV_FIX_SYSTEM), content, schema: CvOutSchema, maxTokens: 12000 });
  return out.cv;
}

const normName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const sameOrg = (a: string, b: string) => {
  const x = normName(a);
  const y = normName(b);
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
};

/** Pin the verbatim parts to the source and drop what the facts don't back. Returns the CV and what changed. */
export function sanitizeCv(raw: TailoredCv, ctx: WriterContext, evidence: EvidenceMap | null): { cv: TailoredCv; changes: string[] } {
  const m = ctx.master;
  const changes: string[] = [];
  const factText = m.facts.map((f) => f.text).join('\n');
  const onList = (s: string) => ctx.learning.find((l) => aliasesOf(l.skill).some((a) => aliasesOf(s).includes(a)));

  const links: TailoredCv['contact']['links'] = [];
  const addLink = (label: string, url: string) => {
    if (url && !links.some((l) => l.url === url)) links.push({ label, url });
  };
  addLink('GitHub', m.links.github);
  addLink('Portfolio', m.links.portfolio);
  addLink('LinkedIn', m.links.linkedin);
  const known = new Set(m.links.socials.map((s) => s.url));
  for (const l of raw.contact.links) if (known.has(l.url)) addLink(l.label, l.url);

  // Employment: every source role, in source order (reverse-chronological), with verbatim fields.
  const experience = m.experience.map((src) => {
    const gen = raw.experience.find((e) => sameOrg(e.company, src.company) && (normName(e.role) === normName(src.role) || raw.experience.filter((x) => sameOrg(x.company, src.company)).length === 1));
    if (gen && (gen.role !== src.role || gen.start !== src.start || gen.end !== src.end || gen.company !== src.company)) changes.push(`Pinned ${src.role} at ${src.company} to the source title and dates`);
    const bullets = gen?.bullets.filter((b) => b.trim()) ?? src.bullets;
    return { role: src.role, company: src.company, location: src.location, start: src.start, end: src.end, bullets: bullets.length ? bullets : src.bullets };
  });
  for (const e of raw.experience) if (!m.experience.some((s) => sameOrg(s.company, e.company))) changes.push(`Dropped an employer not in the source: ${e.company}`);

  // Skills: only what facts back; learning-list skills move to "Currently learning".
  const learningItems = new Set<string>();
  const skills: TailoredCv['skills'] = [];
  for (const g of raw.skills) {
    if (LEARNING_GROUP.test(g.group.trim())) {
      for (const it of g.items) {
        const l = onList(it);
        if (l) learningItems.add(l.skill);
        else changes.push(`Dropped "${it}" from Currently learning: not on the learning list`);
      }
      continue;
    }
    const items: string[] = [];
    for (const it of g.items) {
      if (factBacks(it, factText)) items.push(it);
      else if (onList(it)) {
        learningItems.add(onList(it)!.skill);
        changes.push(`Moved gap skill "${it}" to Currently learning`);
      } else changes.push(`Dropped skill "${it}": no profile fact backs it`);
    }
    if (items.length) skills.push({ group: g.group, items: [...new Set(items)] });
  }
  for (const it of evidence?.items ?? []) {
    if (it.framing !== 'learning') continue;
    const l = ctx.learning.find((x) => it.factIds.includes(x.id));
    if (l) learningItems.add(l.skill);
  }
  if (learningItems.size) skills.push({ group: LEARNING_GROUP_NAME, items: [...learningItems] });

  // Projects: only the candidate's own, links from the source.
  const projects = raw.projects.flatMap((p) => {
    const src = m.projects.find((s) => sameOrg(s.name, p.name));
    if (!src && !m.facts.some((f) => (f.kind === 'project' || f.kind === 'link') && normName(f.text).includes(normName(p.name)))) {
      changes.push(`Dropped a project not in the profile: ${p.name}`);
      return [];
    }
    return [{ name: src?.name ?? p.name, link: src?.link ?? p.link, description: p.description, highlights: p.highlights }];
  });

  const certSource = [...m.certifications, ...m.facts.filter((f) => f.kind === 'certification').map((f) => f.text)];
  const certifications = raw.certifications.filter((c) => {
    const ok = certSource.some((s) => normName(s).includes(normName(c)) || normName(c).includes(normName(s)));
    if (!ok) changes.push(`Dropped a certification not in the profile: ${c}`);
    return ok;
  });

  const cv: TailoredCv = {
    name: m.name,
    headline: raw.headline,
    contact: { email: m.email, phone: m.phone, location: m.location, links },
    summary: raw.summary,
    skills,
    experience,
    projects,
    education: m.education.map((e) => ({ ...e })),
    certifications,
  };
  return { cv, changes };
}

/** Under ~6 years of experience the CV is one page: trim the least relevant lines until the PDF measures one page. */
export async function fitToPage(cv: TailoredCv, yearsExperience: number, paper: 'A4' | 'LETTER'): Promise<{ cv: TailoredCv; pages: number; trimmed: string[] }> {
  const trimmed: string[] = [];
  let cur: TailoredCv = structuredClone(cv);
  let pages = (await renderCvPdfWithPages(cur, paper)).pages;
  const maxPages = yearsExperience < 6 ? 1 : 2;
  const steps: ((c: TailoredCv) => string | null)[] = [
    (c) => (c.projects.length > 3 ? (c.projects.pop(), 'Kept the 3 most relevant projects') : null),
    (c) => {
      const e = c.experience.find((x) => x.bullets.length > 4);
      return e ? (e.bullets = e.bullets.slice(0, 4), `Trimmed ${e.company} to 4 bullets`) : null;
    },
    (c) => {
      const p = [...c.projects].reverse().find((x) => x.highlights.length > 2);
      return p ? (p.highlights = p.highlights.slice(0, 2), `Trimmed ${p.name} to 2 highlights`) : null;
    },
    (c) => {
      const e = [...c.experience].reverse().find((x) => x.bullets.length > 3);
      return e ? (e.bullets = e.bullets.slice(0, 3), `Trimmed ${e.company} to 3 bullets`) : null;
    },
    (c) => (c.projects.length > 2 ? (c.projects.pop(), 'Kept the 2 most relevant projects') : null),
    (c) => {
      const p = [...c.projects].reverse().find((x) => x.highlights.length > 1);
      return p ? (p.highlights = p.highlights.slice(0, 1), `Trimmed ${p.name} to 1 highlight`) : null;
    },
    (c) => {
      const e = [...c.experience].reverse().find((x) => x.bullets.length > 2);
      return e ? (e.bullets = e.bullets.slice(0, 2), `Trimmed ${e.company} to 2 bullets`) : null;
    },
    (c) => (c.projects.length > 1 ? (c.projects.pop(), 'Kept the most relevant project') : null),
  ];
  for (let guard = 0; pages > maxPages && guard < 40; guard++) {
    let changed: string | null = null;
    for (const step of steps) {
      changed = step(cur);
      if (changed) break;
    }
    if (!changed) break;
    trimmed.push(changed);
    pages = (await renderCvPdfWithPages(cur, paper)).pages;
  }
  if (!trimmed.length) cur = cv;
  return { cv: cur, pages, trimmed };
}
