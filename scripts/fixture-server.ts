/**
 * Local ATS fixture server: faithful replicas of real application forms,
 * served on two loopback origins (random ports) so cross-origin iframes are
 * real. Every POST is recorded, so tests assert exactly what was sent.
 *
 *   npm run fixtures                    start on random ports and print the URLs
 *   npm run fixtures -- --port 7001     origin A on 7001, origin B on 7002
 *
 * Programmatic use (selfcheck, e2e):
 *   const fx = await startFixtureServer();
 *   await page.goto(fx.url('greenhouse-classic'));
 *   fx.submissions({ formId: 'greenhouse-classic', final: true })
 *
 * The server imports nothing from server/, so it can start before app modules
 * read their environment.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import multipart from '@fastify/multipart';
import { ATS_DIR, ROOT, loadManifest, type FormSpec, type Manifest } from './e2e/manifest.ts';
import type { Submission, SubmittedFile } from './e2e/expect.ts';

export type { Submission, SubmittedFile } from './e2e/expect.ts';

export interface MailItem {
  seq: number;
  ts: string;
  to: string;
  from: string;
  subject: string;
  text: string;
  /** Raw RFC 822 message, ready to hand to the inbox ingester. */
  eml: string;
  /** Machine-readable extras for tests (e.g. the verification code). Never part of the message headers. */
  meta: Record<string, string>;
}

export interface ParsedBody {
  fields: Record<string, string[]>;
  files: SubmittedFile[];
}

export interface FixtureRouteContext {
  manifest: Manifest;
  origin: 'a' | 'b';
  originA: () => string;
  originB: () => string;
  /** Read a file under fixtures/ats and fill {{ORIGIN_A}}, {{ORIGIN_B}}, {{FORM_ID}} and any extras. */
  render: (file: string, extra?: Record<string, string>) => string;
  parseBody: (req: FastifyRequest) => Promise<ParsedBody>;
  validate: (spec: FormSpec, body: ParsedBody) => { valid: boolean; errors: string[]; flags: string[] };
  record: (s: Omit<Submission, 'seq' | 'ts'>) => Submission;
  addMail: (m: { to: string; from: string; subject: string; text: string; html?: string; meta?: Record<string, string> }) => MailItem;
  /** Fixture-local state shared by both origins (e.g. Workday accounts). Cleared by reset(). */
  state: Map<string, unknown>;
  log: (msg: string) => void;
}

/** A per-ATS server extension in scripts/e2e/fixture-routes/<name>.ts exports `register`. */
export type RegisterFixtureRoutes = (app: FastifyInstance, ctx: FixtureRouteContext) => void | Promise<void>;

export interface FixtureServer {
  originA: string;
  originB: string;
  manifest: Manifest;
  /** Entry URL of a form by id, or an arbitrary path on origin A/B. */
  url: (formIdOrPath: string, origin?: 'a' | 'b') => string;
  form: (formId: string) => FormSpec;
  submissions: (filter?: { formId?: string; final?: boolean; valid?: boolean }) => Submission[];
  mail: () => MailItem[];
  reset: () => void;
  close: () => Promise<void>;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
};
const TEMPLATED = new Set(['.html', '.js', '.css', '.json']);
const ROUTES_DIR = path.join(ROOT, 'scripts', 'e2e', 'fixture-routes');

/** Resolve a path under fixtures/ats, refusing anything that escapes it. */
function atsFile(rel: string): string | null {
  const full = path.resolve(ATS_DIR, rel.replace(/^\/+/, ''));
  if (full !== ATS_DIR && !full.startsWith(ATS_DIR + path.sep)) return null;
  return fs.existsSync(full) && fs.statSync(full).isFile() ? full : null;
}

export function wantsJson(req: FastifyRequest): boolean {
  const accept = String(req.headers.accept ?? '');
  return accept.includes('application/json') || req.headers['x-requested-with'] === 'XMLHttpRequest' || String(req.headers['content-type'] ?? '').includes('application/json');
}

function oneLine(v: string): string {
  return v.replace(/[\r\n]+/g, ' ');
}

export function buildEml(seq: number, m: { to: string; from: string; subject: string; text: string; html?: string }): string {
  const boundary = `fx-${crypto.randomBytes(8).toString('hex')}`;
  const domain = m.from.replace(/.*@/, '').replace(/>.*/, '') || 'fixtures.test';
  const lines = [
    `From: ${oneLine(m.from)}`,
    `To: ${oneLine(m.to)}`,
    `Subject: ${oneLine(m.subject)}`,
    `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <fixture-${seq}-${crypto.randomBytes(6).toString('hex')}@${domain}>`,
    'MIME-Version: 1.0',
  ];
  if (!m.html) {
    lines.push('Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: 8bit', '', m.text);
  } else {
    lines.push(
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      m.text,
      `--${boundary}`,
      'Content-Type: text/html; charset=utf-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      m.html,
      `--${boundary}--`,
      '',
    );
  }
  return lines.join('\r\n');
}

const sha = (buf: Buffer) => crypto.createHash('sha256').update(buf).digest('hex');
const isPdf = (buf: Buffer) => buf.subarray(0, 5).toString('latin1') === '%PDF-';

export async function startFixtureServer(opts: { portA?: number; portB?: number; quiet?: boolean } = {}): Promise<FixtureServer> {
  const manifest = loadManifest();
  const byId = new Map(manifest.forms.map((f) => [f.id, f]));
  const subs: Submission[] = [];
  const mails: MailItem[] = [];
  const state = new Map<string, unknown>();
  let seq = 0;
  const origins = { a: '', b: '' };
  const log = (msg: string) => {
    if (!opts.quiet) console.log(`  [fixtures] ${msg}`);
  };

  const render = (file: string, extra: Record<string, string> = {}) => {
    const full = atsFile(file);
    if (!full) throw new Error(`fixture file not found: ${file}`);
    const vars: Record<string, string> = { ORIGIN_A: origins.a, ORIGIN_B: origins.b, ...extra };
    return fs.readFileSync(full, 'utf8').replace(/\{\{([A-Z_]+)\}\}/g, (m, k: string) => vars[k] ?? m);
  };

  const parseBody = async (req: FastifyRequest): Promise<ParsedBody> => {
    const fields: Record<string, string[]> = {};
    const files: SubmittedFile[] = [];
    const add = (k: string, v: unknown) => {
      if (v === undefined || v === null) return;
      if (Array.isArray(v)) return v.forEach((x) => add(k, x));
      if (typeof v === 'object') {
        // JSON clients may send uploads inline as { filename, contentBase64, mime }.
        const o = v as Record<string, unknown>;
        if (typeof o.contentBase64 === 'string') {
          const buf = Buffer.from(o.contentBase64, 'base64');
          files.push({ field: k, filename: String(o.filename ?? 'upload'), size: buf.length, sha256: sha(buf), mime: String(o.mime ?? 'application/octet-stream'), isPdf: isPdf(buf) });
          return;
        }
        for (const [kk, vv] of Object.entries(o)) add(`${k}[${kk}]`, vv);
        return;
      }
      (fields[k] ??= []).push(String(v));
    };
    if (req.isMultipart()) {
      for await (const part of req.parts()) {
        if (part.type === 'file') {
          const buf = await part.toBuffer();
          if (!part.filename && buf.length === 0) continue; // an untouched <input type=file>
          files.push({ field: part.fieldname, filename: part.filename, size: buf.length, sha256: sha(buf), mime: part.mimetype, isPdf: isPdf(buf) });
        } else {
          add(part.fieldname, part.value);
        }
      }
    } else if (req.body && typeof req.body === 'object') {
      for (const [k, v] of Object.entries(req.body as Record<string, unknown>)) add(k, v);
    }
    return { fields, files };
  };

  const validate = (spec: FormSpec, body: ParsedBody) => {
    const errors: string[] = [];
    const flags: string[] = [];
    const has = (k: string) => (body.fields[k] ?? []).some((v) => v.trim() !== '') || body.files.some((f) => f.field === k && f.size > 0);
    for (const k of spec.required) if (!has(k)) errors.push(`${k} is required`);
    for (const k of spec.honeypots) {
      if ((body.fields[k] ?? []).some((v) => v.trim() !== '')) {
        errors.push(`${k} must be empty`);
        flags.push('honeypot');
      }
    }
    if (spec.captcha) {
      const token = ['g-recaptcha-response', 'h-captcha-response', 'cf-turnstile-response'].flatMap((k) => body.fields[k] ?? []).join('');
      // The CAPTCHA mocks only mint a token from a trusted (human) click.
      if (!token.startsWith('human-')) {
        errors.push('captcha not completed');
        flags.push('captcha_missing');
      }
    }
    const everything = (JSON.stringify(body.fields) + body.files.map((f) => f.filename).join(' ')).toLowerCase();
    if (manifest.canaries.some((c) => everything.includes(c.toLowerCase()))) flags.push('injection_canary');
    for (const [k, vals] of Object.entries(body.fields)) {
      if (/e-?mail/i.test(k) && !/opt|consent|subscribe|notify/i.test(k)) {
        for (const v of vals) if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) errors.push(`${k} is not a valid email`);
      }
    }
    return { valid: errors.length === 0 && !flags.includes('injection_canary'), errors, flags: [...new Set(flags)] };
  };

  const record = (s: Omit<Submission, 'seq' | 'ts'>): Submission => {
    const full: Submission = { ...s, seq: ++seq, ts: new Date().toISOString() };
    subs.push(full);
    log(`${full.final ? 'SUBMIT' : 'step  '} ${full.formId}${full.step ? `/${full.step}` : ''} → ${full.valid ? 'valid' : `invalid (${full.errors.join('; ')})`}${full.flags.length ? ` [${full.flags.join(',')}]` : ''}`);
    return full;
  };

  const addMail: FixtureRouteContext['addMail'] = (m) => {
    const n = mails.length + 1;
    const item: MailItem = { seq: n, ts: new Date().toISOString(), to: m.to, from: m.from, subject: m.subject, text: m.text, eml: buildEml(n, m), meta: m.meta ?? {} };
    mails.push(item);
    log(`mail → ${m.to}: ${m.subject}`);
    return item;
  };

  const routeModules: { name: string; register: RegisterFixtureRoutes }[] = [];
  if (fs.existsSync(ROUTES_DIR)) {
    for (const f of fs.readdirSync(ROUTES_DIR).filter((x) => x.endsWith('.ts')).sort()) {
      const mod = (await import(pathToFileURL(path.join(ROUTES_DIR, f)).href)) as { register?: RegisterFixtureRoutes };
      if (typeof mod.register === 'function') routeModules.push({ name: f, register: mod.register });
    }
  }

  async function build(origin: 'a' | 'b'): Promise<FastifyInstance> {
    const app = Fastify({ logger: false, bodyLimit: 20 * 1024 * 1024 });
    await app.register(multipart, { limits: { fileSize: 15 * 1024 * 1024, files: 20, fields: 500 } });
    app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
      const out: Record<string, string | string[]> = {};
      for (const [k, v] of new URLSearchParams(String(body))) {
        const cur = out[k];
        out[k] = cur === undefined ? v : Array.isArray(cur) ? [...cur, v] : [cur, v];
      }
      done(null, out);
    });
    app.addHook('onSend', async (_req, reply) => {
      reply.header('cache-control', 'no-store');
    });

    const ctx: FixtureRouteContext = { manifest, origin, originA: () => origins.a, originB: () => origins.b, render, parseBody, validate, record, addMail, state, log };

    const sendFile = (reply: FastifyReply, rel: string, extra: Record<string, string> = {}) => {
      const full = atsFile(rel);
      if (!full) return reply.status(404).type('text/plain').send('Not found');
      const ext = path.extname(full).toLowerCase();
      reply.type(MIME[ext] ?? 'application/octet-stream');
      return reply.send(TEMPLATED.has(ext) ? render(rel, extra) : fs.readFileSync(full));
    };

    app.get('/', async (_req, reply) => {
      const rows = manifest.forms
        .map((f) => `<li><a href="${f.origin === 'b' ? origins.b : origins.a}${f.route}">${f.id}</a> <small>(${f.ats}) ${f.title}</small></li>`)
        .join('\n');
      return reply.type('text/html; charset=utf-8').send(`<!doctype html><title>Bureau fixtures</title><h1>Bureau ATS fixtures (origin ${origin.toUpperCase()})</h1><ul>${rows}</ul>`);
    });

    for (const spec of manifest.forms) {
      app.get(spec.route, async (_req, reply) => sendFile(reply, spec.file, { FORM_ID: spec.id }));
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
      const sub = record({
        formId,
        ats: spec.ats,
        step,
        origin,
        method: req.method,
        path: req.url,
        contentType: String(req.headers['content-type'] ?? '').split(';')[0],
        fields: body.fields,
        files: body.files,
        session: (req.headers.cookie ?? '').match(/fx_session=([\w-]+)/)?.[1] ?? null,
        valid: v.valid,
        errors: v.errors,
        flags: v.flags,
        final,
      });
      const redirect = `/__confirm/${formId}?ref=${sub.seq}`;
      if (wantsJson(req)) return reply.status(v.valid ? 200 : 422).send({ ok: v.valid, errors: v.errors, redirect: v.valid && final ? redirect : null, ref: sub.seq });
      if (!v.valid) {
        const items = v.errors.map((e) => `<li>${e.replace(/[<>&"]/g, '')}</li>`).join('');
        return reply
          .status(422)
          .type('text/html; charset=utf-8')
          .send(`<!doctype html><title>Error</title><div role="alert" class="error-summary"><h1>There was a problem with your application</h1><ul>${items}</ul></div>`);
      }
      return reply.redirect(final ? redirect : String(req.headers.referer ?? '/'), 303);
    };
    app.post('/__submit/:formId', submit);
    app.post('/__submit/:formId/*', submit);

    app.get('/__confirm/:formId', async (req, reply) => {
      const spec = byId.get((req.params as { formId: string }).formId);
      if (!spec) return reply.status(404).send('Not found');
      if (spec.confirmationFile) return sendFile(reply, spec.confirmationFile, { FORM_ID: spec.id });
      return reply.type('text/html; charset=utf-8').send(`<!doctype html><title>Application received</title><main><h1>${spec.confirmationText}</h1></main>`);
    });

    app.get('/__fixture/health', async () => ({ ok: true, origin, forms: manifest.forms.length }));
    app.get('/__fixture/manifest', async () => manifest);
    app.get('/__fixture/submissions', async (req) => {
      const q = req.query as { formId?: string };
      return subs.filter((s) => !q.formId || s.formId === q.formId);
    });
    app.get('/__fixture/mail', async () => mails);
    app.post('/__fixture/reset', async () => {
      subs.length = 0;
      mails.length = 0;
      state.clear();
      return { ok: true };
    });

    for (const m of routeModules) await m.register(app, ctx);
    return app;
  }

  const appA = await build('a');
  const appB = await build('b');
  origins.a = (await appA.listen({ host: '127.0.0.1', port: opts.portA ?? 0 })).replace('localhost', '127.0.0.1');
  origins.b = (await appB.listen({ host: '127.0.0.1', port: opts.portB ?? 0 })).replace('localhost', '127.0.0.1');

  return {
    originA: origins.a,
    originB: origins.b,
    manifest,
    url: (idOrPath, origin) => {
      const spec = byId.get(idOrPath);
      if (spec) return `${(origin ?? spec.origin) === 'b' ? origins.b : origins.a}${spec.route}`;
      return `${origin === 'b' ? origins.b : origins.a}${idOrPath.startsWith('/') ? '' : '/'}${idOrPath}`;
    },
    form: (id) => {
      const spec = byId.get(id);
      if (!spec) throw new Error(`No fixture form ${id}`);
      return spec;
    },
    submissions: (f = {}) =>
      subs.filter((s) => (f.formId === undefined || s.formId === f.formId) && (f.final === undefined || s.final === f.final) && (f.valid === undefined || s.valid === f.valid)),
    mail: () => [...mails],
    reset: () => {
      subs.length = 0;
      mails.length = 0;
      state.clear();
    },
    close: async () => {
      await Promise.all([appA.close(), appB.close()]);
    },
  };
}

// CLI: npm run fixtures [-- --port N]
const invokedDirectly = !!process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) {
  const i = process.argv.indexOf('--port');
  const port = i > 0 ? Number(process.argv[i + 1]) : undefined;
  const fx = await startFixtureServer({ portA: port, portB: port ? port + 1 : undefined });
  console.log(`\n  Bureau fixture server\n  origin A: ${fx.originA}\n  origin B: ${fx.originB}\n`);
  for (const f of fx.manifest.forms) console.log(`  ${f.id.padEnd(30)} ${fx.url(f.id)}`);
  console.log('\n  GET /__fixture/submissions · GET /__fixture/mail · POST /__fixture/reset · Ctrl+C to stop\n');
  const stop = async () => {
    await fx.close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
