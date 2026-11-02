/**
 * Server side of the Teamtailor career-site replica (fixtures/ats/teamtailor).
 *
 *   POST /teamtailor-production.s3.eu-west-1.amazonaws.com/uploads   Dropzone direct upload (S3 POST policy style),
 *        answers 201 with an S3 <PostResponse><Location>…</Location></PostResponse>
 *   POST /saffronstudio.teamtailor.com/applications                  the form's real action (rails-ujs remote form, multipart)
 *
 * The final request carries the CV only as candidate[resume_remote_url]; the
 * upload behind that URL is attached to the recorded Submission under the same
 * key, so `file:cv` checks the PDF that was really dropped.
 */
import type { FastifyInstance } from 'fastify';
import type { FixtureRouteContext } from '../../fixture-server.ts';
import { finalize, storeUpload } from './_preupload.ts';

const S3 = '/teamtailor-production.s3.eu-west-1.amazonaws.com';
const FORM_ID = 'teamtailor-careersite';
const ACCEPT = /\.(docx?|pptx|pdf|pages|txt|rtf)$/i;

export function register(app: FastifyInstance, ctx: FixtureRouteContext): void {
  app.post(`${S3}/uploads`, async (req, reply) => {
    if (!req.isMultipart()) return reply.status(400).type('application/xml').send('<Error><Code>InvalidRequest</Code></Error>');
    const up = await storeUpload(ctx, req, FORM_ID);
    if (!up) return reply.status(400).type('application/xml').send('<Error><Code>MissingFile</Code></Error>');
    if (!ACCEPT.test(up.file.filename)) return reply.status(400).type('application/xml').send('<Error><Code>InvalidFileType</Code></Error>');
    const key = `uploads/${up.id}/${encodeURIComponent(up.file.filename)}`;
    const location = `https://teamtailor-production.s3.eu-west-1.amazonaws.com/${key}`;
    return reply
      .status(201)
      .type('application/xml')
      .send(`<?xml version="1.0" encoding="UTF-8"?><PostResponse><Location>${location}</Location><Bucket>teamtailor-production</Bucket><Key>${key}</Key><ETag>"${up.file.sha256.slice(0, 32)}"</ETag></PostResponse>`);
  });

  app.post('/saffronstudio.teamtailor.com/applications', async (req, reply) => {
    const body = await ctx.parseBody(req);
    const url = body.fields['candidate[resume_remote_url]']?.[0] ?? '';
    const id = /\/uploads\/([0-9a-f-]{36})\//.exec(url)?.[1] ?? (url ? 'unknown' : '');
    return finalize(ctx, req, reply, FORM_ID, body.fields, [{ key: 'candidate[resume_remote_url]', id }]);
  });
}
