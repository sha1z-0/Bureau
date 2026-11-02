/**
 * Server side of the BambooHR careers replica (fixtures/ats/bamboohr).
 *
 *   POST /copperline.bamboohr.com/careers/upload-file   multipart "file" -> { fileId, fileName, size }
 *   POST /copperline.bamboohr.com/careers/88/apply      JSON application; resumeFileId / coverLetterFileId
 *                                                       reference earlier uploads
 *
 * The recorded Submission carries the uploads as files under resumeFileId /
 * coverLetterFileId, so `file:cv` / `file:letter` work.
 */
import type { FastifyInstance } from 'fastify';
import type { FixtureRouteContext } from '../../fixture-server.ts';
import { finalize, flattenJson, getUpload, storeUpload } from './_preupload.ts';

const HOST = '/copperline.bamboohr.com';
const FORM_ID = 'bamboohr-careers';

export function register(app: FastifyInstance, ctx: FixtureRouteContext): void {
  let nextFileId = 4815160;

  app.post(`${HOST}/careers/upload-file`, async (req, reply) => {
    if (!req.isMultipart()) return reply.status(400).send({ success: false, error: 'Expected multipart/form-data' });
    const up = await storeUpload(ctx, req, FORM_ID, String(nextFileId++));
    if (!up) return reply.status(400).send({ success: false, error: 'No file received' });
    if (!/\.(pdf|docx?|odt|rtf|txt)$/i.test(up.file.filename)) return reply.status(400).send({ success: false, error: 'Unsupported file type' });
    return reply.send({ success: true, fileId: Number(up.id), fileName: up.file.filename, size: up.file.size });
  });

  app.post(`${HOST}/careers/88/apply`, async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const fields = flattenJson(body, '');
    const ref = (k: string) => {
      const id = body[k] == null ? '' : String(body[k]);
      return { key: k, id: id && getUpload(ctx, id) ? id : id ? 'unknown' : '' };
    };
    return finalize(ctx, req, reply, FORM_ID, fields, [ref('resumeFileId'), ref('coverLetterFileId')], (sub) =>
      sub.valid
        ? { status: 200, body: { success: true, redirect: `/__confirm/${FORM_ID}?ref=${sub.seq}` } }
        : { status: 400, body: { success: false, errors: sub.errors } },
    );
  });
}
