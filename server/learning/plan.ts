import crypto from 'node:crypto';
import { z } from 'zod/v4';
import type { SystemBlocks } from '../ai/claude.ts';
import { fence, UNTRUSTED_NOTE } from '../ai/prompts.ts';
import { LearningPlanSchema, type LearningPlan } from '../contracts/learning.ts';
import type { MasterProfile } from '../contracts/profile.ts';
import { all, get, logEvent, now as dbNow, run } from '../db.ts';
import { AppError, redact } from '../errors.ts';
import '../inbox/schema.ts';
import { a09Ai, aiUnavailable } from '../inbox/ai.ts';
import { learningSettings } from './settings.ts';
import { skillDoc, skillsIn } from './skills.ts';

/**
 * Crash learning plans: when a company shows interest, a day-by-day plan to
 * close that job's gaps before the interview, with free resources, a tiny
 * project per skill that proves it, likely questions for their stack, and
 * talking points that map the candidate's REAL experience to the role.
 * Gaps come from the matcher (code), never from the model.
 */

export const LEARNING_PLANNER = `You coach a job candidate who has an interview or assessment coming up. Build a short, realistic crash plan to close the gaps between the candidate and this role before the date.

${UNTRUSTED_NOTE}

Rules:
- Exactly the number of days given. Each day has one focus (usually one gap or the company's stack), 2-5 concrete tasks that fit in about 3 hours, and 1-3 resources.
- Resources must be free and reputable: official documentation, official tutorials, well-known free books or courses. Real, stable URLs you are confident exist (prefer the docs home or tutorial page over deep links). Never paywalled platforms. Mark free: true only when free.
- miniProject: one tiny project (a few hours) whose finished result proves the skill and could honestly become a CV line ("Built X with Y"). null on review days.
- The last day is review and mock interview practice.
- likelyQuestions: 8-12 questions this company is likely to ask for this role and stack, technical and behavioural.
- talkingPoints: 4-8 points, each mapping something the candidate has REALLY done (only from the candidate section) to a need of the role. Never invent experience, metrics, employers or skills. Where they lack a skill, the honest point is what they are doing to learn it.`;

export const PlanOutputSchema = z.object({
  days: z.array(
    z.object({
      day: z.number(),
      focus: z.string(),
      tasks: z.array(z.string()),
      resources: z.array(z.object({ title: z.string(), url: z.string(), free: z.boolean() })),
      miniProject: z.string().nullable(),
    }),
  ),
  likelyQuestions: z.array(z.string()),
  talkingPoints: z.array(z.string()),
});
export type PlanOutput = z.infer<typeof PlanOutputSchema>;

export interface PlanContext {
  applicationId: string;
  jobId: string;
  company: string;
  role: string;
  interviewDate: string | null;
  days: number;
  gaps: { text: string; importance: string; match: string }[];
  stack: string[];
  posting: string;
  candidate: string;
}

const DAY = 86_400_000;
const BLOCKER_KINDS = new Set(['licence', 'clearance', 'citizenship', 'degree', 'years']);
const IMPORTANCE = { critical: 0, important: 1, nice: 2 } as Record<string, number>;

/** Days between the plan's start and the interview (1–14), or the default when the date is unknown. */
export function planDays(startAt: string, interviewDate: string | null, fallback: number): number {
  if (!interviewDate) return fallback;
  const start = Date.parse(`${startAt.slice(0, 10)}T00:00:00Z`);
  const end = Date.parse(`${interviewDate.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return fallback;
  return Math.min(14, Math.max(1, Math.round((end - start) / DAY)));
}

function renderCandidate(p: MasterProfile | null): string {
  if (!p) return '(no profile yet)';
  const lines: string[] = [];
  if (p.name) lines.push(`Name: ${p.name}`);
  if (p.headline) lines.push(`Headline: ${p.headline}`);
  if (p.coreStack.length) lines.push(`Core stack: ${p.coreStack.join(', ')}`);
  if (p.skills.length) lines.push(`Other skills: ${p.skills.slice(0, 30).join(', ')}`);
  const learning = p.learning.filter((l) => l.status === 'learning').map((l) => l.skill);
  if (learning.length) lines.push(`Learning now: ${learning.join(', ')}`);
  for (const e of p.experience.slice(0, 4)) lines.push(`Experience: ${e.role} at ${e.company} (${e.start}–${e.end}): ${e.bullets.slice(0, 3).join(' | ')}`);
  for (const pr of p.projects.slice(0, 5)) lines.push(`Project: ${pr.name}: ${pr.description}${pr.highlights.length ? ` (${pr.highlights.slice(0, 2).join('; ')})` : ''}`);
  const facts = p.facts.filter((f) => f.active).slice(0, 25);
  for (const f of facts) lines.push(`Fact (${f.kind}): ${f.text}`);
  return lines.join('\n');
}

/** Everything the planner needs, from the database. Deterministic for a given state (replay hashes depend on it). */
export async function planContext(applicationId: string, interviewDate: string | null, startAt: string): Promise<PlanContext> {
  const app = get<{ id: string; job_id: string }>('SELECT id, job_id FROM applications WHERE id = ?', applicationId);
  if (!app) throw new AppError(404, 'NOT_FOUND', 'No such application');
  const job = get<{ id: string; title: string; company: string; description_text: string | null; company_id: string | null; match: string | null }>(
    'SELECT id, title, company, description_text, company_id, match FROM jobs WHERE id = ?',
    app.job_id,
  );
  if (!job) throw new AppError(404, 'NOT_FOUND', 'The job for this application is gone');

  let requirements: { text: string; importance: string; match: string; blocker?: boolean; blockerKind?: string }[] = [];
  try {
    const m = JSON.parse(job.match ?? 'null') as { requirements?: typeof requirements } | null;
    requirements = m?.requirements ?? [];
  } catch {
    /* no match */
  }
  const gaps = requirements
    .filter((r) => (r.match === 'missing' || r.match === 'partial') && !(r.blocker && BLOCKER_KINDS.has(r.blockerKind ?? '')) && !BLOCKER_KINDS.has(r.blockerKind ?? ''))
    .sort((a, b) => (IMPORTANCE[a.importance] ?? 3) - (IMPORTANCE[b.importance] ?? 3) || (a.match === 'missing' ? 0 : 1) - (b.match === 'missing' ? 0 : 1))
    .slice(0, 8)
    .map((r) => ({ text: r.text.replace(/\s+/g, ' ').trim().slice(0, 200), importance: r.importance, match: r.match }));

  const { loadMasterProfile } = await import('../profile/index.ts');
  const profile = loadMasterProfile();

  // No matcher output: fall back to stack skills in the posting the candidate doesn't list.
  if (!gaps.length && job.description_text) {
    const have = new Set([...(profile?.coreStack ?? []), ...(profile?.skills ?? [])].map((s) => s.toLowerCase()));
    for (const s of skillsIn(job.description_text)) if (!have.has(s.toLowerCase())) gaps.push({ text: s, importance: 'important', match: 'missing' });
    gaps.splice(8);
  }

  const domain = job.company_id ? (get<{ domain: string | null }>('SELECT domain FROM companies WHERE id = ?', job.company_id)?.domain ?? null) : null;
  let stack: string[] = [];
  try {
    const { cachedBrief } = await import('../research/index.ts');
    const brief = cachedBrief(job.company, domain);
    stack = (brief?.techSignals ?? []).map((t) => t.text.replace(/\s+/g, ' ').trim().slice(0, 200)).slice(0, 8);
  } catch {
    /* research not available */
  }

  return {
    applicationId,
    jobId: job.id,
    company: job.company,
    role: job.title,
    interviewDate,
    days: planDays(startAt, interviewDate, learningSettings().defaultPlanDays),
    gaps,
    stack,
    posting: (job.description_text ?? '').replace(/\s+\n/g, '\n').trim().slice(0, 3_500),
    candidate: renderCandidate(profile),
  };
}

export function plannerSystem(): SystemBlocks {
  return [{ type: 'text', text: LEARNING_PLANNER, cache_control: { type: 'ephemeral' } }];
}

export function plannerContent(ctx: PlanContext): string {
  return [
    `Company: ${ctx.company}`,
    `Role: ${ctx.role}`,
    `Interview or due date: ${ctx.interviewDate ?? 'unknown'}`,
    `Plan length: ${ctx.days} day${ctx.days === 1 ? '' : 's'}`,
    '',
    'Gaps from the job match (most important first):',
    ...(ctx.gaps.length ? ctx.gaps.map((g, i) => `${i + 1}. [${g.importance}, ${g.match}] ${fence(g.text)}`) : ['(none recorded: focus on the stack in the posting)']),
    '',
    'Company stack from public research (third-party):',
    ...(ctx.stack.length ? ctx.stack.map((s) => `- ${fence(s)}`) : ['(no research yet)']),
    '',
    '<job_posting>',
    fence(ctx.posting || '(posting text not saved)'),
    '</job_posting>',
    '',
    '<candidate>',
    ctx.candidate,
    '</candidate>',
  ].join('\n');
}

const SHORTENERS = /^(bit\.ly|tinyurl\.com|t\.co|goo\.gl|ow\.ly|is\.gd|buff\.ly|rebrand\.ly|cutt\.ly)$/i;
const PAYWALLED = /(^|\.)(udemy\.com|pluralsight\.com|oreilly\.com|educative\.io|frontendmasters\.com|egghead\.io|linkedin\.com|skillshare\.com|datacamp\.com|acloudguru\.com|zerotomastery\.io|designcode\.io|manning\.com|packtpub\.com)$/i;

function cleanResource(r: { title: string; url: string; free: boolean }): { title: string; url: string; free: boolean } | null {
  let u: URL;
  try {
    u = new URL(r.url.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.username || u.password) return null;
  const host = u.hostname.toLowerCase();
  if (SHORTENERS.test(host) || PAYWALLED.test(host) || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return null;
  if (!r.free) return null;
  return { title: r.title.replace(/\s+/g, ' ').trim().slice(0, 140) || host, url: u.href, free: true };
}

const line = (s: string, max: number) => s.replace(/\s+/g, ' ').trim().slice(0, max);

/** Turn the model's draft into a contract-valid plan. Gaps, dates and day count come from code. */
export function finishPlan(ctx: PlanContext, out: PlanOutput): LearningPlan {
  const days = [...out.days]
    .sort((a, b) => a.day - b.day)
    .slice(0, ctx.days)
    .map((d, i) => {
      const resources = d.resources.map(cleanResource).filter((r): r is NonNullable<typeof r> => !!r);
      const unique = resources.filter((r, j) => resources.findIndex((x) => x.url === r.url) === j).slice(0, 4);
      if (!unique.length) {
        const doc = skillsIn(d.focus).map(skillDoc).find(Boolean);
        if (doc) unique.push({ title: `${skillsIn(d.focus)[0]} official docs`, url: doc, free: true });
      }
      return {
        day: i + 1,
        focus: line(d.focus, 120),
        tasks: d.tasks.map((t) => line(t, 300)).filter(Boolean).slice(0, 6),
        resources: unique,
        miniProject: d.miniProject ? line(d.miniProject, 400) : null,
      };
    });
  return LearningPlanSchema.parse({
    applicationId: ctx.applicationId,
    company: ctx.company,
    role: ctx.role,
    interviewDate: ctx.interviewDate,
    gaps: ctx.gaps.map((g) => g.text),
    days,
    likelyQuestions: out.likelyQuestions.map((q) => line(q, 300)).filter(Boolean).slice(0, 15),
    talkingPoints: out.talkingPoints.map((t) => line(t, 400)).filter(Boolean).slice(0, 10),
  });
}

/** A plan from code alone, for when the model is unavailable: one gap per day, official docs, a review day. */
export function fallbackPlan(ctx: PlanContext): LearningPlan {
  const focuses = ctx.gaps.length ? ctx.gaps.map((g) => g.text) : skillsIn(ctx.posting).slice(0, 4);
  const study = Math.max(1, ctx.days - 1);
  const days: PlanOutput['days'] = [];
  for (let i = 0; i < study; i++) {
    const focus = focuses[i % Math.max(1, focuses.length)] ?? `${ctx.company}'s stack`;
    const skill = skillsIn(focus)[0] ?? null;
    const doc = skill ? skillDoc(skill) : null;
    days.push({
      day: i + 1,
      focus: skill ?? line(focus, 80),
      tasks: [`Read the official getting-started guide for ${skill ?? 'this topic'} and take notes on the core ideas`, `Work through one hands-on tutorial end to end`, `Write down how it relates to something you have already built`],
      resources: doc ? [{ title: `${skill} official docs`, url: doc, free: true }] : [],
      miniProject: skill ? `A small ${skill} project you can finish in an evening and push to GitHub` : null,
    });
  }
  if (ctx.days > 1)
    days.push({
      day: ctx.days,
      focus: 'Review and mock interview',
      tasks: ['Re-read your notes from each day', `Answer the likely questions out loud, timing yourself`, `Prepare two questions to ask ${ctx.company}`],
      resources: [],
      miniProject: null,
    });
  const skills = focuses.map((f) => skillsIn(f)[0] ?? line(f, 60));
  return finishPlan(ctx, {
    days,
    likelyQuestions: [
      `Why ${ctx.company}, and why this ${ctx.role} role?`,
      'Tell us about a project you are proud of and the hardest problem in it.',
      ...skills.slice(0, 4).map((s) => `How would you get productive with ${s} in your first month?`),
      'Describe a time you learned something new quickly under a deadline.',
    ],
    talkingPoints: [],
  });
}

export interface PlanRow {
  id: string;
  applicationId: string | null;
  company: string;
  createdAt: string;
  plan: LearningPlan;
  via: string;
}

function toRow(r: { id: string; application_id: string | null; company: string; plan: string; created_at: string }): PlanRow | null {
  try {
    const raw = JSON.parse(r.plan) as LearningPlan & { _via?: string };
    const parsed = LearningPlanSchema.safeParse(raw);
    return parsed.success ? { id: r.id, applicationId: r.application_id, company: r.company, createdAt: r.created_at, plan: parsed.data, via: raw._via ?? 'ai' } : null;
  } catch {
    return null;
  }
}

export function getPlan(id: string): PlanRow | null {
  const r = get<{ id: string; application_id: string | null; company: string; plan: string; created_at: string }>('SELECT * FROM learning_plans WHERE id = ?', id);
  return r ? toRow(r) : null;
}

export function listPlans(opts: { applicationId?: string; limit?: number } = {}): PlanRow[] {
  const rows = opts.applicationId
    ? all<{ id: string; application_id: string | null; company: string; plan: string; created_at: string }>('SELECT * FROM learning_plans WHERE application_id = ? ORDER BY created_at DESC LIMIT ?', opts.applicationId, opts.limit ?? 50)
    : all<{ id: string; application_id: string | null; company: string; plan: string; created_at: string }>('SELECT * FROM learning_plans ORDER BY created_at DESC LIMIT ?', opts.limit ?? 50);
  return rows.map(toRow).filter((r): r is PlanRow => !!r);
}

export function deletePlan(id: string) {
  const res = run('DELETE FROM learning_plans WHERE id = ?', id);
  if (!res.changes) throw new AppError(404, 'NOT_FOUND', 'No such plan');
}

/**
 * Build (or reuse) the crash plan for an application. A plan made in the last
 * 14 days for the same date is reused, so an invite, a reminder and a
 * reschedule to the same day cost one call.
 */
export async function buildPlan(applicationId: string, interviewDate: string | null = null, opts: { startAt?: string; force?: boolean } = {}): Promise<{ id: string; plan: LearningPlan }> {
  if (!opts.force) {
    const recent = listPlans({ applicationId, limit: 5 }).find(
      (p) => Date.now() - Date.parse(p.createdAt) < 14 * DAY && (interviewDate === null || (p.plan.interviewDate ?? '').slice(0, 10) === interviewDate.slice(0, 10)),
    );
    if (recent) return { id: recent.id, plan: recent.plan };
  }
  const startAt = opts.startAt ?? new Date().toISOString();
  const ctx = await planContext(applicationId, interviewDate, startAt);
  let plan: LearningPlan;
  let via = 'ai';
  try {
    const out = await a09Ai().structured({ task: 'learning_plan', system: plannerSystem(), content: plannerContent(ctx), schema: PlanOutputSchema, maxTokens: 8000 });
    plan = finishPlan(ctx, out);
    if (!plan.days.length) throw new AppError(502, 'AI_PARSE', 'The plan came back empty');
  } catch (err) {
    if (!aiUnavailable(err)) throw err;
    logEvent('learning', `Learning plan for ${ctx.company} built without the model (${redact((err as Error).message).slice(0, 120)})`, ctx.jobId);
    plan = fallbackPlan(ctx);
    via = 'fallback';
  }
  const id = crypto.randomUUID();
  run('INSERT INTO learning_plans (id, application_id, company, plan, created_at) VALUES (?, ?, ?, ?, ?)', id, applicationId, ctx.company, JSON.stringify({ ...plan, _via: via }), dbNow());
  logEvent('learning', `Learning plan ready for ${ctx.company} (${plan.days.length} days)`, ctx.jobId);
  return { id, plan };
}
