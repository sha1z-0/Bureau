/**
 * Server side of the Personio job-page replica (fixtures/ats/personio).
 *
 * Mirrors the endpoints the current personio-jobs Next.js app calls, under the
 * tenant host segment:
 *   POST /kranich.jobs.personio.de/api/v1/documents                 one file per request (FormData "file")
 *        -> { uuid, original_filename, extension, mimetype, size }
 *   POST /kranich.jobs.personio.de/api/v1/jobs/1458822/application  JSON with Idempotency-Key header:
 *        { attributes: [{ id, value }], files: [{ uuid, ..., category }], email, idempotencyToken, ... }
 *
 * The final request is recorded as one Submission whose fields are keyed by the
 * attribute id (first_name, salary_expectations, custom_attribute_<id>, ...) and
 * whose files sit under `documents.<category>` (documents.cv, documents.cover_letter).
 */
import type { FastifyInstance } from 'fastify';
import type { FixtureRouteContext } from '../../fixture-server.ts';
import { finalize, flattenJson, storeUpload } from './_preupload.ts';

const HOST = '/kranich.jobs.personio.de';
const JOB_ID = '1458822';
const FORM_ID = 'personio-job';
const ALLOWED = /\.(pdf|docx?|png|jpe?g|txt|odt|ods|xlsx?|rtf|pptx?|gif|tiff?|bmp|csv|rar|gz|zip|7z|mp4|3gp|mov|avi|wmv)$/i;

interface Body {
  attributes?: { id?: unknown; value?: unknown }[];
  files?: { uuid?: unknown; category?: unknown }[];
  email?: unknown;
  idempotencyToken?: unknown;
  [k: string]: unknown;
}

export function register(app: FastifyInstance, ctx: FixtureRouteContext): void {
  const seen = new Set<string>();

  app.post(`${HOST}/api/v1/documents`, async (req, reply) => {
    if (!req.isMultipart()) return reply.status(400).send({ errors: [{ code: 'invalid_request' }] });
    const up = await storeUpload(ctx, req, FORM_ID);
    if (!up) return reply.status(400).send({ errors: [{ code: 'file_missing' }] });
    if (!ALLOWED.test(up.file.filename)) return reply.status(415).send({ errors: [{ code: 'file_type_not_allowed' }] });
    if (up.file.size > 20 * 1024 * 1024) return reply.status(413).send({ errors: [{ code: 'file_too_large' }] });
    const ext = (up.file.filename.split('.').pop() ?? '').toLowerCase();
    return reply.status(201).send({ uuid: up.id, original_filename: up.file.filename, extension: ext, mimetype: up.file.mime, size: up.file.size });
  });

  app.post(`${HOST}/api/v1/jobs/${JOB_ID}/application`, async (req, reply) => {
    const body = (req.body ?? {}) as Body;
    const key = String(req.headers['idempotency-key'] ?? '');
    if (!key || key !== String(body.idempotencyToken ?? '')) return reply.status(400).send({ errors: [{ field: 'idempotencyToken', code: 'missing_idempotency_key' }] });
    if (seen.has(key)) return reply.status(409).send({ errors: [{ code: 'duplicate_request' }] });
    seen.add(key);

    const fields: Record<string, string[]> = {};
    for (const a of body.attributes ?? []) {
      if (typeof a?.id !== 'string') continue;
      (fields[a.id] ??= []).push(String(a.value ?? ''));
    }
    // Everything else (email, channelId, sender, cf-turnstile-response ...) keeps its JSON path.
    const rest: Record<string, unknown> = { ...body };
    delete rest.attributes;
    delete rest.files;
    flattenJson(rest, '', fields);
    const files = (body.files ?? []).map((f) => ({ key: `documents.${String(f?.category ?? 'other')}`, id: String(f?.uuid ?? '') }));
    return finalize(ctx, req, reply, FORM_ID, fields, files, (sub) =>
      sub.valid
        ? { status: 201, body: { id: 90000000 + sub.seq, status: 'received' } }
        : { status: 422, body: { errors: sub.errors.map((e) => ({ field: e.split(' ')[0], code: 'invalid', message: e })) } },
    );
  });
}
