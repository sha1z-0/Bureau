import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Harness } from '../lib/harness.ts';

/**
 * A10: the UI read-model routes (onboarding, shell, pipeline, job file), the
 * v1 route fixes (skipped filter, JPEG proof shots), the PWA files, and a
 * design lint over web/src (no glyph icons, no middle-dot meta strings).
 */
export default async function a10Ui({ check, section }: Harness) {
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const { run, setSetting } = await import('../../server/db.ts');
  const { AppError } = await import('../../server/errors.ts');
  const { systemRoutes } = await import('../../server/routes/system.ts');
  const { applicationRoutes } = await import('../../server/routes/applications.ts');
  const { transition } = await import('../../server/campaign/pipeline.ts');
  const { SHOT_DIR } = await import('../../server/services/formFiller.ts');
  const { default: Fastify } = await import('fastify');

  section('A10 UI: routes');
  const app = Fastify();
  app.setErrorHandler((err: Error, _req, reply) => {
    if (err instanceof AppError) return reply.status(err.status).send({ error: err.code, message: err.message });
    return reply.status((err as { statusCode?: number }).statusCode ?? 500).send({ error: 'X', message: err.message });
  });
  await app.register(systemRoutes);
  await app.register(applicationRoutes);
  await app.ready();
  const inject = async (method: 'GET' | 'PUT' | 'POST', url: string, payload?: unknown) => {
    const r = await app.inject({ method, url, ...(payload !== undefined ? { payload: payload as object } : {}) });
    let json: Record<string, unknown> = {};
    try {
      json = r.body ? (JSON.parse(r.body) as Record<string, unknown>) : {};
    } catch {
      /* binary body */
    }
    return { status: r.statusCode, json, headers: r.headers, raw: r.rawPayload };
  };

  await check('onboarding progress is saved step by step', async () => {
    const reset = await inject('PUT', '/api/onboarding', { reset: true });
    assert.equal(reset.status, 200);
    assert.equal((reset.json.steps as unknown[]).length, 10);
    assert.equal(reset.json.total, 10);
    const a = await inject('PUT', '/api/onboarding', { complete: 'links', current: 'github' });
    assert.deepEqual(a.json.completed, ['links']);
    assert.equal(a.json.current, 'github');
    const b = await inject('PUT', '/api/onboarding', { skip: 'apikey' });
    assert.deepEqual(b.json.skipped, ['apikey']);
    const c = await inject('PUT', '/api/onboarding', { complete: 'apikey' });
    assert.deepEqual(c.json.skipped, [], 'completing a skipped step un-skips it');
    assert.ok((c.json.completed as string[]).includes('apikey'));
    const g = await inject('GET', '/api/onboarding');
    assert.equal(g.json.current, 'github', 'progress survives a reload');
    assert.equal(g.json.firstRun, false, 'a started wizard never re-opens by itself');
    assert.equal((await inject('PUT', '/api/onboarding', { complete: 'nope' })).status, 400);
    const d = await inject('PUT', '/api/onboarding', { done: true });
    assert.equal(d.json.done, true);
    setSetting('ui.onboarding', {});
  });

  await check('the shell reports live state and badge counts', async () => {
    const r = await inject('GET', '/api/shell');
    assert.equal(r.status, 200);
    const counts = r.json.counts as Record<string, number>;
    for (const k of ['questions', 'needsYou', 'inbox', 'drafts']) assert.equal(typeof counts[k], 'number', k);
    assert.equal(typeof r.json.live, 'boolean');
    assert.ok(Array.isArray(r.json.campaigns));
    assert.equal((r.json.onboarding as { total: number }).total, 10);
  });

  const jobId = `a10-${crypto.randomUUID().slice(0, 8)}`;
  const ts = new Date().toISOString();
  run(
    `INSERT INTO jobs (id, fingerprint, source, url, title, company, location, remote, category, tags, found_at, updated_at, ai_score, ai_grade, ats, sources)
     VALUES (?, ?, 'fixture', ?, 'Zebra Platform Engineer', 'A10 Check Co', 'Remote', 1, 'software', '[]', ?, ?, 71, 'B', 'greenhouse', '["greenhouse"]')`,
    jobId,
    `fp-${jobId}`,
    `https://jobs.a10.example.net/${jobId}`,
    ts,
    ts,
  );
  for (const s of ['found', 'filtered', 'scored', 'selected', 'writing', 'written', 'filling', 'needs_you'] as const) transition(jobId, s, { campaignId: null, reason: s === 'needs_you' ? 'CAPTCHA on the form' : undefined });
  run("INSERT INTO unknown_questions (id, question_raw, question_norm, job_id, field_kind, options, status, created_at) VALUES (?, 'Do you hold a licence?', 'do you hold a licence', ?, 'radio', '[\"Yes\",\"No\"]', 'open', ?)", crypto.randomUUID(), jobId, ts);

  await check('the cross-campaign pipeline lists, counts, filters and searches', async () => {
    const all = await inject('GET', '/api/pipeline?state=needs_you');
    assert.equal(all.status, 200);
    const rows = all.json.rows as { jobId: string; state: string; job: { title: string; ats: string; score: number } }[];
    const mine = rows.find((r) => r.jobId === jobId);
    assert.ok(mine, 'the job is listed');
    assert.equal(mine!.job.ats, 'greenhouse');
    assert.equal(mine!.job.score, 71);
    assert.ok(((all.json.counts as Record<string, number>).needs_you ?? 0) >= 1);
    const q = await inject('GET', '/api/pipeline?q=Zebra');
    assert.ok((q.json.rows as { jobId: string }[]).some((r) => r.jobId === jobId));
    const none = await inject('GET', '/api/pipeline?campaignId=none&state=needs_you');
    assert.ok((none.json.rows as { jobId: string }[]).some((r) => r.jobId === jobId));
    assert.equal((await inject('GET', '/api/pipeline?state=bogus')).status, 400);
  });

  await check('the job file carries the pipeline row, questions and last error', async () => {
    const r = await inject('GET', `/api/pipeline/jobs/${jobId}`);
    assert.equal(r.status, 200);
    assert.equal((r.json.job as { company: string }).company, 'A10 Check Co');
    assert.equal((r.json.pipeline as { state: string }).state, 'needs_you');
    assert.equal((r.json.questions as unknown[]).length, 1);
    assert.equal((await inject('GET', '/api/pipeline/jobs/no-such-job')).status, 404);
  });

  await check('applications can be filtered by skipped (A04 request)', async () => {
    assert.equal((await inject('GET', '/api/applications?status=skipped')).status, 200);
  });

  await check('JPEG proof screenshots are served as image/jpeg (A07 request)', async () => {
    const appId = crypto.randomUUID();
    const jpgName = `${crypto.randomUUID()}.jpg`;
    fs.mkdirSync(SHOT_DIR, { recursive: true });
    fs.writeFileSync(path.join(SHOT_DIR, jpgName), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 0xff, 0xd9]));
    run("INSERT INTO applications (id, job_id, status, channel, created_at, updated_at, shot) VALUES (?, ?, 'sent', 'ats', ?, ?, ?)", appId, jobId, ts, ts, jpgName);
    const r = await inject('GET', `/api/applications/${appId}/shot.png`);
    assert.equal(r.status, 200);
    assert.equal(r.headers['content-type'], 'image/jpeg');
    run('UPDATE applications SET shot = ? WHERE id = ?', '../../etc/passwd.jpg', appId);
    assert.equal((await inject('GET', `/api/applications/${appId}/shot.png`)).status, 404, 'names outside the uuid pattern are refused');
    run('UPDATE applications SET shot = ? WHERE id = ?', `${crypto.randomUUID()}.gif`, appId);
    assert.equal((await inject('GET', `/api/applications/${appId}/shot.png`)).status, 404);
  });

  await app.close();
  run('DELETE FROM unknown_questions WHERE job_id = ?', jobId);

  section('A10 UI: installable app and design lint');

  await check('the PWA manifest is valid and its icons exist', () => {
    const pub = path.join(ROOT, 'web', 'public');
    const m = JSON.parse(fs.readFileSync(path.join(pub, 'manifest.webmanifest'), 'utf8')) as { name: string; start_url: string; display: string; icons: { src: string; sizes: string; purpose?: string }[] };
    assert.equal(m.display, 'standalone');
    assert.ok(m.name && m.start_url.startsWith('/'));
    for (const size of ['192x192', '512x512']) assert.ok(m.icons.some((i) => i.sizes === size && i.src.endsWith('.png')), `a ${size} PNG icon`);
    assert.ok(m.icons.some((i) => i.purpose === 'maskable'), 'a maskable icon');
    for (const i of m.icons) assert.ok(fs.existsSync(path.join(pub, i.src.replace(/^\//, ''))), `${i.src} exists`);
    const html = fs.readFileSync(path.join(ROOT, 'web', 'index.html'), 'utf8');
    assert.match(html, /rel="manifest" href="\/manifest.webmanifest"/);
    assert.match(html, /name="theme-color"/);
    assert.match(html, /rel="apple-touch-icon"/);
  });

  await check('the service worker caches only the app shell, never /api', () => {
    const sw = fs.readFileSync(path.join(ROOT, 'web', 'public', 'sw.js'), 'utf8');
    const apiGuard = sw.indexOf("url.pathname.startsWith('/api/')");
    assert.ok(apiGuard > 0, 'the fetch handler bails out for /api');
    assert.ok(apiGuard < sw.indexOf('respondWith'), 'the /api guard comes before any response handling');
    assert.match(sw, /req\.method !== 'GET'\) return/);
    assert.match(sw, /url\.origin !== self\.location\.origin\) return/);
    const shell = /const SHELL = \[([^\]]*)\]/.exec(sw)?.[1] ?? '';
    assert.ok(!shell.includes('/api'), 'no API path in the precache list');
  });

  await check('no glyph icons or middle-dot strings in the UI source', () => {
    const glyphs = /[✓✗✔✘→←·★☆▲▼►◄⟡—]/;
    const bad: string[] = [];
    const walk = (d: string) => {
      for (const f of fs.readdirSync(d)) {
        const p = path.join(d, f);
        if (fs.statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(f))
          fs.readFileSync(p, 'utf8')
            .split('\n')
            .forEach((line, i) => {
              const code = line.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
              if (!/^\s*\*/.test(line) && glyphs.test(code)) bad.push(`${path.relative(ROOT, p)}:${i + 1}`);
            });
      }
    };
    walk(path.join(ROOT, 'web', 'src'));
    assert.deepEqual(bad, [], `use lucide-react icons and plain words instead: ${bad.join(', ')}`);
  });

  await check('every page the brief names has a route in the app', () => {
    const appSrc = fs.readFileSync(path.join(ROOT, 'web', 'src', 'App.tsx'), 'utf8');
    for (const p of ['welcome', 'campaigns', 'pipeline', 'studio', 'forms', 'agents', 'inbox', 'learning', 'sources', 'questions', 'digests', 'settings', 'profile']) {
      assert.match(appSrc, new RegExp(`path: '${p}'`), `route ${p}`);
    }
    for (const t of ['campaigns', 'pipeline', 'questions', 'inbox', 'digests']) assert.match(appSrc, new RegExp(`'${t}'`), `phone tab ${t}`);
  });
}
