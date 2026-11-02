import crypto from 'node:crypto';
import { z } from 'zod/v4';
import { get, logEvent, now, run } from '../db.ts';
import { AppError } from '../errors.ts';
import {
  EducationSchema,
  ExperienceSchema,
  loadProfile,
  profileForPrompt,
  ProjectSchema,
  type Profile,
} from '../services/profileStore.ts';
import { structured } from './claude.ts';
import { FACT_AUDITOR, fence, TAILOR_RULES } from './prompts.ts';

export const TailoredCvSchema = z.object({
  name: z.string(),
  headline: z.string(),
  contact: z.object({
    email: z.string(),
    phone: z.string(),
    location: z.string(),
    links: z.array(z.object({ label: z.string(), url: z.string() })),
  }),
  summary: z.string(),
  skills: z.array(z.object({ group: z.string(), items: z.array(z.string()) })),
  experience: z.array(ExperienceSchema),
  projects: z.array(ProjectSchema),
  education: z.array(EducationSchema),
  certifications: z.array(z.string()),
});
export type TailoredCv = z.infer<typeof TailoredCvSchema>;

export const DraftSchema = z.object({
  subject: z.string(),
  coverLetter: z.string(),
  outreachMessage: z.string(),
  cv: TailoredCvSchema,
  emphasis: z.array(z.string()),
  keywordsUsed: z.array(z.string()),
});

export const AuditSchema = z.object({
  issues: z.array(z.object({ claim: z.string(), reason: z.string(), severity: z.enum(['high', 'medium', 'low']) })),
});

export interface AuditIssue {
  claim: string;
  reason: string;
  severity: 'high' | 'medium' | 'low';
  origin: 'code' | 'auditor';
}

interface JobRow {
  id: string;
  title: string;
  company: string;
  location: string | null;
  url: string;
  description_text: string | null;
  ai_analysis: string | null;
  apply_email: string | null;
}

/** Deterministic half of the fact lock: every number and employer must exist in the source. */
function codeAudit(cv: TailoredCv, letter: string, profile: Profile): AuditIssue[] {
  const source = [profile.cvMarkdown, profile.portfolioNotes, profile.summary, profile.phone, profile.preferences.signature, profile.yearsExperience]
    .join('\n')
    .replace(/,/g, '')
    .toLowerCase();
  const issues: AuditIssue[] = [];
  const written = [cv.summary, ...cv.experience.flatMap((e) => e.bullets), ...cv.projects.flatMap((p) => [p.description, ...p.highlights]), letter].join('\n');
  const figures = new Set(written.match(/(?:[$€£]\s?)?\d[\d,.]*\s?(?:%|k|m|x|\+)?/gi) ?? []);
  for (const fig of figures) {
    const core = fig.replace(/[$€£\s,]/g, '').replace(/[+x]$/i, '').toLowerCase();
    if (core.length < 2 || /^(19|20)\d\d$/.test(core)) continue;
    if (!source.includes(core.replace(/%$/, ''))) {
      issues.push({ claim: fig.trim(), reason: 'This figure does not appear anywhere in your CV or portfolio notes.', severity: 'high', origin: 'code' });
    }
  }
  const knownCompanies = profile.experience.map((e) => e.company.toLowerCase());
  for (const e of cv.experience) {
    if (!knownCompanies.some((k) => k && (k.includes(e.company.toLowerCase()) || e.company.toLowerCase().includes(k)))) {
      issues.push({ claim: `${e.role} at ${e.company}`, reason: 'This employer is not in your source CV.', severity: 'high', origin: 'code' });
    }
  }
  return issues;
}

export async function draftApplication(jobId: string, instructions = ''): Promise<string> {
  const profile = loadProfile();
  if (!profile) throw new AppError(412, 'NO_PROFILE', 'Upload your CV in Profile before drafting.');
  const job = get<JobRow>(
    'SELECT id, title, company, location, url, description_text, ai_analysis, apply_email FROM jobs WHERE id = ?',
    jobId,
  );
  if (!job) throw new AppError(404, 'NOT_FOUND', 'Job not found');
  const analysis = job.ai_analysis ? JSON.parse(job.ai_analysis) : null;

  const system = [
    { type: 'text' as const, text: TAILOR_RULES },
    { type: 'text' as const, text: profileForPrompt(profile), cache_control: { type: 'ephemeral' as const } },
  ];
  const content = `<job_posting id="${job.id}">
Title: ${fence(job.title)}
Company: ${fence(job.company)}
Location: ${fence(job.location ?? '')}
URL: ${job.url}

${fence(job.description_text ?? '')}
</job_posting>

${analysis ? `Fit analysis already done for this job:\n- Verdict: ${analysis.verdict}\n- Strengths: ${analysis.strengths.join('; ')}\n- Gaps: ${analysis.gaps.join('; ')}\n- Keywords to mirror (only where true): ${analysis.atsKeywords.join(', ')}\n` : ''}
Candidate tone preference: ${profile.preferences.tone}
Candidate signature block:\n${profile.preferences.signature || profile.name}
${instructions ? `\nExtra instructions from the candidate for this draft:\n${instructions}` : ''}

Write the subject, cover letter, outreach message and tailored CV. List what you chose to emphasise (emphasis) and the posting keywords you mirrored (keywordsUsed).`;

  const draft = await structured({ task: 'tailor', system, content, schema: DraftSchema, maxTokens: 32000 });

  const issues: AuditIssue[] = codeAudit(draft.cv, draft.coverLetter, profile);
  try {
    const audit = await structured({
      task: 'audit',
      system: [{ type: 'text', text: FACT_AUDITOR }],
      content: `<source>\n${profile.cvMarkdown}\n\n${profile.portfolioNotes}\n</source>\n\n<tailored>\nCOVER LETTER:\n${draft.coverLetter}\n\nOUTREACH:\n${draft.outreachMessage}\n\nCV:\n${JSON.stringify(draft.cv, null, 1)}\n</tailored>`,
      schema: AuditSchema,
      maxTokens: 8000,
    });
    issues.push(...audit.issues.map((i) => ({ ...i, origin: 'auditor' as const })));
  } catch (err) {
    issues.push({ claim: 'Independent audit did not run', reason: (err as Error).message, severity: 'low', origin: 'code' });
  }

  const channel = analysis?.applyChannel === 'email' && job.apply_email ? 'email' : analysis?.applyChannel === 'dm' ? 'dm' : 'ats';
  const existing = get<{ id: string }>("SELECT id FROM applications WHERE job_id = ? AND status != 'sent'", jobId);
  const id = existing?.id ?? crypto.randomUUID();
  const notes = JSON.stringify({ emphasis: draft.emphasis, issues });
  if (existing) {
    run(
      `UPDATE applications SET subject = ?, cover_letter = ?, message = ?, cv = ?, notes = ?, keywords = ?, status = 'draft',
         channel = ?, to_email = ?, updated_at = ? WHERE id = ?`,
      draft.subject,
      draft.coverLetter,
      draft.outreachMessage,
      JSON.stringify(draft.cv),
      notes,
      JSON.stringify(draft.keywordsUsed),
      channel,
      job.apply_email,
      now(),
      id,
    );
  } else {
    run(
      `INSERT INTO applications (id, job_id, subject, cover_letter, message, cv, notes, keywords, status, channel, to_email, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`,
      id,
      jobId,
      draft.subject,
      draft.coverLetter,
      draft.outreachMessage,
      JSON.stringify(draft.cv),
      notes,
      JSON.stringify(draft.keywordsUsed),
      channel,
      job.apply_email,
      now(),
      now(),
    );
  }
  run("UPDATE jobs SET stage = CASE WHEN stage = 'found' THEN 'drafted' ELSE stage END, status = 'shortlisted', updated_at = ? WHERE id = ?", now(), jobId);
  const high = issues.filter((i) => i.severity === 'high').length;
  logEvent('draft', `Drafted application for ${job.title} at ${job.company}${high ? ` — ${high} fact-lock issue(s) to review` : ''}`, jobId);
  return id;
}
