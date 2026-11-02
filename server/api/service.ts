import crypto from 'node:crypto';
import { z } from 'zod/v4';
import { all, get, logEvent, now, run } from '../db.ts';
import { AppError, redact } from '../errors.ts';
import { emit } from '../services/bus.ts';
import {
  AnswerResponse,
  ClaimResponse,
  HealthResponse,
  JobDetailResponse,
  JobSummarySchema,
  ListJobsResponse,
  PacketResponse,
  RecipeResponse,
  TraceSubmitResponse,
  type AnswerRequest,
  type FailedRequest,
  type SubmittedRequest,
} from '../contracts/api.ts';
import { TraceSchema, type Trace } from '../contracts/agent.ts';
import { TRANSITIONS, type PipelineState } from '../contracts/campaign.ts';
import { AtsFamily } from '../contracts/job.ts';
import { RecipeSchema, type FieldKind, type FormField } from '../contracts/forms.ts';
import { ApplicationPacketSchema, type ApplicationPacket } from '../contracts/writer.ts';
import { activeClaim, claimJob, releaseClaim } from '../campaign/claims.ts';
import { pipelineState, transition } from '../campaign/pipeline.ts';
import { loadPacket, recordStep, savePacket } from '../campaign/journal.ts';
import { apiDeps, isNotImplemented } from './deps.ts';
import { fileUrl, signFileToken } from './files.ts';
import { holderOf, requireScope, type ApiKeyContext } from './keys.ts';
import { takeAi } from './ratelimit.ts';
import { storeProof } from './proof.ts';

/**
 * Everything an external agent can do, shared by REST (/api/v1) and MCP.
 * Every function checks its own scope, validates what it is given and treats
 * it as untrusted. Nothing here returns vault secrets, site passwords, mail
 * credentials, the owner's contact details beyond what the packet carries, or
 * file paths.
 */

export const API_VERSION = '1.0.0';

export interface CallCtx {
  key: ApiKeyContext;
  /** Origin used for signed file URLs. */
  baseUrl: string;
  via: 'rest' | 'mcp-http' | 'mcp-stdio';
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
/** Strip control characters (keeping newlines and tabs) and trim. */
export const cleanText = (s: string) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
const isHttpUrl = (u: string) => {
  try {
    const p = new URL(u);
    return p.protocol === 'http:' || p.protocol === 'https:';
  } catch {
    return false;
  }
};
function parseJson<T>(text: string | null | undefined, fallback: T): T {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

export function unavailable(what: string): AppError {
  return new AppError(503, 'UNAVAILABLE', `${what} is not available in this Bureau build yet. Try again after it is installed.`);
}

interface JobRow {
  id: string;
  title: string;
  company: string;
  location: string | null;
  remote: number;
  ai_score: number | null;
  url: string;
  apply_url_canonical: string | null;
  ats: string | null;
  description_text: string | null;
  match: string | null;
  state: PipelineState | null;
}

const JOB_COLS = `j.id, j.title, j.company, j.location, j.remote, j.ai_score, j.url, j.apply_url_canonical, j.ats, j.description_text, j.match, p.state`;

function jobRow(id: string): JobRow | null {
  if (typeof id !== 'string' || !id || id.length > 200) return null;
  return get<JobRow>(`SELECT ${JOB_COLS} FROM jobs j LEFT JOIN pipeline p ON p.job_id = j.id WHERE j.id = ?`, id) ?? null;
}

function requireJob(id: string): JobRow {
  const j = jobRow(id);
  if (!j) throw new AppError(404, 'NO_JOB', 'No such job');
  return j;
}

function summaryOf(r: JobRow) {
  const m = parseJson<{ verdict?: unknown; screenPassScore?: unknown } | null>(r.match, null);
  const verdict = typeof m?.verdict === 'string' ? m.verdict : '';
  const text = (verdict || r.description_text || '').replace(/\s+/g, ' ').trim();
  const applyUrl = r.apply_url_canonical && isHttpUrl(r.apply_url_canonical) ? r.apply_url_canonical : isHttpUrl(r.url) ? r.url : null;
  const ats = AtsFamily.safeParse(r.ats);
  const score = typeof r.ai_score === 'number' ? r.ai_score : typeof m?.screenPassScore === 'number' ? m.screenPassScore : null;
  return JobSummarySchema.parse({
    id: r.id,
    title: r.title,
    company: r.company,
    location: r.location ?? '',
    remote: !!r.remote,
    score,
    state: r.state ?? 'found',
    applyUrl,
    ats: ats.success ? ats.data : null,
    summary: clip(text, 400),
    claimedBy: activeClaim(r.id)?.holder ?? null,
  });
}

function mustHold(ctx: CallCtx, jobId: string) {
  const c = activeClaim(jobId);
  if (!c) throw new AppError(409, 'NOT_CLAIMED', 'Claim the job first: POST /api/v1/jobs/{id}/claim (MCP tool claim_job).');
  if (c.holder !== holderOf(ctx.key)) {
    throw new AppError(409, 'CLAIMED', c.holder === 'autopilot' ? "Bureau's own autopilot is applying to this job." : 'Another agent is applying to this job.');
  }
}

/** Legal path between two pipeline states through "normal" intermediate states only. */
const STEP_THROUGH: ReadonlySet<PipelineState> = new Set(['filtered', 'scored', 'selected', 'written', 'filling']);
export function pathTo(from: PipelineState, to: PipelineState): PipelineState[] | null {
  if (from === to) return [];
  const queue: [PipelineState, PipelineState[]][] = [[from, []]];
  const seen = new Set<PipelineState>([from]);
  while (queue.length) {
    const [s, p] = queue.shift()!;
    for (const n of TRANSITIONS[s]) {
      if (n === to) return [...p, n];
      if (seen.has(n) || !STEP_THROUGH.has(n)) continue;
      seen.add(n);
      queue.push([n, [...p, n]]);
    }
  }
  return null;
}

function moveTo(jobId: string, to: PipelineState, reason: string, last: Parameters<typeof transition>[2] = {}) {
  let cur = pipelineState(jobId);
  if (!cur) cur = transition(jobId, 'found', { reason });
  const path = pathTo(cur.state, to);
  if (!path) return false;
  path.forEach((s, i) => transition(jobId, s, i === path.length - 1 ? { reason, ...last } : { reason }));
  return true;
}

function applicationExists(id: string | null | undefined): boolean {
  return !!id && !!get('SELECT 1 FROM applications WHERE id = ?', id);
}

function packetResponse(ctx: CallCtx, p: ApplicationPacket) {
  const cv = signFileToken({ jobId: p.jobId, applicationId: p.applicationId, kind: 'cv', keyId: ctx.key.id });
  const letter = signFileToken({ jobId: p.jobId, applicationId: p.applicationId, kind: 'letter', keyId: ctx.key.id });
  return PacketResponse.parse({
    applicationId: p.applicationId,
    jobId: p.jobId,
    subject: p.subject,
    coverLetter: p.coverLetter,
    shortAnswers: p.shortAnswers,
    outreach: p.outreach,
    files: { cv: fileUrl(ctx.baseUrl, cv.token), letter: fileUrl(ctx.baseUrl, letter.token), expiresAt: cv.expiresAt },
  });
}

// ── Operations ───────────────────────────────────────────────────────────────

export function health(ctx: CallCtx) {
  return HealthResponse.parse({ ok: true, version: API_VERSION, scopes: ctx.key.scopes });
}

export function listJobs(ctx: CallCtx, q: { state: PipelineState; limit: number }) {
  requireScope(ctx.key, 'jobs:read');
  const rows = all<JobRow>(
    `SELECT ${JOB_COLS} FROM pipeline p JOIN jobs j ON j.id = p.job_id WHERE p.state = ?
      ORDER BY j.priority DESC, COALESCE(j.ai_score, j.prefilter_score) DESC, p.updated_at ASC LIMIT ?`,
    q.state,
    q.limit,
  );
  return ListJobsResponse.parse({ jobs: rows.map(summaryOf) });
}

export function getJob(ctx: CallCtx, jobId: string) {
  requireScope(ctx.key, 'jobs:read');
  const r = requireJob(jobId);
  const m = parseJson<{ requirements?: unknown } | null>(r.match, null);
  const reqs = Array.isArray(m?.requirements) ? (m.requirements as Record<string, unknown>[]) : [];
  return JobDetailResponse.parse({
    ...summaryOf(r),
    description: clip((r.description_text ?? '').trim(), 30_000),
    requirements: reqs
      .filter((x) => x && typeof x.text === 'string')
      .slice(0, 60)
      .map((x) => ({ text: String(x.text), importance: String(x.importance ?? ''), match: String(x.match ?? '') })),
  });
}

export function claim(ctx: CallCtx, jobId: string, ttlMinutes: number) {
  requireScope(ctx.key, 'applications:write');
  requireJob(jobId);
  if (pipelineState(jobId)?.state === 'submitted') throw new AppError(409, 'ALREADY_SUBMITTED', 'This job has already been applied to.');
  const ttl = Math.max(1, Math.min(60, Math.round(ttlMinutes)));
  const c = claimJob(jobId, holderOf(ctx.key), ttl);
  if (!c) {
    const holder = activeClaim(jobId)?.holder;
    throw new AppError(409, 'CLAIMED', holder === 'autopilot' ? "Bureau's own autopilot is applying to this job." : 'Another agent is applying to this job.');
  }
  recordStep(Date.now(), { campaignId: pipelineState(jobId)?.campaignId ?? null, jobId, step: 'claim', status: 'external', detail: { keyId: ctx.key.id, expiresAt: c.expiresAt } });
  return ClaimResponse.parse(c);
}

export function release(ctx: CallCtx, jobId: string) {
  requireScope(ctx.key, 'applications:write');
  releaseClaim(jobId, holderOf(ctx.key));
  return { ok: true as const };
}

/** States from which Bureau may write a packet for an external agent. */
const WRITE_FROM: ReadonlySet<PipelineState> = new Set(['selected', 'written', 'failed', 'needs_you', 'rehearsed']);

export async function packet(ctx: CallCtx, jobId: string) {
  requireScope(ctx.key, 'packets:read');
  requireJob(jobId);
  mustHold(ctx, jobId);
  const row = pipelineState(jobId);
  if (row?.state === 'submitted') throw new AppError(409, 'ALREADY_SUBMITTED', 'This job has already been applied to.');
  let p = loadPacket(jobId);
  if (!p) {
    if (row?.state === 'writing') throw new AppError(409, 'BUSY', 'Bureau is writing this packet right now. Try again in a minute.');
    if (!row || !WRITE_FROM.has(row.state)) {
      throw new AppError(409, 'NOT_SELECTED', `Bureau writes packets only for selected jobs; this one is ${row?.state ?? 'not in the pipeline'}.`);
    }
    const ai = takeAi(ctx.key.id);
    if (!ai.ok) throw new AppError(429, 'AI_RATE_LIMITED', `This key has used its hourly allowance of written packets and answers. Retry in ${ai.retryAfterSec} s.`);
    const d = await apiDeps();
    if (row.state !== 'selected') transition(jobId, 'selected', { reason: 'External agent asked for a packet' });
    transition(jobId, 'writing', { reason: `Writing a packet for external agent "${ctx.key.name}"` });
    let res;
    try {
      res = await d.writeApplication(jobId, row.campaignId ?? '');
    } catch (err) {
      transition(jobId, 'selected', { reason: 'Packet not written' });
      if (isNotImplemented(err)) throw unavailable('The writer');
      if (err instanceof AppError) throw err;
      throw new AppError(502, 'WRITER_FAILED', `The writer failed: ${redact((err as Error).message ?? String(err))}`);
    }
    if ('skipped' in res) {
      transition(jobId, 'skipped', { reason: res.skipped });
      throw new AppError(422, 'WRITER_SKIPPED', `Bureau decided not to apply: ${res.skipped}`);
    }
    const parsed = ApplicationPacketSchema.safeParse(res);
    if (!parsed.success) {
      transition(jobId, 'selected', { reason: 'Writer returned an invalid packet' });
      throw new AppError(502, 'WRITER_FAILED', 'The writer returned an invalid packet.');
    }
    p = parsed.data;
    savePacket(jobId, row.campaignId, p, Date.now());
    transition(jobId, 'written', { reason: 'Packet ready (external agent)' });
    // Writing can take minutes: make sure the agent still has a working lease.
    const c = activeClaim(jobId);
    if (c && c.holder === holderOf(ctx.key) && Date.parse(c.expiresAt) - Date.now() < 10 * 60_000) claimJob(jobId, holderOf(ctx.key), 20);
  }
  if (!p.quality.truth.pass) {
    throw new AppError(409, 'TRUTH_LOCK', "This packet did not pass Bureau's truth check. The owner has to review it in Bureau before anyone applies.");
  }
  return packetResponse(ctx, p);
}

const PROSE_KINDS: ReadonlySet<FieldKind> = new Set(['text', 'textarea', 'richtext', 'unknown']);

/** An answer must be one of the options when the field has options. */
function fitOption(value: string, options: string[] | undefined): string | null {
  const v = value.trim();
  if (!v) return null;
  if (!options?.length) return v;
  if (options.includes(v)) return v;
  const low = v.toLowerCase();
  return options.find((o) => o.trim().toLowerCase() === low) ?? null;
}

export async function answer(ctx: CallCtx, q: z.infer<typeof AnswerRequest>) {
  requireScope(ctx.key, 'answers:read');
  requireJob(q.jobId);
  const d = await apiDeps();
  const question = cleanText(q.question).replace(/\s+/g, ' ');
  if (!question) throw new AppError(400, 'INVALID', 'question: empty');
  const options = q.options ? [...new Set(q.options.map((o) => cleanText(o)).filter(Boolean))] : undefined;
  const kind = q.fieldKind;
  const done = (value: string, source: z.infer<typeof AnswerResponse>['source'], confidence: number) =>
    AnswerResponse.parse({ value, source, confidence: Math.max(0, Math.min(1, confidence)), unknownId: null });
  const p = loadPacket(q.jobId);

  // 1. Deterministic map (A05): profile synonyms, packet short answers, files.
  if (p) {
    let norm = question.toLowerCase();
    try {
      norm = d.normalizeQuestion(question);
    } catch {
      /* fall back to lower case */
    }
    const field: FormField = {
      id: 'q',
      kind,
      label: question,
      labelNorm: norm,
      required: true,
      options,
      step: 0,
      signature: crypto.createHash('sha1').update(`${norm}|${kind}|${(options ?? []).join('|')}`).digest('hex').slice(0, 16),
    };
    try {
      const vals = await d.mapFields([field], p);
      const v = vals.find((x) => x.fieldId === 'q');
      if (v && v.confidence >= 0.7) {
        const value = fitOption(v.value, options);
        if (value) return done(value, v.source, v.confidence);
      }
    } catch (err) {
      if (!isNotImplemented(err)) console.error(`api answer: mapFields failed: ${redact((err as Error).message)}`);
    }
    // Pre-written short answers in the packet, keyed by normalised question.
    const short = p.shortAnswers[norm];
    if (!options?.length && typeof short === 'string' && short.trim()) return done(short.trim(), 'writer', 0.8);
  }
  if (kind === 'file') return done(/cover|letter|motivation/i.test(question) ? 'letter' : 'cv', 'file', 0.9);

  // 2. Answer bank and profile (A03).
  try {
    const a = await d.answerFor(question, { jobId: q.jobId, fieldKind: kind, options });
    if (a) {
      const value = fitOption(a.value, options);
      if (value) return done(value, a.source, a.confidence);
    }
  } catch (err) {
    if (!isNotImplemented(err)) throw err;
  }

  // 3. The writer (A04), for prose only. Choice questions (sponsorship, consent, ...) are never guessed.
  if (PROSE_KINDS.has(kind) && !options?.length) {
    const ai = takeAi(ctx.key.id);
    if (!ai.ok) throw new AppError(429, 'AI_RATE_LIMITED', `This key has used its hourly allowance of written answers. Retry in ${ai.retryAfterSec} s.`);
    try {
      const a = await d.answerQuestion(q.jobId, question, { maxChars: kind === 'text' ? 500 : undefined });
      const value = a ? fitOption(a.value, undefined) : null;
      if (a && value) return done(value, a.source, a.confidence);
    } catch (err) {
      if (!isNotImplemented(err) && !(err instanceof AppError && err.code === 'BUDGET')) {
        console.error(`api answer: writer failed: ${redact((err as Error).message)}`);
      }
    }
  }

  // 4. Nobody knows: the owner will be asked.
  const unknownId = d.recordUnknown({ question, jobId: q.jobId, fieldKind: kind, options });
  return AnswerResponse.parse({ value: null, source: 'unknown', confidence: 0, unknownId });
}

export async function recipe(ctx: CallCtx, url: string) {
  requireScope(ctx.key, 'recipes:read');
  if (!isHttpUrl(url) || url.length > 2048) throw new AppError(400, 'INVALID', 'url: must be an http(s) URL');
  const d = await apiDeps();
  const job = get<{ ats: string | null; company: string }>('SELECT ats, company FROM jobs WHERE url = ? OR apply_url_canonical = ? LIMIT 1', url, url);
  let ats: AtsFamily | null = null;
  try {
    ats = d.detectAts(url);
  } catch (err) {
    if (!isNotImplemented(err)) throw err;
    const parsed = AtsFamily.safeParse(job?.ats);
    ats = parsed.success ? parsed.data : null;
  }
  let found;
  try {
    found = d.findRecipe({ ats, company: job?.company, url, statuses: ['active'] });
  } catch (err) {
    if (isNotImplemented(err)) throw unavailable('The recipe store');
    throw err;
  }
  const parsed = found ? RecipeSchema.safeParse(found) : null;
  return RecipeResponse.parse({ recipe: parsed?.success && parsed.data.status === 'active' ? parsed.data : null });
}

/** Stricter, local view of a trace: bounded strings and http(s) URLs. `origin` is ignored (set from the key). */
const S = (n: number) => z.string().max(n);
export const ExternalTraceSchema = TraceSchema.extend({
  id: S(100).optional(),
  jobId: S(200).nullable(),
  applicationId: S(200).nullable(),
  origin: S(200).optional(),
  url: S(2048),
  startedAt: S(40),
  finishedAt: S(40),
  steps: z
    .array(
      TraceSchema.shape.steps.element.extend({
        fieldSignature: S(200).optional(),
        labelNorm: S(500).optional(),
        widget: S(100).optional(),
        selectors: z.array(S(1000)).max(20).default([]),
        valueKey: S(200).optional(),
        url: S(2048),
        beforeShot: S(500).optional(),
        afterShot: S(500).optional(),
        note: S(1000).optional(),
      }),
    )
    .max(500),
});

export async function trace(ctx: CallCtx, input: z.infer<typeof ExternalTraceSchema>) {
  requireScope(ctx.key, 'traces:write');
  if (!isHttpUrl(input.url)) throw new AppError(400, 'INVALID', 'url: must be an http(s) URL');
  if (input.steps.some((s) => s.url && !isHttpUrl(s.url))) throw new AppError(400, 'INVALID', 'steps[].url: must be http(s) URLs');
  if (input.jobId && !jobRow(input.jobId)) throw new AppError(400, 'UNKNOWN_JOB', 'jobId: no such job');
  if (input.applicationId) {
    const app = get<{ job_id: string }>('SELECT job_id FROM applications WHERE id = ?', input.applicationId);
    if (!app || (input.jobId && app.job_id !== input.jobId)) throw new AppError(400, 'UNKNOWN_APPLICATION', 'applicationId: no such application for this job');
  }
  if (Number.isNaN(Date.parse(input.startedAt)) || Number.isNaN(Date.parse(input.finishedAt))) throw new AppError(400, 'INVALID', 'startedAt/finishedAt: ISO timestamps');
  // Screenshot paths on the agent's machine mean nothing here and must never be opened: dropped.
  const t: Trace = TraceSchema.parse({
    jobId: input.jobId,
    applicationId: input.applicationId,
    origin: holderOf(ctx.key),
    url: input.url,
    ats: input.ats,
    outcome: input.outcome,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    steps: input.steps.map((s) => ({ ...s, beforeShot: undefined, afterShot: undefined, note: s.note ? cleanText(s.note) : undefined })),
  });
  return submitTrace(ctx, t);
}

async function submitTrace(ctx: CallCtx, t: Trace) {
  const d = await apiDeps();
  try {
    const id = d.submitExternalTrace(t, ctx.key.id);
    return TraceSubmitResponse.parse({ traceId: id, queued: true });
  } catch (err) {
    if (!isNotImplemented(err)) throw err;
  }
  // The learning loop (A06) is not installed yet: keep the trace in agent_traces so nothing is lost.
  const id = crypto.randomUUID();
  run(
    'INSERT INTO agent_traces (id, job_id, application_id, origin, url, ats, trace, outcome, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    id,
    t.jobId,
    t.applicationId,
    t.origin,
    t.url,
    t.ats,
    JSON.stringify({ ...t, id }),
    t.outcome,
    now(),
  );
  return TraceSubmitResponse.parse({ traceId: id, queued: false });
}

export function submitted(ctx: CallCtx, jobId: string, body: z.infer<typeof SubmittedRequest>) {
  requireScope(ctx.key, 'applications:write');
  const job = requireJob(jobId);
  if (!isHttpUrl(body.url)) throw new AppError(400, 'INVALID', 'url: must be an http(s) URL');
  const holder = holderOf(ctx.key);
  const row = pipelineState(jobId);
  if (row?.state === 'submitted') {
    const mine = get("SELECT 1 FROM applications WHERE job_id = ? AND origin = ? AND status IN ('sent', 'submitted')", jobId, holder);
    if (mine) return { ok: true as const };
    throw new AppError(409, 'ALREADY_SUBMITTED', 'This job was already recorded as applied to.');
  }
  const claimNow = activeClaim(jobId);
  const proof = storeProof(body.proofScreenshot);
  const confirmation = body.confirmationText ? clip(cleanText(body.confirmationText), 2000) : '';
  const p = loadPacket(jobId);
  const ts = now();
  const reason = clip(`Submitted by external agent "${ctx.key.name}" at ${body.url}${confirmation ? `. Confirmation: ${confirmation}` : ''}`, 3000);

  // The application row first: if anything below fails, the autopilot still sees "already sent".
  let appId = p && applicationExists(p.applicationId) ? p.applicationId : null;
  if (appId) {
    run(
      `UPDATE applications SET status = 'sent', sent_at = ?, channel = 'ats', origin = ?, shot = ?, reason = ?, updated_at = ? WHERE id = ?`,
      ts,
      holder,
      proof.name,
      reason,
      ts,
      appId,
    );
  } else {
    appId = crypto.randomUUID();
    run(
      `INSERT INTO applications (id, job_id, subject, cover_letter, status, channel, sent_at, created_at, updated_at, origin, shot, reason, campaign_id)
       VALUES (?, ?, ?, ?, 'sent', 'ats', ?, ?, ?, ?, ?, ?, ?)`,
      appId,
      jobId,
      p?.subject ?? '',
      p?.coverLetter ?? '',
      ts,
      ts,
      ts,
      holder,
      proof.name,
      reason,
      row?.campaignId ?? null,
    );
  }
  moveTo(jobId, 'submitted', `External agent "${ctx.key.name}" submitted it`, { campaignId: row?.campaignId ?? null });
  recordStep(Date.now(), {
    campaignId: row?.campaignId ?? null,
    jobId,
    step: 'submitted',
    status: 'external',
    detail: {
      applicationId: appId,
      channel: 'external',
      keyId: ctx.key.id,
      shot: proof.type === 'png' ? proof.name : null,
      claim: !claimNow ? 'none' : claimNow.holder === holder ? 'held' : 'other',
    },
  });
  releaseClaim(jobId, holder);
  emit({ type: 'application', id: appId, status: 'sent' });
  emit({ type: 'activity', message: `External agent "${ctx.key.name}" applied to ${job.title} at ${job.company}`, level: 'info', jobId });
  logEvent('applied', `External agent "${ctx.key.name}" applied to ${job.title} at ${job.company}`, jobId);
  return { ok: true as const };
}

/** Where an external failure may move a job; other states keep theirs. */
const FAILABLE: ReadonlySet<PipelineState> = new Set(['selected', 'writing', 'written', 'filling', 'verified']);

export function failed(ctx: CallCtx, jobId: string, body: z.infer<typeof FailedRequest>) {
  requireScope(ctx.key, 'applications:write');
  const job = requireJob(jobId);
  mustHold(ctx, jobId);
  const row = pipelineState(jobId);
  if (row?.state === 'submitted') throw new AppError(409, 'ALREADY_SUBMITTED', 'This job was already recorded as applied to.');
  const reason = clip(cleanText(body.reason).replace(/\s+/g, ' '), 1000) || 'No reason given';
  const message = `External agent "${ctx.key.name}" could not apply: ${reason}`;
  if (row && FAILABLE.has(row.state)) {
    moveTo(jobId, 'failed', message, { error: message, countAttempt: true, nextActionAt: new Date(Date.now() + 30 * 60_000).toISOString() });
  }
  const p = loadPacket(jobId);
  if (p && applicationExists(p.applicationId)) {
    run("UPDATE applications SET status = 'failed', reason = ?, updated_at = ? WHERE id = ? AND status NOT IN ('sent', 'submitted')", message, now(), p.applicationId);
  }
  recordStep(Date.now(), { campaignId: row?.campaignId ?? null, jobId, step: 'error', status: 'external_failed', detail: { keyId: ctx.key.id, reason } });
  releaseClaim(jobId, holderOf(ctx.key));
  emit({ type: 'activity', message: `${message} (${job.title} at ${job.company})`, level: 'warn', jobId });
  return { ok: true as const };
}
