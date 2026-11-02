import type { FastifyInstance } from 'fastify';
import { z } from 'zod/v4';
import { ApplicationStage, InboxClass } from '../contracts/inbox.ts';
import { get, getSetting } from '../db.ts';
import { AppError } from '../errors.ts';
import { body } from '../routes/util.ts';
import { heldCount, waitingCount } from './codes.ts';
import { followUpCandidates, followUpsSentToday, listFollowUps, runFollowUps } from './followup.ts';
import { testConnection } from './imap.ts';
import { pollInbox } from './index.ts';
import { classCounts, getMessage, listMessages, saveMessage } from './messages.ts';
import { forgetMailbox, imapPassword, inboxSettings, InboxSettingsPatch, InboxSettingsSchema, publicInboxSettings, saveInboxSettings } from './settings.ts';
import { advanceStage, recordOutcome, setStageManually } from './stage.ts';

/**
 * UI-facing routes for the job-search mailbox (A09). Everything lives under
 * /api/inbox. Nothing here sends mail to anyone but a follow-up run.
 *
 *   GET    /api/inbox/settings                mailbox settings (never the password; `password.set` says if one is stored)
 *   PUT    /api/inbox/settings                save settings (partial); `password` goes to the vault
 *   DELETE /api/inbox/settings                forget the mailbox password and stop polling
 *   POST   /api/inbox/test                    test-connect (body may carry unsaved settings and a password)
 *   GET    /api/inbox/status                  last poll, last error, counts, held codes (count only), follow-ups today
 *   POST   /api/inbox/poll                    poll now
 *   GET    /api/inbox/messages                list (?class=a,b&applicationId=&unlinked=1&review=1&q=&since=&limit=&offset=)
 *   GET    /api/inbox/messages/:id            one message
 *   PUT    /api/inbox/messages/:id            owner correction ({ class?, applicationId? }); re-applies stage and outcome
 *   GET    /api/inbox/drafts                  recruiter replies drafted from the answer bank, waiting for the owner
 *   POST   /api/inbox/drafts/:id/done         the owner sent it themselves
 *   POST   /api/inbox/drafts/:id/dismiss      throw the draft away
 *   GET    /api/inbox/followups               follow-up log plus who is due, waiting or blocked (and why)
 *   POST   /api/inbox/followups/run           send due follow-ups now (within today's cap)
 *   PUT    /api/inbox/stage/:applicationId    set an application's stage by hand ({ stage })
 */

const id = (req: { params: unknown }) => (req.params as { id: string }).id;
const TEST_LIMIT = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

const ListQuery = z.object({
  class: z.string().optional(),
  applicationId: z.string().max(100).optional(),
  unlinked: z.enum(['0', '1', 'true', 'false']).optional(),
  review: z.enum(['0', '1', 'true', 'false']).optional(),
  q: z.string().max(200).optional(),
  since: z.string().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).max(100_000).optional(),
});

const yes = (v: string | undefined) => v === '1' || v === 'true';

const Correction = z.object({
  class: InboxClass.optional(),
  applicationId: z.string().min(1).max(100).nullable().optional(),
});

export async function inboxRoutes(app: FastifyInstance) {
  app.get('/api/inbox/settings', async () => ({ settings: publicInboxSettings() }));

  app.put('/api/inbox/settings', async (req) => {
    saveInboxSettings(body(InboxSettingsPatch, req.body));
    return { settings: publicInboxSettings() };
  });

  app.delete('/api/inbox/settings', async () => {
    forgetMailbox();
    return { settings: publicInboxSettings() };
  });

  app.post('/api/inbox/test', TEST_LIMIT, async (req) => {
    const patch = body(InboxSettingsPatch, req.body);
    const { password, ...rest } = patch;
    const cur = inboxSettings();
    const merged = InboxSettingsSchema.safeParse({ ...cur, ...rest, followUps: { ...cur.followUps, ...(rest.followUps ?? {}) } });
    if (!merged.success) throw new AppError(400, 'INVALID', merged.error.issues[0]?.message ?? 'Invalid settings');
    return testConnection(merged.data, password ?? imapPassword());
  });

  app.get('/api/inbox/status', async () => {
    const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
    return {
      enabled: inboxSettings().enabled,
      lastPoll: getSetting('inbox.lastPoll', null),
      lastError: getSetting('inbox.lastError', null),
      counts: { all: classCounts(), week: classCounts(weekAgo) },
      unlinked: listMessages({ unlinked: true, limit: 1 }).total,
      review: listMessages({ review: true, limit: 1 }).total,
      codes: { held: heldCount(), waiting: waitingCount() },
      followUps: { today: followUpsSentToday(), perDay: inboxSettings().followUps.perDay },
    };
  });

  app.post('/api/inbox/poll', async () => ({ handled: await pollInbox() }));

  app.get('/api/inbox/messages', async (req) => {
    const q = body(ListQuery, req.query);
    const classes = q.class ? q.class.split(',').map((c) => InboxClass.safeParse(c.trim())) : [];
    if (classes.some((c) => !c.success)) throw new AppError(400, 'INVALID', 'class: unknown inbox class');
    return listMessages({
      class: classes.map((c) => c.data!),
      applicationId: q.applicationId,
      unlinked: yes(q.unlinked),
      review: yes(q.review),
      q: q.q,
      since: q.since,
      limit: q.limit,
      offset: q.offset,
    });
  });

  app.get('/api/inbox/messages/:id', async (req) => {
    const m = getMessage(id(req));
    if (!m) throw new AppError(404, 'NOT_FOUND', 'No such message');
    return { message: m };
  });

  app.put('/api/inbox/messages/:id', async (req) => {
    const m = getMessage(id(req));
    if (!m) throw new AppError(404, 'NOT_FOUND', 'No such message');
    const c = body(Correction, req.body);
    if (c.applicationId && !get('SELECT id FROM applications WHERE id = ?', c.applicationId)) throw new AppError(404, 'NOT_FOUND', 'No such application');
    if (c.class === 'verification_code' && m.class !== 'verification_code') throw new AppError(400, 'INVALID', 'A message cannot become a verification code after the fact.');
    if (c.class) m.class = c.class;
    if (c.applicationId !== undefined) {
      m.applicationId = c.applicationId;
      if (c.applicationId) {
        const job = get<{ company: string; title: string }>('SELECT j.company, j.title FROM applications a JOIN jobs j ON j.id = a.job_id WHERE a.id = ?', c.applicationId);
        if (job) {
          m.company = job.company;
          m.role = job.title;
        }
      }
    }
    m.via = 'owner';
    m.confidence = 1;
    m.needsReview = false;
    m.suspicious = false;
    m.link = { ...m.link, ambiguous: false };
    if (m.applicationId) {
      const ch = advanceStage(m.applicationId, m.class, 1);
      if (ch.changed) m.stage = { from: ch.from, to: ch.to };
      recordOutcome(m.applicationId, m.class, m.receivedAt);
    }
    saveMessage(m);
    return { message: getMessage(m.id) };
  });

  app.get('/api/inbox/drafts', async () => ({
    items: listMessages({ class: ['recruiter_question'], limit: 200 }).items.filter((m) => m.draft?.status === 'queued' || m.unanswered.length),
  }));

  for (const action of ['done', 'dismiss'] as const) {
    app.post(`/api/inbox/drafts/:id/${action}`, async (req) => {
      const m = getMessage(id(req));
      if (!m?.draft) throw new AppError(404, 'NOT_FOUND', 'No draft for that message');
      m.draft.status = action === 'done' ? 'done' : 'dismissed';
      saveMessage(m);
      return { message: m };
    });
  }

  app.get('/api/inbox/followups', async () => {
    const all = followUpCandidates();
    return {
      log: listFollowUps(),
      due: all.filter((c) => !c.blocked),
      waiting: all.filter((c) => c.blocked === 'not due yet'),
      blocked: all.filter((c) => c.blocked && c.blocked !== 'not due yet' && c.blocked !== 'already followed up'),
      today: followUpsSentToday(),
      perDay: inboxSettings().followUps.perDay,
    };
  });

  app.post('/api/inbox/followups/run', async () => runFollowUps({ force: true }));

  app.put('/api/inbox/stage/:applicationId', async (req) => {
    const appId = (req.params as { applicationId: string }).applicationId;
    const { stage } = body(z.object({ stage: ApplicationStage }), req.body);
    return setStageManually(appId, stage);
  });
}
