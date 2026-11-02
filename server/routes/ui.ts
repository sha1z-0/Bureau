import type { FastifyInstance } from 'fastify';
import { z } from 'zod/v4';
import { apiKey } from '../ai/claude.ts';
import { all, get, getSetting, setSetting } from '../db.ts';
import { AppError } from '../errors.ts';
import { PIPELINE_STATES, type PipelineState } from '../contracts/campaign.ts';
import { listCampaigns } from '../campaign/campaigns.ts';
import { getEngine } from '../campaign/index.ts';
import { killState, stopFilePresent } from '../campaign/kill.ts';
import { isDryRun } from '../campaign/campaigns.ts';
import { telegramCredentials } from '../notify/settings.ts';
import { storedGithub } from '../profile/github.ts';
import { storedLinks } from '../profile/links.ts';
import { secretHint } from '../security/vault.ts';
import { smtpSettings } from '../services/mailer.ts';
import { loadProfile } from '../services/profileStore.ts';
import { body, json } from './util.ts';

/**
 * UI-only read models and the onboarding state (A10). These sit beside the v1
 * routes and only read other modules' tables or call their exported functions.
 *
 *   GET  /api/onboarding            wizard progress plus what each step already has
 *   PUT  /api/onboarding            save progress ({ current?, complete?, skip?, done?, reset? })
 *   GET  /api/shell                 live state and badge counts for the app shell (polled, SSE-invalidated)
 *   GET  /api/pipeline              pipeline rows across campaigns, joined with the job (?state=a,b&campaignId=&q=&limit=)
 *   GET  /api/pipeline/jobs/:id     everything the job timeline needs that has no module route of its own
 */

export const ONBOARDING_STEPS = ['cv', 'links', 'github', 'voice', 'answers', 'learning', 'apikey', 'mailbox', 'telegram', 'campaign'] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

interface OnboardingState {
  current: OnboardingStep;
  completed: OnboardingStep[];
  skipped: OnboardingStep[];
  done: boolean;
  updatedAt: string | null;
}

const KEY = 'ui.onboarding';
const DEFAULT_STATE: OnboardingState = { current: 'cv', completed: [], skipped: [], done: false, updatedAt: null };

export function onboardingState(): OnboardingState {
  const s = getSetting<Partial<OnboardingState>>(KEY, {});
  const known = (xs: unknown): OnboardingStep[] => (Array.isArray(xs) ? xs.filter((x): x is OnboardingStep => (ONBOARDING_STEPS as readonly string[]).includes(x as string)) : []);
  return {
    current: (ONBOARDING_STEPS as readonly string[]).includes(s.current as string) ? (s.current as OnboardingStep) : 'cv',
    completed: known(s.completed),
    skipped: known(s.skipped),
    done: !!s.done,
    updatedAt: typeof s.updatedAt === 'string' ? s.updatedAt : null,
  };
}

const count = (sql: string, ...p: string[]) => get<{ n: number }>(sql, ...p)?.n ?? 0;

/** What the owner already has for each step, so the wizard can say "done" without being told. */
export function onboardingFacts() {
  const links = storedLinks();
  const profile = loadProfile();
  const answers = all<{ answer: string }>('SELECT answer FROM answer_bank');
  const smtp = smtpSettings();
  return {
    cv: { ready: !!profile, detail: profile ? profile.name || 'Profile built' : null },
    links: { ready: !!(links.github || links.portfolio || links.linkedin || links.socials?.length), detail: null },
    github: { ready: !!storedGithub(), detail: storedGithub()?.login ?? null },
    voice: { ready: count('SELECT COUNT(*) AS n FROM voice_bank') >= 6, count: count('SELECT COUNT(*) AS n FROM voice_bank'), target: 6 },
    answers: { ready: answers.length > 0 && answers.filter((a) => a.answer.trim()).length >= Math.min(8, answers.length), count: answers.filter((a) => a.answer.trim()).length, total: answers.length },
    learning: { ready: count('SELECT COUNT(*) AS n FROM learning_list') > 0, count: count('SELECT COUNT(*) AS n FROM learning_list') },
    apikey: { ready: !!apiKey(), detail: null },
    mailbox: { ready: !!smtp && secretHint('smtp_password').set, smtp: !!smtp && secretHint('smtp_password').set, imap: secretHint('imap_password').set },
    telegram: { ready: !!telegramCredentials(), detail: null },
    campaign: { ready: count('SELECT COUNT(*) AS n FROM campaigns') > 0, count: count('SELECT COUNT(*) AS n FROM campaigns') },
  };
}

function onboardingView() {
  const state = onboardingState();
  const facts = onboardingFacts();
  const settled = new Set([...state.completed, ...state.skipped]);
  const ready = ONBOARDING_STEPS.filter((s) => facts[s].ready).length;
  return {
    ...state,
    steps: ONBOARDING_STEPS.map((id) => ({ id, completed: state.completed.includes(id), skipped: state.skipped.includes(id), ready: facts[id].ready })),
    facts,
    ready,
    total: ONBOARDING_STEPS.length,
    settled: settled.size,
    /** The wizard opens by itself only on a truly fresh install. */
    firstRun: !state.done && !facts.cv.ready && !facts.campaign.ready && settled.size === 0,
  };
}

const OnboardingPatch = z.object({
  current: z.enum(ONBOARDING_STEPS).optional(),
  complete: z.enum(ONBOARDING_STEPS).optional(),
  skip: z.enum(ONBOARDING_STEPS).optional(),
  done: z.boolean().optional(),
  reset: z.boolean().optional(),
});

interface PipelineJoined {
  job_id: string;
  campaign_id: string | null;
  state: PipelineState;
  attempts: number;
  next_action_at: string | null;
  last_error: string | null;
  updated_at: string;
  title: string;
  company: string;
  location: string | null;
  remote: number;
  ai_score: number | null;
  ai_grade: string | null;
  ats: string | null;
  stage: string;
  found_at: string;
  campaign_name: string | null;
  application_id: string | null;
}

export async function uiRoutes(app: FastifyInstance) {
  // ── Onboarding ───────────────────────────────────────────────────────
  app.get('/api/onboarding', async () => onboardingView());

  app.put('/api/onboarding', async (req) => {
    const p = body(OnboardingPatch, req.body);
    const s = p.reset ? { ...DEFAULT_STATE } : onboardingState();
    if (p.complete) {
      s.completed = [...new Set([...s.completed, p.complete])];
      s.skipped = s.skipped.filter((x) => x !== p.complete);
    }
    if (p.skip && !s.completed.includes(p.skip)) s.skipped = [...new Set([...s.skipped, p.skip])];
    if (p.current) s.current = p.current;
    if (p.done !== undefined) s.done = p.done;
    s.updatedAt = new Date().toISOString();
    setSetting(KEY, s);
    return onboardingView();
  });

  // ── App shell: live state and badges ─────────────────────────────────
  app.get('/api/shell', async () => {
    const campaigns = listCampaigns().filter((c) => c.status === 'active' || c.status === 'paused');
    const status = getEngine().status();
    const nowMs = Date.parse(status.now);
    const current = status.current
      ? (() => {
          const j = get<{ title: string; company: string }>('SELECT title, company FROM jobs WHERE id = ?', status.current.jobId);
          return { ...status.current, title: j?.title ?? null, company: j?.company ?? null };
        })()
      : null;
    const ob = onboardingView();
    return {
      live: campaigns.some((c) => c.status === 'active') && !status.kill,
      kill: status.kill,
      stopFile: status.stopFile,
      campaigns: campaigns.map((c) => ({ id: c.id, name: c.name, status: c.status, dryRun: isDryRun(c, nowMs) })),
      current,
      nextApplyAt: status.nextApplyAt,
      counts: {
        questions: count("SELECT COUNT(*) AS n FROM unknown_questions WHERE status = 'open'"),
        needsYou: count("SELECT COUNT(*) AS n FROM pipeline WHERE state = 'needs_you'"),
        inbox: count('SELECT COUNT(*) AS n FROM inbox_messages WHERE handled = 0'),
        drafts: count("SELECT COUNT(*) AS n FROM applications WHERE status = 'draft'"),
      },
      onboarding: { done: ob.done, firstRun: ob.firstRun, ready: ob.ready, total: ob.total },
    };
  });

  // ── Pipeline across campaigns ────────────────────────────────────────
  app.get('/api/pipeline', async (req) => {
    const q = body(
      z.object({
        state: z.string().max(400).optional(),
        campaignId: z.string().max(80).optional(),
        q: z.string().max(120).optional(),
        limit: z.coerce.number().int().min(1).max(1000).default(400),
      }),
      req.query,
    );
    const states = (q.state ? q.state.split(',') : [...PIPELINE_STATES]).filter((s): s is PipelineState => (PIPELINE_STATES as readonly string[]).includes(s));
    if (!states.length) throw new AppError(400, 'INVALID', 'state: no known pipeline state given');
    const where: string[] = [];
    const params: string[] = [];
    if (q.campaignId) {
      where.push(q.campaignId === 'none' ? 'p.campaign_id IS NULL' : 'p.campaign_id = ?');
      if (q.campaignId !== 'none') params.push(q.campaignId);
    }
    if (q.q) {
      where.push('(j.title LIKE ? OR j.company LIKE ?)');
      const like = `%${q.q.replace(/[%_]/g, '')}%`;
      params.push(like, like);
    }
    const base = `FROM pipeline p JOIN jobs j ON j.id = p.job_id LEFT JOIN campaigns c ON c.id = p.campaign_id ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`;
    const counts = Object.fromEntries(all<{ state: string; n: number }>(`SELECT p.state AS state, COUNT(*) AS n ${base} GROUP BY p.state`, ...params).map((r) => [r.state, r.n]));
    const stateClause = `${where.length ? ' AND' : ' WHERE'} p.state IN (${states.map(() => '?').join(',')})`;
    const rows = all<PipelineJoined>(
      `SELECT p.*, j.title, j.company, j.location, j.remote, j.ai_score, j.ai_grade, j.ats, j.stage, j.found_at, c.name AS campaign_name,
         (SELECT a.id FROM applications a WHERE a.job_id = p.job_id ORDER BY a.updated_at DESC LIMIT 1) AS application_id
       ${base}${stateClause} ORDER BY p.updated_at DESC LIMIT ?`,
      ...params,
      ...states,
      String(q.limit),
    );
    return {
      counts,
      rows: rows.map((r) => ({
        jobId: r.job_id,
        campaignId: r.campaign_id,
        campaignName: r.campaign_name,
        state: r.state,
        attempts: r.attempts,
        nextActionAt: r.next_action_at,
        lastError: r.last_error,
        updatedAt: r.updated_at,
        applicationId: r.application_id,
        job: { title: r.title, company: r.company, location: r.location ?? '', remote: !!r.remote, score: r.ai_score, grade: r.ai_grade, ats: r.ats, stage: r.stage, foundAt: r.found_at },
      })),
    };
  });

  app.get('/api/pipeline/jobs/:id', async (req) => {
    const { id } = body(z.object({ id: z.string().min(1).max(80) }), req.params);
    const j = get<Record<string, unknown>>(
      `SELECT id, source, url, title, company, location, remote, category, posted_at, found_at, stage, apply_email, apply_url_canonical, ats, legitimacy, legitimacy_reasons, sources, priority, ai_score, ai_grade
         FROM jobs WHERE id = ?`,
      id,
    );
    if (!j) throw new AppError(404, 'NOT_FOUND', 'No such job.');
    const pipeline = get<Record<string, unknown>>('SELECT * FROM pipeline WHERE job_id = ?', id);
    const applications = all<{ id: string; status: string; channel: string; sent_at: string | null; shot: string | null; answers: string; stage: string; origin: string; reason: string | null; created_at: string; updated_at: string; campaign_id: string | null }>(
      'SELECT id, status, channel, sent_at, shot, answers, stage, origin, reason, created_at, updated_at, campaign_id FROM applications WHERE job_id = ? ORDER BY updated_at DESC',
      id,
    );
    const appIds = applications.map((a) => a.id);
    const messages = appIds.length
      ? all<{ id: string; from_addr: string; subject: string; received_at: string; class: string; application_id: string; data: string; handled: number }>(
          `SELECT id, from_addr, subject, received_at, class, application_id, data, handled FROM inbox_messages WHERE application_id IN (${appIds.map(() => '?').join(',')}) ORDER BY received_at DESC`,
          ...appIds,
        )
      : [];
    const outcomes = appIds.length
      ? all<{ application_id: string; replied: number; reply_class: string | null; days_to_reply: number | null; updated_at: string }>(
          `SELECT * FROM outcomes WHERE application_id IN (${appIds.map(() => '?').join(',')})`,
          ...appIds,
        )
      : [];
    const questions = all<{ id: string; question_raw: string; status: string; field_kind: string; created_at: string }>(
      'SELECT id, question_raw, status, field_kind, created_at FROM unknown_questions WHERE job_id = ? ORDER BY created_at DESC',
      id,
    );
    return {
      job: {
        id: j.id,
        source: j.source,
        url: j.url,
        title: j.title,
        company: j.company,
        location: j.location ?? '',
        remote: !!j.remote,
        category: j.category,
        postedAt: j.posted_at,
        foundAt: j.found_at,
        stage: j.stage,
        applyEmail: j.apply_email,
        applyUrl: j.apply_url_canonical,
        ats: j.ats,
        legitimacy: j.legitimacy,
        legitimacyReasons: json<string[]>(j.legitimacy_reasons as string, []),
        sources: json<unknown[]>(j.sources as string, []),
        priority: j.priority,
        score: j.ai_score,
        grade: j.ai_grade,
      },
      pipeline: pipeline
        ? { state: pipeline.state, campaignId: pipeline.campaign_id, attempts: pipeline.attempts, nextActionAt: pipeline.next_action_at, lastError: pipeline.last_error, updatedAt: pipeline.updated_at }
        : null,
      applications: applications.map((a) => ({
        id: a.id,
        status: a.status,
        channel: a.channel,
        sentAt: a.sent_at,
        hasShot: !!a.shot,
        answers: json<{ label: string; value: string; source?: string | null }[]>(a.answers, []),
        stage: a.stage,
        origin: a.origin,
        reason: a.reason,
        campaignId: a.campaign_id,
        createdAt: a.created_at,
        updatedAt: a.updated_at,
      })),
      messages: messages.map((m) => {
        const d = json<{ summary?: string; deadline?: string | null; company?: string | null }>(m.data, {});
        return { id: m.id, from: m.from_addr, subject: m.subject, receivedAt: m.received_at, class: m.class, applicationId: m.application_id, summary: d.summary ?? '', deadline: d.deadline ?? null, handled: !!m.handled };
      }),
      outcomes: outcomes.map((o) => ({ applicationId: o.application_id, replied: !!o.replied, replyClass: o.reply_class, daysToReply: o.days_to_reply, updatedAt: o.updated_at })),
      questions: questions.map((q) => ({ id: q.id, question: q.question_raw, status: q.status, fieldKind: q.field_kind, createdAt: q.created_at })),
    };
  });
}
