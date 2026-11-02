import type { FastifyInstance } from 'fastify';
import { z } from 'zod/v4';
import { all } from '../db.ts';
import { AppError } from '../errors.ts';
import { PIPELINE_STATES, type Campaign, type PipelineState } from '../contracts/campaign.ts';
import { body } from '../routes/util.ts';
import { defaultMatchConfig } from '../match/settings.ts';
import { loadMatchProfile } from '../match/profile.ts';
import { deliver } from '../notify/index.ts';
import { clearTelegram, NotifySettingsSchema, publicNotifyState, saveNotifySettings, setNtfyTopic, setTelegramCredentials, telegramToken } from '../notify/settings.ts';
import { recentChats } from '../notify/telegram.ts';
import {
  campaignMeta,
  createCampaign,
  CreateCampaignSchema,
  deleteCampaign,
  getCampaign,
  listCampaigns,
  requireCampaign,
  updateCampaign,
} from './campaigns.ts';
import { buildDigest, getDigest, listDigests, renderDigestText } from './digest.ts';
import { getEngine } from './index.ts';
import { stepsForJob } from './journal.ts';
import { killState, setKillState, stopFilePresent } from './kill.ts';
import { pipelineLog, pipelineRows, pipelineState } from './pipeline.ts';
import { AutopilotSettingsSchema, autopilotSettings, saveAutopilotSettings } from './settings.ts';

/**
 * UI-facing routes (A08). Everything lives under /api/campaigns, /api/digests,
 * /api/notify and /api/kill; the v1 /api/hunt routes stay in routes/system.ts
 * and reach the autopilot through services/hunt.ts.
 *
 *   GET    /api/campaigns                       every campaign with meta and stats, plus autopilot status
 *   POST   /api/campaigns                       create ({ name, config, start? })
 *   GET    /api/campaigns/defaults              a starter config from the profile's preferences
 *   GET    /api/campaigns/status                autopilot status (kill, current job, next apply, tasks)
 *   GET    /api/campaigns/settings              global autopilot settings
 *   PUT    /api/campaigns/settings              update them (partial)
 *   POST   /api/campaigns/run-now               scout now and skip the pacing wait once
 *   GET    /api/campaigns/jobs/:jobId/timeline  pipeline transitions + worker steps for one job
 *   GET    /api/campaigns/:id                   one campaign with meta and stats
 *   PUT    /api/campaigns/:id                   rename / change config (partial config is merged)
 *   DELETE /api/campaigns/:id                   delete (not while active)
 *   POST   /api/campaigns/:id/start             draft or paused → active
 *   POST   /api/campaigns/:id/pause             active → paused
 *   POST   /api/campaigns/:id/resume            paused → active (clears the kill flag)
 *   POST   /api/campaigns/:id/end               → ended, sends the final digest
 *   GET    /api/campaigns/:id/pipeline          jobs in the campaign (?state=a,b&limit=)
 *   GET    /api/campaigns/:id/steps             the worker journal (?limit=)
 *   GET    /api/digests                         stored digests (?campaignId=&limit=)
 *   GET    /api/digests/:id                     one digest with its plain-text rendering
 *   POST   /api/digests/preview                 build today's digest without saving or sending ({ campaignId? })
 *   POST   /api/digests/send                    build, save and send today's digest now ({ campaignId? })
 *   GET    /api/notify                          channel settings and which secrets are set (never the secrets)
 *   PUT    /api/notify/settings                 channel switches
 *   PUT    /api/notify/telegram                 bot token and/or chat id ({ token?, chatId? }) into the vault
 *   DELETE /api/notify/telegram                 forget the bot
 *   GET    /api/notify/telegram/chats           chats that recently messaged the bot (to find your chat id)
 *   PUT    /api/notify/ntfy                     ntfy topic ({ topic | null }) into the vault
 *   POST   /api/notify/test                     send a test message ({ channel: telegram | ntfy | email })
 *   GET    /api/kill                            kill-switch state
 *   POST   /api/kill                            trip the kill switch ({ reason? })
 *   DELETE /api/kill                            clear the flag (campaigns stay paused until resumed)
 */

const SEND_LIMIT = { config: { rateLimit: { max: 6, timeWindow: '1 minute' } } };

function view(c: Campaign) {
  const e = getEngine();
  return { ...c, meta: campaignMeta(c.id), stats: e.campaignStats(c) };
}

export async function campaignRoutes(app: FastifyInstance) {
  // ── Campaigns ──
  app.get('/api/campaigns', async () => ({ campaigns: listCampaigns().map(view), status: getEngine().status() }));

  app.post('/api/campaigns', async (req) => {
    const input = body(CreateCampaignSchema.extend({ start: z.boolean().optional() }), req.body);
    const c = createCampaign({ name: input.name, config: input.config });
    if (input.start) getEngine().startCampaign(c.id);
    return view(requireCampaign(c.id));
  });

  app.get('/api/campaigns/defaults', async () => {
    let profile = null;
    try {
      profile = loadMatchProfile();
    } catch {
      profile = null;
    }
    const cfg = defaultMatchConfig(profile);
    let tz = 'UTC';
    try {
      tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
      /* keep UTC */
    }
    return { name: 'My campaign', config: { ...cfg, activeHours: { tz, start: '09:00', end: '18:00' }, budgetUsd: 20, dryRunDays: 2, minScore: 60 } };
  });

  app.get('/api/campaigns/status', async () => getEngine().status());

  app.get('/api/campaigns/settings', async () => autopilotSettings());
  app.put('/api/campaigns/settings', async (req) => saveAutopilotSettings(body(AutopilotSettingsSchema.partial(), req.body)));

  app.post('/api/campaigns/run-now', { config: { rateLimit: { max: 4, timeWindow: '1 minute' } } }, async () => {
    if (killState()) throw new AppError(409, 'KILLED', 'The kill switch is on. Resume a campaign first.');
    if (!listCampaigns('active').length) throw new AppError(409, 'NO_CAMPAIGN', 'Start a campaign first.');
    getEngine().runNow();
    return { ok: true };
  });

  app.get('/api/campaigns/jobs/:jobId/timeline', async (req) => {
    const { jobId } = req.params as { jobId: string };
    const state = pipelineState(jobId);
    if (!state) throw new AppError(404, 'NOT_FOUND', 'That job is not in the pipeline.');
    const transitions = pipelineLog(jobId).map((t) => ({ kind: 'transition' as const, ts: t.ts, from: t.from, to: t.to, reason: t.reason }));
    const steps = stepsForJob(jobId).map((s) => ({ kind: 'step' as const, ts: s.ts, step: s.step, status: s.status, detail: s.detail }));
    const timeline = [...transitions, ...steps].sort((a, b) => a.ts.localeCompare(b.ts));
    return { state, timeline };
  });

  app.get('/api/campaigns/:id', async (req) => view(requireCampaign((req.params as { id: string }).id)));

  app.put('/api/campaigns/:id', async (req) => {
    const { id } = req.params as { id: string };
    const patch = body(z.object({ name: z.string().trim().min(1).max(80).optional(), config: z.record(z.string(), z.unknown()).optional() }), req.body);
    return view(updateCampaign(id, patch));
  });

  app.delete('/api/campaigns/:id', async (req) => {
    deleteCampaign((req.params as { id: string }).id);
    return { ok: true };
  });

  app.post('/api/campaigns/:id/start', async (req) => view(getEngine().startCampaign((req.params as { id: string }).id)));
  app.post('/api/campaigns/:id/pause', async (req) => view(getEngine().pauseCampaign((req.params as { id: string }).id)));
  app.post('/api/campaigns/:id/resume', async (req) => view(getEngine().resumeCampaign((req.params as { id: string }).id)));
  app.post('/api/campaigns/:id/end', async (req) => {
    const r = await getEngine().endCampaign((req.params as { id: string }).id);
    return { ...view(r.campaign), finalDigestId: r.digestId };
  });

  app.get('/api/campaigns/:id/pipeline', async (req) => {
    const { id } = req.params as { id: string };
    requireCampaign(id);
    const q = req.query as { state?: string; limit?: string };
    const states = (q.state ? q.state.split(',') : [...PIPELINE_STATES]).filter((s): s is PipelineState => (PIPELINE_STATES as readonly string[]).includes(s));
    const limit = Math.min(500, Math.max(1, Number(q.limit) || 200));
    const rows = pipelineRows(id, states, limit);
    const jobs = new Map(
      rows.length
        ? all<{ id: string; title: string; company: string; location: string | null; url: string }>(
            `SELECT id, title, company, location, url FROM jobs WHERE id IN (${rows.map(() => '?').join(',')})`,
            ...rows.map((r) => r.jobId),
          ).map((j) => [j.id, j])
        : [],
    );
    return { rows: rows.map((r) => ({ ...r, job: jobs.get(r.jobId) ?? null })) };
  });

  app.get('/api/campaigns/:id/steps', async (req) => {
    const { id } = req.params as { id: string };
    requireCampaign(id);
    const limit = Math.min(500, Math.max(1, Number((req.query as { limit?: string }).limit) || 100));
    return {
      steps: all<{ id: number; ts: string; job_id: string | null; step: string; status: string; detail: string }>(
        'SELECT * FROM campaign_steps WHERE campaign_id = ? ORDER BY id DESC LIMIT ?',
        id,
        limit,
      ).map((s) => ({ id: s.id, ts: s.ts, jobId: s.job_id, step: s.step, status: s.status, detail: JSON.parse(s.detail) as unknown })),
    };
  });

  // ── Digests ──
  app.get('/api/digests', async (req) => {
    const q = req.query as { campaignId?: string; limit?: string };
    return { digests: listDigests(q.campaignId || null, Math.min(200, Math.max(1, Number(q.limit) || 30))) };
  });

  app.get('/api/digests/:id', async (req) => {
    const d = getDigest((req.params as { id: string }).id);
    if (!d) throw new AppError(404, 'NOT_FOUND', 'No such digest.');
    return { ...d, text: renderDigestText(d.content) };
  });

  const digestTarget = (campaignId: string | undefined | null) => {
    if (!campaignId) return null;
    const c = getCampaign(campaignId);
    if (!c) throw new AppError(404, 'NOT_FOUND', 'No such campaign.');
    return c;
  };

  app.post('/api/digests/preview', async (req) => {
    const { campaignId } = body(z.object({ campaignId: z.string().nullable().optional() }), req.body);
    const e = getEngine();
    const content = buildDigest(digestTarget(campaignId), e.deps.clock.now(), { sourceHealth: () => e.deps.sourceHealth() });
    return { content, text: renderDigestText(content) };
  });

  app.post('/api/digests/send', SEND_LIMIT, async (req) => {
    const { campaignId } = body(z.object({ campaignId: z.string().nullable().optional() }), req.body);
    const e = getEngine();
    const r = await e.sendDigest(digestTarget(campaignId), e.deps.clock.now(), false);
    return { id: r.id, via: r.via, text: renderDigestText(r.content) };
  });

  // ── Notifications ──
  app.get('/api/notify', async () => publicNotifyState());

  app.put('/api/notify/settings', async (req) => {
    saveNotifySettings(body(NotifySettingsSchema, req.body));
    return publicNotifyState();
  });

  app.put('/api/notify/telegram', async (req) => {
    const b = body(z.object({ token: z.string().max(200).optional(), chatId: z.string().max(40).optional() }), req.body);
    setTelegramCredentials(b.token, b.chatId);
    return publicNotifyState();
  });

  app.delete('/api/notify/telegram', async () => {
    clearTelegram();
    return publicNotifyState();
  });

  app.get('/api/notify/telegram/chats', SEND_LIMIT, async () => {
    const token = telegramToken();
    if (!token) throw new AppError(412, 'NO_TELEGRAM', 'Save the bot token first, then send your bot any message.');
    return { chats: await recentChats(token) };
  });

  app.put('/api/notify/ntfy', async (req) => {
    const b = body(z.object({ topic: z.string().max(64).nullable() }), req.body);
    setNtfyTopic(b.topic);
    return publicNotifyState();
  });

  app.post('/api/notify/test', SEND_LIMIT, async (req) => {
    const { channel } = body(z.object({ channel: z.enum(['telegram', 'ntfy', 'email']) }), req.body);
    const kind = channel === 'email' ? 'digest' : channel === 'ntfy' ? 'alert' : 'info';
    // Send through the real fan-out, but only to the requested channel.
    const { notifySettings } = await import('../notify/settings.ts');
    const s = notifySettings();
    const only = {
      telegram: { ...s.telegram, enabled: channel === 'telegram', info: true },
      email: { ...s.email, digest: channel === 'email' },
      ntfy: { ...s.ntfy, enabled: channel === 'ntfy', alerts: true },
    };
    const res = await deliver(kind, { title: 'Bureau test message', body: 'If you can read this, notifications reach you.' }, only);
    if (!res.via.includes(channel)) {
      const err = res.errors.find((x) => x.channel === channel)?.message ?? `${channel} is not set up yet.`;
      throw new AppError(502, 'NOTIFY_FAILED', err);
    }
    return { ok: true, via: res.via };
  });

  // ── Kill switch ──
  app.get('/api/kill', async () => ({ kill: killState(), stopFile: stopFilePresent() }));

  app.post('/api/kill', async (req) => {
    const { reason } = body(z.object({ reason: z.string().max(200).optional() }), req.body);
    const r = await getEngine().kill(reason?.trim() || 'Stopped from the app', 'ui');
    return { ok: true, ms: r.ms, settled: r.settled, kill: r.state };
  });

  app.delete('/api/kill', async () => {
    if (stopFilePresent()) throw new AppError(409, 'STOP_FILE', 'Delete data/STOP first.');
    setKillState(null);
    return { kill: null };
  });
}
