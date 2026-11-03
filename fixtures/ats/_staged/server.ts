/**
 * Staged ATS replicas: forms that follow every convention of
 * scripts/fixture-server.ts (routes that mirror the real URL with the host as
 * the first path segment, `{{ORIGIN_A}}` / `{{ORIGIN_B}}` / `{{FORM_ID}}`
 * templating, POST /__submit/<id>[/<step>], GET /__confirm/<id>, the same
 * FormSpec fields and expect rules) but whose specs live in
 * `fixtures/ats/<dir>/staged.json` instead of `manifest.json`.
 *
 * Why staged: every form in a merged manifest joins the e2e (`npm run e2e`) —
 * a job per form, the matcher's batches and the writer's prompts — so a new
 * replica changes recorded Claude request hashes before anyone has recorded
 * them. The A05/A06 selfchecks run staged replicas through this server; to
 * promote one into the e2e, rename its `staged.json` to `manifest.json` (the
 * spec format is identical), record the writer/match requests for its job,
 * and port the account endpoints below into a scripts/e2e/fixture-routes
 * module (Taleo and SuccessFactors use them).
 *
 * Extra endpoints (replica account gates, never a real site):
 *   POST /__account/<formId>/register  { username?, email, password, profile? } → 200 | 409 exists
 *   POST /__account/<formId>/login     { username, password }                   → 200 { profile } | 401
 *
 *   npx tsx fixtures/ats/_staged/server.ts      start on random ports and print the URLs
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import multipart from '@fastify/multipart';
import { z } from 'zod/v4';
import { ATS_DIR, FormSpecSchema, type FormSpec } from '../../../scripts/e2e/manifest.ts';
import type { Submission, SubmittedFile } from '../../../scripts/e2e/expect.ts';

export const StagedSpecSchema = FormSpecSchema.extend({
  /** The employer and role the replica advertises (selfchecks create a job from it). */
  job: z.object({ company: z.string(), title: z.string(), location: z.string().default('') }),
});
export type StagedSpec = z.infer<typeof StagedSpecSchema>;

const StagedFileSchema = z.object({ forms: z.array(StagedSpecSchema) });

/** Every fixtures/ats/<dir>/staged.json. */
export function loadStaged(): StagedSpec[] {
  const out: StagedSpec[] = [];
  for (const dir of fs.readdirSync(ATS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
    const file = path.join(ATS_DIR, dir, 'staged.json');
    if (!fs.existsSync(file)) continue;
    const parsed = StagedFileSchema.safeParse(JSON.parse(fs.readFileSync(file, 'utf8')));
    if (!parsed.success) throw new Error(`fixtures/ats/${dir}/staged.json: ${parsed.error.message}`);
    out.push(...parsed.data.forms);
  }
  const ids = new Set<string>();
  for (const f of out) {
    if (ids.has(f.id)) throw new Error(`Duplicate staged form id ${f.id}`);
    ids.add(f.id);
  }
  return out;
}

export interface StagedServer {
  originA: string;
  originB: string;
  forms: StagedSpec[];
  url: (formIdOrPath: string, origin?: 'a' | 'b') => string;
  form: (formId: string) => StagedSpec;
  submissions: (filter?: { formId?: string; final?: boolean; valid?: boolean }) => Submission[];
  /** Plant an account the way a candidate who registered by hand would have (Bureau has no password for it). */
  seedAccount: (formId: string, username: string, password: string) => void;
  accounts: (formId: string) => string[];
  reset: () => void;
  close: () => Promise<void>;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};
const TEMPLATED = new Set(['.html', '.js', '.css', '.json']);
const CANARIES = (JSON.parse(fs.readFileSync(path.join(ATS_DIR, 'manifest.json'), 'utf8')) as { canaries: string[] }).canaries;

function atsFile(rel: string): string | null {
  const full = path.resolve(ATS_DIR, rel.replace(/^\/+/, ''));
  if (full !== ATS_DIR && !full.startsWith(ATS_DIR + path.sep)) return null;
  return fs.existsSync(full) && fs.statSync(full).isFile() ? full : null;
}

const sha = (buf: Buffer) => crypto.createHash('sha256').update(buf).digest('hex');

export async function startStagedReplicas(opts: { quiet?: boolean } = {}): Promise<StagedServer> {
  const forms = loadStaged();
  const byId = new Map(forms.map((f) => [f.id, f]));
  const subs: Submission[] = [];
  const accounts = new Map<string, Map<string, { email: string; password: string; profile?: Record<string, unknown> }>>();
  const origins = { a: '', b: '' };
  let seq = 0;
  const log = (m: string) => {
    if (!opts.quiet) console.log(`  [staged] ${m}`);
  };
  const acct = (formId: string) => {
    let m = accounts.get(formId);
    if (!m) accounts.set(formId, (m = new Map()));
    return m;
  };

  const render = (file: string, extra: Record<string, string>) => {
    const full = atsFile(file);
    if (!full) throw new Error(`fixture file not found: ${file}`);
    const vars: Record<string, string> = { ORIGIN_A: origins.a, ORIGIN_B: origins.b, ...extra };
    return fs.readFileSync(full, 'utf8').replace(/\{\{([A-Z_]+)\}\}/g, (m, k: string) => vars[k] ?? m);
  };

  const parseBody = async (req: FastifyRequest) => {
    const fields: Record<string, string[]> = {};
    const files: SubmittedFile[] = [];
    if (req.isMultipart()) {
      for await (const part of req.parts()) {
        if (part.type === 'file') {
          const buf = await part.toBuffer();
          if (!part.filename && buf.length === 0) continue;
          files.push({ field: part.fieldname, filename: part.filename, size: buf.length, sha256: sha(buf), mime: part.mimetype, isPdf: buf.subarray(0, 5).toString('latin1') === '%PDF-' });
        } else (fields[part.fieldname] ??= []).push(String(part.value));
      }
    } else if (req.body && typeof req.body === 'object') {
      for (const [k, v] of Object.entries(req.body as Record<string, unknown>)) for (const x of Array.isArray(v) ? v : [v]) if (x !== undefined && x !== null) (fields[k] ??= []).push(String(x));
    }
    return { fields, files };
  };

  const validate = (spec: FormSpec, body: { fields: Record<string, string[]>; files: SubmittedFile[] }) => {
    const errors: string[] = [];
    const flags: string[] = [];
    const has = (k: string) => (body.fields[k] ?? []).some((v) => v.trim() !== '') || body.files.some((f) => f.field === k && f.size > 0);
    for (const k of spec.required) if (!has(k)) errors.push(`${k} is required`);
    for (const k of spec.honeypots) if ((body.fields[k] ?? []).some((v) => v.trim() !== '')) (errors.push(`${k} must be empty`), flags.push('honeypot'));
    const everything = (JSON.stringify(body.fields) + body.files.map((f) => f.filename).join(' ')).toLowerCase();
    if (CANARIES.some((c) => everything.includes(c.toLowerCase()))) flags.push('injection_canary');
    for (const [k, vals] of Object.entries(body.fields)) {
      if (/e-?mail/i.test(k) && !/opt|consent|subscribe|notify/i.test(k)) for (const v of vals) if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) errors.push(`${k} is not a valid email`);
    }
    return { valid: errors.length === 0 && !flags.includes('injection_canary'), errors, flags };
  };

  async function build(origin: 'a' | 'b'): Promise<FastifyInstance> {
    const app = Fastify({ logger: false, bodyLimit: 20 * 1024 * 1024 });
    await app.register(multipart, { limits: { fileSize: 15 * 1024 * 1024, files: 20, fields: 500 } });
    app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
      const out: Record<string, string[]> = {};
      for (const [k, v] of new URLSearchParams(String(body))) (out[k] ??= []).push(v);
      done(null, out);
    });
    app.addHook('onSend', async (_req, reply) => {
      reply.header('cache-control', 'no-store');
    });
    const sendFile = (reply: FastifyReply, rel: string, extra: Record<string, string> = {}) => {
      const full = atsFile(rel);
      if (!full) return reply.status(404).type('text/plain').send('Not found');
      const ext = path.extname(full).toLowerCase();
      reply.type(MIME[ext] ?? 'application/octet-stream');
      return reply.send(TEMPLATED.has(ext) ? render(rel, extra) : fs.readFileSync(full));
    };
    for (const spec of forms) {
      app.get(spec.route, async (_req, reply) => sendFile(reply, spec.file, { FORM_ID: spec.id }));
      for (const extra of spec.extraRoutes) app.get(extra.route, async (_req, reply) => sendFile(reply, extra.file, { FORM_ID: spec.id }));
    }
    app.get('/ats/*', async (req, reply) => sendFile(reply, (req.params as { '*': string })['*']));

    const submit = async (req: FastifyRequest, reply: FastifyReply) => {
      const { formId, '*': rest } = req.params as { formId: string; '*'?: string };
      const spec = byId.get(formId);
      if (!spec) return reply.status(404).send({ ok: false, error: 'unknown form' });
      const body = await parseBody(req);
      const step = (rest ?? '').replace(/^\/+|\/+$/g, '');
      const final = step === '' || step === 'final';
      const v = final ? validate(spec, body) : { valid: true, errors: [] as string[], flags: [] as string[] };
      const sub: Submission = {
        formId, ats: spec.ats, step, origin, method: req.method, path: req.url, contentType: String(req.headers['content-type'] ?? '').split(';')[0],
        fields: body.fields, files: body.files, session: null, valid: v.valid, errors: v.errors, flags: v.flags, final, seq: ++seq, ts: new Date().toISOString(),
      };
      subs.push(sub);
      log(`${final ? 'SUBMIT' : 'step  '} ${formId}${step ? `/${step}` : ''} → ${v.valid ? 'valid' : `invalid (${v.errors.join('; ')})`}`);
      return reply.status(v.valid ? 200 : 422).send({ ok: v.valid, errors: v.errors, redirect: v.valid && final ? `/__confirm/${formId}?ref=${sub.seq}` : null, ref: sub.seq });
    };
    app.post('/__submit/:formId', submit);
    app.post('/__submit/:formId/*', submit);

    app.get('/__confirm/:formId', async (req, reply) => {
      const spec = byId.get((req.params as { formId: string }).formId);
      if (!spec) return reply.status(404).send('Not found');
      if (spec.confirmationFile) return sendFile(reply, spec.confirmationFile, { FORM_ID: spec.id });
      return reply.type('text/html; charset=utf-8').send(`<!doctype html><title>Application received</title><main><h1>${spec.confirmationText}</h1></main>`);
    });

    app.post('/__account/:formId/register', async (req, reply) => {
      const { formId } = req.params as { formId: string };
      const b = (req.body ?? {}) as { username?: string; email?: string; password?: string; profile?: Record<string, unknown> };
      const user = String(b.username || b.email || '').trim().toLowerCase();
      const m = acct(formId);
      if (!user || !b.password) return reply.status(400).send({ ok: false, error: 'missing' });
      if (m.has(user) || [...m.values()].some((x) => x.email.toLowerCase() === String(b.email ?? '').toLowerCase())) return reply.status(409).send({ ok: false, error: 'exists' });
      m.set(user, { email: String(b.email ?? user), password: String(b.password), profile: b.profile ?? {} });
      log(`account created on ${formId}: ${user}`);
      return { ok: true };
    });
    app.post('/__account/:formId/login', async (req, reply) => {
      const { formId } = req.params as { formId: string };
      const b = (req.body ?? {}) as { username?: string; password?: string };
      const user = String(b.username ?? '').trim().toLowerCase();
      const hit = acct(formId).get(user) ?? [...acct(formId).values()].find((x) => x.email.toLowerCase() === user);
      if (!hit || hit.password !== b.password) return reply.status(401).send({ ok: false });
      return { ok: true, profile: hit.profile ?? {} };
    });
    app.get('/__fixture/health', async () => ({ ok: true, origin, forms: forms.length }));
    return app;
  }

  const appA = await build('a');
  const appB = await build('b');
  origins.a = (await appA.listen({ host: '127.0.0.1', port: 0 })).replace('localhost', '127.0.0.1');
  origins.b = (await appB.listen({ host: '127.0.0.1', port: 0 })).replace('localhost', '127.0.0.1');

  return {
    originA: origins.a,
    originB: origins.b,
    forms,
    url: (idOrPath, origin) => {
      const spec = byId.get(idOrPath);
      if (spec) return `${(origin ?? spec.origin) === 'b' ? origins.b : origins.a}${spec.route}`;
      return `${origin === 'b' ? origins.b : origins.a}${idOrPath.startsWith('/') ? '' : '/'}${idOrPath}`;
    },
    form: (id) => {
      const spec = byId.get(id);
      if (!spec) throw new Error(`No staged form ${id}`);
      return spec;
    },
    submissions: (f = {}) => subs.filter((s) => (f.formId === undefined || s.formId === f.formId) && (f.final === undefined || s.final === f.final) && (f.valid === undefined || s.valid === f.valid)),
    seedAccount: (formId, username, password) => void acct(formId).set(username.toLowerCase(), { email: username, password }),
    accounts: (formId) => [...acct(formId).keys()],
    reset: () => {
      subs.length = 0;
      accounts.clear();
    },
    close: async () => {
      await Promise.all([appA.close(), appB.close()]);
    },
  };
}

const invokedDirectly = !!process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) {
  const sx = await startStagedReplicas();
  console.log(`\n  Bureau staged replicas\n  origin A: ${sx.originA}\n  origin B: ${sx.originB}\n`);
  for (const f of sx.forms) console.log(`  ${f.id.padEnd(30)} ${sx.url(f.id)}`);
  process.on('SIGINT', async () => {
    await sx.close();
    process.exit(0);
  });
}
