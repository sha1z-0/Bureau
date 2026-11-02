/**
 * Test-harness seeding for the e2e run and its worker processes. Import only
 * after BUREAU_DATA_DIR points at a sandbox (scripts/e2e.ts does this).
 *
 * The seed writes the fictional candidate through the v1 profile store and the
 * v2 tables directly: it is setup data, not a substitute for A03's logic, and
 * the `profile` stage then checks A03 reads it back correctly. Pipeline rows
 * only ever move through transition().
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { all, get, now, run } from '../../server/db.ts';
import { saveProfile, ProfileSchema } from '../../server/services/profileStore.ts';
import { ensurePipeline, pipelineState, transition } from '../../server/campaign/pipeline.ts';
import { ATS_FAMILIES, type AtsFamily } from '../../server/contracts/job.ts';
import { CampaignConfigSchema, TRANSITIONS, type CampaignConfig, type PipelineState } from '../../server/contracts/campaign.ts';
import type { ApplicationPacket } from '../../server/contracts/writer.ts';
import { FIXTURES, type FormSpec } from './manifest.ts';

const PROFILE_DIR = path.join(FIXTURES, 'profile');
const readJson = <T>(f: string): T => JSON.parse(fs.readFileSync(path.join(PROFILE_DIR, f), 'utf8')) as T;

export function seedProfile(): { facts: number; voice: number; answers: number; learning: number } {
  const raw = readJson<Record<string, unknown>>('profile.json');
  if (raw.cvMarkdown === '@cv.md') raw.cvMarkdown = fs.readFileSync(path.join(PROFILE_DIR, 'cv.md'), 'utf8');
  saveProfile(ProfileSchema.parse(raw));
  const ts = now();
  const facts = readJson<{ id: string; kind: string; text: string; source: string; sourceRef: string }[]>('facts.json');
  for (const f of facts) {
    run('INSERT OR REPLACE INTO profile_facts (id, kind, text, source, source_ref, added_at, active) VALUES (?, ?, ?, ?, ?, ?, 1)', f.id, f.kind, f.text, f.source, f.sourceRef, ts);
  }
  const voice = readJson<{ id: string; prompt: string; text: string; tags: string[] }[]>('voice-bank.json');
  for (const v of voice) run('INSERT OR REPLACE INTO voice_bank (id, prompt, text, tags, created_at) VALUES (?, ?, ?, ?, ?)', v.id, v.prompt, v.text, JSON.stringify(v.tags), ts);
  const answers = readJson<{ id: string; questionRaw: string; questionNorm: string; answer: string; scope: unknown; source: string }[]>('answer-bank.json');
  for (const a of answers) {
    run(
      'INSERT OR REPLACE INTO answer_bank (id, question_norm, question_raw, answer, scope, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      a.id,
      a.questionNorm,
      a.questionRaw,
      a.answer,
      JSON.stringify(a.scope ?? {}),
      a.source,
      ts,
      ts,
    );
  }
  const learning = readJson<{ id: string; skill: string; status: string; startedAt: string | null; notes: string }[]>('learning.json');
  for (const l of learning) run('INSERT OR REPLACE INTO learning_list (id, skill, status, started_at, notes) VALUES (?, ?, ?, ?, ?)', l.id, l.skill, l.status, l.startedAt, l.notes);
  return { facts: facts.length, voice: voice.length, answers: answers.length, learning: learning.length };
}

export function texts(): Record<string, string> {
  return readJson<Record<string, string>>('texts.json');
}

export function campaignConfig(overrides: Partial<CampaignConfig> = {}): CampaignConfig {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  return CampaignConfigSchema.parse({
    startsAt: start.toISOString(),
    endsAt: new Date(start.getTime() + 30 * 86_400_000).toISOString(),
    roles: ['Junior Backend Engineer', 'Junior Full-Stack Developer', 'Software Engineer I', 'Associate Software Engineer'],
    categories: ['web', 'software'],
    locations: ['Remote', 'Lahore'],
    remoteOnly: false,
    stretchLevel: 'balanced',
    minScore: 55,
    dailyCap: 60,
    companyCooldownDays: 0,
    activeHours: { tz: 'UTC', start: '00:00', end: '23:59' },
    pacingMinutes: { min: 0, max: 0 },
    budgetUsd: 50,
    dryRunDays: 0,
    channels: { email: false, forms: true, agent: true },
    sources: {},
    maxAgeDays: 30,
    followUpDays: 7,
    onUnknownQuestion: 'skip',
    scoutEveryHours: 3,
    ...overrides,
  });
}

export function insertCampaign(name: string, cfg: CampaignConfig): string {
  const id = `e2e-${crypto.randomUUID().slice(0, 8)}`;
  run(
    'INSERT INTO campaigns (id, name, status, starts_at, ends_at, config, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    id,
    name,
    'draft',
    cfg.startsAt,
    cfg.endsAt,
    JSON.stringify(cfg),
    now(),
    now(),
  );
  return id;
}

/** Fictional employer and role per fixture form (matches fixtures/feeds/e2e and fixtures/mail). */
export const FORM_JOBS: Record<string, { company: string; title: string; domain: string }> = {
  'greenhouse-classic': { company: 'Lumen Ledger', title: 'Junior Backend Engineer', domain: 'lumenledger.example.com' },
  'greenhouse-jobboards': { company: 'Harbor & Pine', title: 'Software Engineer I, Platform', domain: 'harborpine.example.com' },
  'greenhouse-embed': { company: 'Orchard Robotics', title: 'Junior Full-Stack Developer', domain: 'orchardrobotics.example.com' },
  lever: { company: 'Northwind Labs', title: 'Backend Engineer (Junior)', domain: 'northwindlabs.example.com' },
  ashby: { company: 'Quillstack', title: 'Associate Software Engineer', domain: 'quillstack.example.com' },
  workable: { company: 'Brightwater Health', title: 'Junior Node.js Developer', domain: 'brightwaterhealth.example.com' },
  'smartrecruiters-oneclick': { company: 'Meridian Freight', title: 'Graduate Software Engineer', domain: 'meridianfreight.example.com' },
  'recruitee-careers': { company: 'Tulip & Tern', title: 'Junior Web Developer', domain: 'tulipandtern.example.com' },
  'personio-job': { company: 'Kranich Software GmbH', title: 'Junior Backend Developer (m/w/d)', domain: 'kranich.example.com' },
  'teamtailor-careersite': { company: 'Saffron Studio', title: 'Full-Stack Developer, Early Career', domain: 'saffronstudio.example.com' },
  'bamboohr-careers': { company: 'Copperline Payments', title: 'Software Engineer I', domain: 'copperline.example.com' },
  'breezy-portal': { company: 'Pebble Analytics', title: 'Junior Software Developer', domain: 'pebbleanalytics.example.com' },
  workday: { company: 'Atlas Mutual', title: 'Associate Software Engineer', domain: 'atlasmutual.example.com' },
};

export function formJob(spec: FormSpec): { company: string; title: string; domain: string } {
  return FORM_JOBS[spec.id] ?? { company: `Widget Works ${spec.id.replace(/^widget-/, '')}`, title: `Junior Software Engineer (${spec.title.slice(0, 60)})`, domain: 'widgets.example.com' };
}

const DESCRIPTION = `We're hiring a junior engineer to build and maintain TypeScript and Node.js services backed by PostgreSQL.
You will write SQL migrations, ship small features end to end, and work with a friendly product team.
Requirements: 1+ years with TypeScript or Python; comfort with SQL. Nice to have: Docker, AWS, React.
Remote within UTC+0 to UTC+6. Salary USD 28,000–36,000.`;

/** Insert one job row (idempotent by fingerprint) and put it in the pipeline at `found`. */
export function insertJob(j: { fingerprint: string; title: string; company: string; url: string; ats: string; description?: string; campaignId: string | null; source?: string }): string {
  const existing = get<{ id: string }>('SELECT id FROM jobs WHERE fingerprint = ?', j.fingerprint);
  if (existing) return existing.id;
  const id = crypto.randomUUID();
  const ats = (ATS_FAMILIES as readonly string[]).includes(j.ats) ? (j.ats as AtsFamily) : 'other';
  const ts = now();
  run(
    `INSERT INTO jobs (id, fingerprint, source, external_id, url, title, company, location, remote, category, description_text, tags, posted_at, found_at,
       prefilter_score, apply_url_canonical, ats, legitimacy, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'Remote', 1, 'web', ?, '[]', ?, ?, 60, ?, ?, 'ok', ?)`,
    id,
    j.fingerprint,
    j.source ?? 'e2e',
    j.fingerprint,
    j.url,
    j.title,
    j.company,
    j.description ?? DESCRIPTION,
    ts,
    ts,
    j.url,
    ats,
    ts,
  );
  ensurePipeline(id, j.campaignId);
  return id;
}

/** Point a job at its local replica: in production apply_url_canonical is the real ATS URL. */
export function pointJobAt(jobId: string, url: string) {
  run('UPDATE jobs SET apply_url_canonical = ?, url = CASE WHEN url = \'\' THEN ? ELSE url END, updated_at = ? WHERE id = ?', url, url, now(), jobId);
}

/** The forward path every job walks; used to advance fallback jobs through legal transitions only. */
const FORWARD: PipelineState[] = ['found', 'filtered', 'scored', 'selected', 'writing', 'written', 'filling', 'verified'];

/**
 * Walk a job to `target` through legal transitions (BFS over TRANSITIONS), so a
 * stage whose upstream module is pending can still run. No-op when already there.
 */
export function advanceTo(jobId: string, target: PipelineState, reason = 'e2e: fallback'): PipelineState {
  const cur = pipelineState(jobId)?.state ?? null;
  if (cur === target) return target;
  if (cur === null) {
    ensurePipeline(jobId);
    return advanceTo(jobId, target, reason);
  }
  const prev = new Map<PipelineState, PipelineState>();
  const queue: PipelineState[] = [cur];
  const seen = new Set<PipelineState>([cur]);
  while (queue.length) {
    const s = queue.shift()!;
    if (s === target) break;
    // Prefer forward moves so paths look like real runs.
    const nexts = [...TRANSITIONS[s]].sort((a, b) => (FORWARD.indexOf(a) === -1 ? 99 : FORWARD.indexOf(a)) - (FORWARD.indexOf(b) === -1 ? 99 : FORWARD.indexOf(b)));
    for (const n of nexts) {
      if (seen.has(n) || n === 'submitted' && target !== 'submitted') continue;
      seen.add(n);
      prev.set(n, s);
      queue.push(n);
    }
  }
  if (!seen.has(target)) throw new Error(`No legal path from ${cur} to ${target} for job ${jobId}`);
  const path: PipelineState[] = [];
  for (let s: PipelineState | undefined = target; s && s !== cur; s = prev.get(s)) path.unshift(s);
  for (const s of path) transition(jobId, s, { reason });
  return target;
}

export function stateOf(jobId: string): PipelineState | null {
  return pipelineState(jobId)?.state ?? null;
}

/** A packet built from the seeded candidate's fixed texts and PDFs (used when the writer stage is pending). */
export function fallbackPacket(jobId: string, campaignId: string, sandbox: string): ApplicationPacket {
  const t = texts();
  const job = get<{ company: string; title: string }>('SELECT company, title FROM jobs WHERE id = ?', jobId)!;
  const applicationId = crypto.randomUUID();
  const dir = path.join(sandbox, 'packets', applicationId);
  fs.mkdirSync(dir, { recursive: true });
  const cvPdfPath = path.join(dir, 'Rania-Haroon-CV.pdf');
  const letterPdfPath = path.join(dir, 'Rania-Haroon-Cover-Letter.pdf');
  fs.copyFileSync(path.join(PROFILE_DIR, 'Rania-Haroon-CV.pdf'), cvPdfPath);
  fs.copyFileSync(path.join(PROFILE_DIR, 'Rania-Haroon-Cover-Letter.pdf'), letterPdfPath);
  const letter = t.coverLetter.replace(/Lumen Ledger/g, job.company);
  const ts = now();
  run(
    `INSERT INTO applications (id, job_id, subject, cover_letter, message, status, channel, created_at, updated_at, campaign_id)
     VALUES (?, ?, ?, ?, ?, 'draft', 'form', ?, ?, ?)`,
    applicationId,
    jobId,
    `${job.title}: ${t.subject.split(': ').slice(1).join(': ')}`,
    letter,
    t.outreach,
    ts,
    ts,
    campaignId,
  );
  const scores = { specificity: 8.5, evidence: 9, voice: 8.5, clarity: 9, ask: 8, aiTells: 9 };
  return {
    applicationId,
    jobId,
    cvPdfPath,
    letterPdfPath,
    subject: `${job.title}: ${t.subject.split(': ').slice(1).join(': ')}`,
    coverLetter: letter,
    shortAnswers: {
      'why us': t.whyUs.replace(/Lumen Ledger/g, job.company),
      'why this role': t.whyUs.replace(/Lumen Ledger/g, job.company),
      'tell us about a project': t.project,
      'additional information': t.project,
    },
    outreach: t.outreach,
    followUp: '',
    quality: { critic: { score: 8.6, scores, demands: [] }, lint: { pass: true, checks: [] }, truth: { pass: true, issues: [] } },
  };
}

export function countRows(table: string, where = '1=1', ...params: (string | number)[]): number {
  return Number(get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`, ...params)?.n ?? 0);
}

export function rows<T>(sql: string, ...params: (string | number | null)[]): T[] {
  return all<T>(sql, ...params);
}
