import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod/v4';
import { aiSettings, DEFAULT_MODELS, MODEL_CHOICES, modelFor, monthSpend, pingKey, resetClient, TASKS, apiKey } from '../ai/claude.ts';
import { UPLOAD_DIR } from '../config.ts';
import { all, db, get, setSetting } from '../db.ts';
import { AppError } from '../errors.ts';
import { passphraseSet, setPassphrase } from '../security/guard.ts';
import { deleteSecret, secretHint, setSecret } from '../security/vault.ts';
import { CONNECTORS, sourceSettings } from '../sources/index.ts';
import { DEFAULT_BOARDS } from '../sources/boards.ts';
import { finishInBrowser, huntSettings, huntStatus, runHuntCycle, saveHuntSettings, stopHunt } from '../services/hunt.ts';
import { SHOT_DIR } from '../services/formFiller.ts';
import { autostartEnabled, autostartSupported, setAutostart } from '../services/autostart.ts';
import { bus, type BusEvent } from '../services/bus.ts';
import { smtpSettings, verifySmtp } from '../services/mailer.ts';
import { currentScan, runScan, scanSettings } from '../services/scanner.ts';
import { loadProfile } from '../services/profileStore.ts';
import { body, json } from './util.ts';

const token = z.string().regex(/^[a-z0-9][a-z0-9-_.]{0,80}$/i, 'Board tokens are letters, digits, dashes');

export async function systemRoutes(app: FastifyInstance) {
  app.get('/api/health', async () => ({ ok: true }));

  // ── Overview ──────────────────────────────────────────────────────────
  app.get('/api/overview', async () => {
    const count = (sql: string, ...p: string[]) => get<{ n: number }>(sql, ...p)?.n ?? 0;
    const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const byCategory = all<{ category: string; n: number }>("SELECT category, COUNT(*) AS n FROM jobs WHERE status != 'dismissed' GROUP BY category");
    const byStage = all<{ stage: string; n: number }>('SELECT stage, COUNT(*) AS n FROM jobs GROUP BY stage');
    const bySource = all<{ source: string; n: number }>('SELECT source, COUNT(*) AS n FROM jobs GROUP BY source ORDER BY n DESC');
    const daily = all<{ day: string; n: number }>(
      "SELECT substr(found_at, 1, 10) AS day, COUNT(*) AS n FROM jobs WHERE found_at >= ? GROUP BY day ORDER BY day",
      new Date(Date.now() - 14 * 86_400_000).toISOString(),
    );
    const grades = all<{ grade: string; n: number }>("SELECT ai_grade AS grade, COUNT(*) AS n FROM jobs WHERE ai_grade IS NOT NULL AND status != 'dismissed' GROUP BY ai_grade");
    const top = all<Record<string, unknown>>(
      `SELECT id, title, company, location, remote, category, ai_score AS score, ai_grade AS grade, json_extract(ai_analysis, '$.verdict') AS verdict, stage, source
       FROM jobs WHERE ai_score IS NOT NULL AND status != 'dismissed' AND stage IN ('found','drafted') ORDER BY ai_score DESC LIMIT 6`,
    );
    const lastScan = get<Record<string, unknown>>('SELECT id, kind, status, started_at, finished_at, found, added, scored FROM scans ORDER BY started_at DESC LIMIT 1');
    const activity = all('SELECT id, ts, kind, job_id AS jobId, message FROM events ORDER BY id DESC LIMIT 14');
    return {
      totals: {
        jobs: count("SELECT COUNT(*) AS n FROM jobs WHERE status != 'dismissed'"),
        newThisWeek: count('SELECT COUNT(*) AS n FROM jobs WHERE found_at >= ?', since),
        scored: count('SELECT COUNT(*) AS n FROM jobs WHERE ai_score IS NOT NULL'),
        strong: count("SELECT COUNT(*) AS n FROM jobs WHERE ai_score >= 78 AND status != 'dismissed'"),
        drafts: count("SELECT COUNT(*) AS n FROM applications WHERE status = 'draft'"),
        approved: count("SELECT COUNT(*) AS n FROM applications WHERE status = 'approved'"),
        needsYou: count("SELECT COUNT(*) AS n FROM applications WHERE status IN ('needs_you', 'failed')"),
        applied: count("SELECT COUNT(*) AS n FROM jobs WHERE stage IN ('applied','interview','offer','rejected','ghosted')"),
        interviews: count("SELECT COUNT(*) AS n FROM jobs WHERE stage IN ('interview','offer')"),
      },
      byCategory,
      byStage,
      bySource,
      daily,
      grades,
      top: top.map((t) => ({ ...t, remote: !!t.remote })),
      lastScan,
      scanning: currentScan(),
      activity,
      spend: { month: monthSpend(), budget: aiSettings().monthlyBudgetUsd },
      setup: { apiKey: !!apiKey(), profile: !!loadProfile(), smtp: !!smtpSettings() && secretHint('smtp_password').set },
    };
  });

  // ── Live event stream (SSE) ──────────────────────────────────────────
  app.get('/api/events', (req, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'x-content-type-options': 'nosniff',
    });
    const send = (e: BusEvent) => reply.raw.write(`data: ${JSON.stringify(e)}\n\n`);
    const ping = setInterval(() => reply.raw.write(': ping\n\n'), 25_000);
    bus.on('event', send);
    req.raw.on('close', () => {
      clearInterval(ping);
      bus.off('event', send);
    });
  });

  // ── Scans ────────────────────────────────────────────────────────────
  app.post('/api/scans', { config: { rateLimit: { max: 6, timeWindow: '1 minute' } } }, async (req) => {
    const opts = body(
      z.object({
        kind: z.enum(['sources', 'deep']).default('sources'),
        only: z.array(z.string().max(40)).max(20).optional(),
        focus: z.string().max(500).optional(),
      }),
      req.body,
    );
    const id = await runScan(opts.kind, { only: opts.only, focus: opts.focus });
    return { id };
  });

  app.get('/api/scans', async () => ({
    scans: all('SELECT id, kind, status, started_at AS startedAt, finished_at AS finishedAt, found, added, scored, error FROM scans ORDER BY started_at DESC LIMIT 30'),
    running: currentScan(),
  }));

  app.get('/api/scans/:id', async (req) => {
    const { id } = req.params as { id: string };
    const scan = get<Record<string, unknown>>('SELECT * FROM scans WHERE id = ?', id);
    if (!scan) throw new AppError(404, 'NOT_FOUND', 'Scan not found');
    return { ...scan, log: json<string[]>(scan.log as string, []) };
  });

  // ── Sources ──────────────────────────────────────────────────────────
  app.get('/api/sources', async () => {
    const s = sourceSettings();
    const counts = Object.fromEntries(all<{ source: string; n: number }>('SELECT source, COUNT(*) AS n FROM jobs GROUP BY source').map((r) => [r.source, r.n]));
    return {
      connectors: CONNECTORS.map((c) => ({
        id: c.id,
        label: c.label,
        kind: c.kind,
        homepage: c.homepage,
        description: c.description,
        enabled: s.enabled[c.id],
        jobs: counts[c.id] ?? 0,
      })),
      boards: s.boards,
      defaultBoards: DEFAULT_BOARDS,
      extraKeywords: s.extraKeywords,
      maxAgeDays: s.maxAgeDays,
      scan: scanSettings(),
    };
  });

  app.put('/api/sources', async (req) => {
    const next = body(
      z.object({
        enabled: z.record(z.string(), z.boolean()),
        boards: z.object({ greenhouse: z.array(token).max(400), lever: z.array(token).max(400), ashby: z.array(token).max(400) }),
        extraKeywords: z.array(z.string().max(80)).max(50),
        maxAgeDays: z.number().int().min(1).max(120),
        scan: z.object({
          intervalHours: z.number().min(0).max(168),
          scoreLimit: z.number().int().min(0).max(200),
          scoreThreshold: z.number().int().min(0).max(100),
        }),
      }),
      req.body,
    );
    const { scan, ...sources } = next;
    setSetting('sources', sources);
    setSetting('scan', scan);
    return { ok: true };
  });

  // ── Settings ─────────────────────────────────────────────────────────
  app.get('/api/settings', async () => ({
    apiKey: { ...secretHint('anthropic_api_key'), fromEnv: !secretHint('anthropic_api_key').set && !!process.env.ANTHROPIC_API_KEY },
    ai: { ...aiSettings(), models: Object.fromEntries(TASKS.map((t) => [t, modelFor(t)])) },
    defaultModels: DEFAULT_MODELS,
    models: MODEL_CHOICES.map(({ id, label, input, output }) => ({ id, label, input, output })),
    tasks: TASKS,
    smtp: smtpSettings(),
    smtpPassword: { set: secretHint('smtp_password').set },
    security: { passphrase: passphraseSet() },
    autostart: { supported: autostartSupported(), enabled: autostartEnabled() },
    spend: monthSpend(),
  }));

  app.put('/api/settings/api-key', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const { key } = body(z.object({ key: z.string().max(400) }), req.body);
    if (!key) {
      deleteSecret('anthropic_api_key');
      resetClient();
      return { ok: true, message: 'Key removed.' };
    }
    if (!/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(key.trim())) throw new AppError(400, 'BAD_KEY', 'That does not look like an Anthropic API key (sk-ant-…).');
    const check = await pingKey(key.trim());
    if (!check.ok) throw new AppError(400, 'BAD_KEY', check.message);
    setSecret('anthropic_api_key', key.trim());
    resetClient();
    return { ok: true, message: check.message };
  });

  app.put('/api/settings/ai', async (req) => {
    const next = body(
      z.object({
        models: z.record(z.enum(TASKS), z.enum(MODEL_CHOICES.map((m) => m.id) as [string, ...string[]])),
        monthlyBudgetUsd: z.number().min(0).max(10_000),
      }),
      req.body,
    );
    setSetting('ai', next);
    return { ok: true };
  });

  // ── The hunt ─────────────────────────────────────────────────────────
  app.get('/api/hunt', async () => huntStatus());

  app.put('/api/hunt', async (req) => {
    const next = body(
      z.object({
        enabled: z.boolean(),
        mode: z.enum(['live', 'rehearse']),
        intervalHours: z.number().min(1).max(48),
        applyThreshold: z.number().int().min(50).max(100),
        dailyCap: z.number().int().min(1).max(40),
        assessPerCycle: z.number().int().min(5).max(200),
        channels: z.object({ email: z.boolean(), forms: z.boolean() }),
      }),
      req.body,
    );
    const wasOn = huntSettings().enabled;
    saveHuntSettings(next);
    if (!next.enabled) stopHunt();
    // Switching the hunt on starts the first round straight away.
    if (next.enabled && !wasOn) await runHuntCycle('manual').catch(() => {});
    return huntStatus();
  });

  app.post('/api/hunt/run', { config: { rateLimit: { max: 4, timeWindow: '1 minute' } } }, async () => {
    await runHuntCycle('manual');
    return { ok: true };
  });

  app.post('/api/hunt/stop', async () => {
    stopHunt();
    return { ok: true };
  });

  app.post('/api/applications/:id/finish', { config: { rateLimit: { max: 6, timeWindow: '1 minute' } } }, async (req) => {
    const { id } = req.params as { id: string };
    const outcome = await finishInBrowser(id);
    return { ok: true, reason: outcome.reason };
  });

  app.get('/api/applications/:id/shot.png', async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = get<{ shot: string | null }>('SELECT shot FROM applications WHERE id = ?', id);
    if (!row?.shot || !/^[0-9a-f-]{36}\.png$/.test(row.shot)) throw new AppError(404, 'NOT_FOUND', 'No screenshot');
    const file = path.join(SHOT_DIR, row.shot);
    if (!fs.existsSync(file)) throw new AppError(404, 'NOT_FOUND', 'No screenshot');
    reply.header('content-type', 'image/png').header('cache-control', 'no-store');
    return reply.send(fs.readFileSync(file));
  });

  app.put('/api/settings/smtp', async (req) => {
    const next = body(
      z.object({
        host: z.string().regex(/^[a-z0-9.-]+$/i, 'Host name only').max(253),
        port: z.number().int().min(1).max(65535),
        secure: z.boolean(),
        user: z.string().max(254),
        from: z.string().max(300),
        bccSelf: z.boolean(),
        password: z.string().max(500).optional(),
      }),
      req.body,
    );
    const { password, ...smtp } = next;
    const prev = smtpSettings();
    const destinationChanged = !prev || prev.host !== smtp.host || prev.port !== smtp.port || prev.user !== smtp.user;
    // The stored password must never be replayed to a server or account it wasn't entered for.
    if (destinationChanged && !password && secretHint('smtp_password').set) {
      throw new AppError(400, 'PASSWORD_REQUIRED', 'Re-enter the app password when you change the server, port or username.');
    }
    setSetting('smtp', smtp);
    if (password) setSecret('smtp_password', password, { hint: false });
    return { ok: true };
  });

  app.post('/api/settings/smtp/test', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async () => {
    try {
      return { ok: true, message: await verifySmtp() };
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError(400, 'SMTP_FAILED', `Could not connect: ${(err as Error).message}`);
    }
  });

  app.put('/api/settings/autostart', { config: { rateLimit: { max: 6, timeWindow: '1 minute' } } }, async (req) => {
    const { enabled } = body(z.object({ enabled: z.boolean() }), req.body);
    setAutostart(enabled);
    return { ok: true, enabled: autostartEnabled() };
  });

  app.put('/api/settings/passphrase', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req) => {
    const { passphrase, current } = body(
      z.object({ passphrase: z.union([z.string().min(10).max(200), z.literal('')]), current: z.string().max(200).default('') }),
      req.body,
    );
    await setPassphrase(passphrase || null, current);
    return { ok: true, passphrase: !!passphrase };
  });

  app.get('/api/usage', async () => ({
    month: monthSpend(),
    byTask: all("SELECT task, model, COUNT(*) AS calls, SUM(input_tokens) AS input, SUM(output_tokens) AS output, SUM(cache_read) AS cacheRead, SUM(web_searches) AS searches, SUM(cost_usd) AS cost FROM ai_usage WHERE ts >= date('now','start of month') GROUP BY task, model ORDER BY cost DESC"),
    daily: all("SELECT substr(ts,1,10) AS day, SUM(cost_usd) AS cost FROM ai_usage WHERE ts >= date('now','-30 day') GROUP BY day ORDER BY day"),
  }));

  // ── Data ownership ───────────────────────────────────────────────────
  app.get('/api/export', async (_req, reply) => {
    const data = {
      exportedAt: new Date().toISOString(),
      profile: loadProfile(),
      jobs: all('SELECT * FROM jobs'),
      applications: all('SELECT * FROM applications'),
      events: all('SELECT * FROM events'),
      settings: all("SELECT key, value FROM settings WHERE key NOT LIKE 'security.%'"),
    };
    reply.header('content-disposition', `attachment; filename="bureau-export-${data.exportedAt.slice(0, 10)}.json"`);
    return data;
  });

  app.post('/api/wipe', async (req) => {
    const { scope } = body(z.object({ confirm: z.literal('ERASE'), scope: z.enum(['jobs', 'everything']) }), req.body);
    if (currentScan()) throw new AppError(409, 'SCAN_RUNNING', 'Wait for the current scan to finish.');
    if (scope === 'jobs') {
      db.exec('DELETE FROM applications; DELETE FROM jobs; DELETE FROM scans; DELETE FROM events;');
    } else {
      db.exec('DELETE FROM applications; DELETE FROM jobs; DELETE FROM scans; DELETE FROM events; DELETE FROM profile; DELETE FROM documents; DELETE FROM secrets; DELETE FROM ai_usage; DELETE FROM settings;');
      for (const f of fs.readdirSync(UPLOAD_DIR)) fs.rmSync(path.join(UPLOAD_DIR, f), { force: true });
      resetClient();
    }
    db.exec('VACUUM');
    return { ok: true };
  });

}
