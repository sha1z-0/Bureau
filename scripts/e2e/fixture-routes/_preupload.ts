/**
 * Shared helper (not a route module: it exports no `register`) for replicas
 * whose real ATS uploads documents first and then references them by id in
 * the final application request: Personio (/api/v1/documents → files[].uuid),
 * Teamtailor (Dropzone direct upload → candidate[resume_remote_url]),
 * BambooHR (resumeFileId / coverLetterFileId) and Breezy (resume upload →
 * candidate.resume.url).
 *
 * The upload endpoints keep the file's metadata in ctx.state (cleared by
 * reset()); the final endpoint resolves the references and records ONE final
 * Submission whose `files` carry the real uploads under the reference key, so
 * manifest rules like `file:cv` work exactly as for a multipart form.
 */
import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { FixtureRouteContext } from '../../fixture-server.ts';
import type { Submission, SubmittedFile } from '../expect.ts';

export interface StoredUpload {
  id: string;
  formId: string;
  file: SubmittedFile;
  uploadedAt: string;
}

function store(ctx: FixtureRouteContext): Map<string, StoredUpload> {
  let m = ctx.state.get('preuploads') as Map<string, StoredUpload> | undefined;
  if (!m) {
    m = new Map();
    ctx.state.set('preuploads', m);
  }
  return m;
}

/** Accept one multipart file, remember it, and record a non-final "upload" step. */
export async function storeUpload(
  ctx: FixtureRouteContext,
  req: FastifyRequest,
  formId: string,
  id: string = crypto.randomUUID(),
): Promise<StoredUpload | null> {
  const body = await ctx.parseBody(req);
  const f = body.files.find((x) => x.size > 0);
  if (!f) return null;
  const up: StoredUpload = { id, formId, file: f, uploadedAt: new Date().toISOString() };
  store(ctx).set(id, up);
  ctx.record({
    formId,
    ats: ctx.manifest.forms.find((s) => s.id === formId)?.ats ?? 'other',
    step: 'upload',
    origin: ctx.origin,
    method: req.method,
    path: req.url,
    contentType: String(req.headers['content-type'] ?? '').split(';')[0],
    fields: body.fields,
    files: [f],
    session: null,
    valid: true,
    errors: [],
    flags: [],
    final: false,
  });
  return up;
}

export function getUpload(ctx: FixtureRouteContext, id: string): StoredUpload | undefined {
  return store(ctx).get(id);
}

/**
 * Flatten a JSON value the way Rails/qs would name it, keeping array indices
 * for arrays of objects (a[0][b]) and repeating the key for arrays of scalars.
 */
export function flattenJson(v: unknown, prefix: string, out: Record<string, string[]> = {}): Record<string, string[]> {
  if (v === undefined || v === null) return out;
  if (Array.isArray(v)) {
    v.forEach((x, i) => {
      if (x !== null && typeof x === 'object') flattenJson(x, `${prefix}[${i}]`, out);
      else flattenJson(x, prefix, out);
    });
    return out;
  }
  if (typeof v === 'object') {
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) flattenJson(x, prefix ? `${prefix}[${k}]` : k, out);
    return out;
  }
  (out[prefix] ??= []).push(String(v));
  return out;
}

/**
 * Validate and record the final application. `fileRefs` maps a submission key
 * (e.g. `resumeFileId`) to the upload id the page sent; each resolved upload is
 * attached as a file under that key. Unknown ids make the submission invalid.
 * Replies with the generic fixture verdict ({ ok, errors, redirect, ref }) unless
 * `respond` builds an ATS-shaped body.
 */
export function finalize(
  ctx: FixtureRouteContext,
  req: FastifyRequest,
  reply: FastifyReply,
  formId: string,
  fields: Record<string, string[]>,
  fileRefs: { key: string; id: string }[],
  respond?: (sub: Submission) => { status: number; body: unknown },
): FastifyReply {
  const spec = ctx.manifest.forms.find((s) => s.id === formId);
  if (!spec) return reply.status(404).send({ ok: false, error: 'unknown form' });
  const files: SubmittedFile[] = [];
  const refErrors: string[] = [];
  for (const r of fileRefs) {
    if (!r.id) continue;
    const up = store(ctx).get(r.id);
    if (!up || up.formId !== formId) refErrors.push(`${r.key} references an unknown upload`);
    else files.push({ ...up.file, field: r.key });
  }
  const v = ctx.validate(spec, { fields, files });
  const errors = [...v.errors, ...refErrors];
  const sub = ctx.record({
    formId,
    ats: spec.ats,
    step: '',
    origin: ctx.origin,
    method: req.method,
    path: req.url,
    contentType: String(req.headers['content-type'] ?? '').split(';')[0],
    fields,
    files,
    session: null,
    valid: v.valid && refErrors.length === 0,
    errors,
    flags: v.flags,
    final: true,
  });
  if (respond) {
    const r = respond(sub);
    return reply.status(r.status).send(r.body);
  }
  return reply
    .status(sub.valid ? 200 : 422)
    .send({ ok: sub.valid, errors, redirect: sub.valid ? `/__confirm/${formId}?ref=${sub.seq}` : null, ref: sub.seq });
}
