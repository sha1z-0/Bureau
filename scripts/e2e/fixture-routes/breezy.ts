/**
 * Server side of the Breezy HR portal replica (fixtures/ats/breezy).
 *
 *   POST /pebble-analytics.breezy.hr/api/portal/pebble-analytics/upload   resume upload ($upload, multipart "file")
 *        -> { file_name, url, ... }   (the portal stores this object as candidate.resume)
 *   POST /pebble-analytics.breezy.hr/api/apply/6f1c2e9a8b7d               PortalClient.apply(positionId, candidate) JSON
 *
 * The candidate JSON is recorded with Rails-style keys (name, address_details[city],
 * questionnaire[0][response], ...). For checkbox questions, whose `responses` is a
 * per-option boolean array, a derived `questionnaire[i][selected]` key lists the
 * ticked option texts so expectations can name them. The resume behind
 * candidate.resume.url is attached under the key `resume`.
 */
import type { FastifyInstance } from 'fastify';
import type { FixtureRouteContext } from '../../fixture-server.ts';
import { finalize, flattenJson, storeUpload } from './_preupload.ts';

const HOST = '/pebble-analytics.breezy.hr';
const FORM_ID = 'breezy-portal';

interface Question {
  type?: { id?: string };
  options?: { text?: string }[];
  responses?: unknown[];
}

export function register(app: FastifyInstance, ctx: FixtureRouteContext): void {
  app.post(`${HOST}/api/portal/pebble-analytics/upload`, async (req, reply) => {
    if (!req.isMultipart()) return reply.status(400).send({ error: 'bad_request' });
    const up = await storeUpload(ctx, req, FORM_ID);
    if (!up) return reply.status(400).send({ error: 'no_file' });
    if (!/\.(pdf|docx?|txt|rtd|rtf|pages)$/i.test(up.file.filename)) return reply.status(400).send({ error: 'invalid_file_type' });
    return reply.send({
      file_name: up.file.filename,
      url: `https://breezy-portal-uploads.s3.amazonaws.com/uploads/${up.id}/${encodeURIComponent(up.file.filename)}`,
      size: up.file.size,
      content_type: up.file.mime,
      uploaded_at: new Date().toISOString(),
    });
  });

  app.post(`${HOST}/api/apply/6f1c2e9a8b7d`, async (req, reply) => {
    const cand = (req.body ?? {}) as Record<string, unknown>;
    const fields = flattenJson(cand, '');
    const qs = Array.isArray(cand.questionnaire) ? (cand.questionnaire as Question[]) : [];
    qs.forEach((q, i) => {
      if (q?.type?.id !== 'checkboxes' || !Array.isArray(q.responses)) return;
      fields[`questionnaire[${i}][selected]`] = (q.options ?? []).filter((_o, j) => q.responses?.[j] === true).map((o) => String(o.text ?? ''));
    });
    const resume = (cand.resume ?? {}) as { url?: string };
    const id = /\/uploads\/([0-9a-f-]{36})\//.exec(resume.url ?? '')?.[1] ?? (resume.url ? 'unknown' : '');
    return finalize(ctx, req, reply, FORM_ID, fields, [{ key: 'resume', id }], (sub) =>
      sub.valid ? { status: 200, body: { _id: `c${sub.seq}a9f2e1`, state: 'applied' } } : { status: 400, body: { error: { type: 'invalid', message: sub.errors.join('; ') } } },
    );
  });
}
