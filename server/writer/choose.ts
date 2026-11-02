import { get, now, run, tx } from '../db.ts';
import { AppError } from '../errors.ts';
import { fingerprintOf } from '../profile/index.ts';
import { defaultWriterAi, type WriterAi } from './ai.ts';
import { loadContext } from './context.ts';
import { CRITIC_BAR } from './critic.ts';
import { lintLetter } from './lint.ts';
import { truthLock } from './lock.ts';
import { loadVariants, readNotes, renderPacketFiles } from './packet.ts';
import { truthResult } from './truth.ts';

/**
 * Switch a written application to another of its variants (studio). The same
 * gates apply: the variant must have critic ≥ 8, pass the lint now, and pass
 * the full truth lock (code + auditor). Otherwise nothing changes.
 */
export async function chooseVariant(applicationId: string, variantId: string, ai: WriterAi = defaultWriterAi) {
  const row = get<{ id: string; job_id: string; subject: string; message: string; notes: string; cv: string; status: string }>(
    'SELECT id, job_id, subject, message, notes, cv, status FROM applications WHERE id = ?',
    applicationId,
  );
  if (!row) throw new AppError(404, 'NOT_FOUND', 'Application not found');
  if (['sent', 'submitted'].includes(row.status)) throw new AppError(409, 'ALREADY_SENT', 'This application has already gone out.');
  const notes = readNotes(row.notes);
  const w = notes.writer;
  if (!w || w.status !== 'written' || !w.quality) throw new AppError(409, 'NOT_WRITTEN', 'Only a written application can switch letters.');
  const variants = loadVariants(applicationId);
  const v = variants.find((x) => x.id === variantId);
  if (!v) throw new AppError(404, 'NOT_FOUND', 'No such variant on this application');
  if (v.chosen) return { changed: false, variant: v };
  if (!v.critic || v.critic.score < CRITIC_BAR) throw new AppError(422, 'GATE_CRITIC', `That letter scored ${v.critic?.score ?? 0}/10; the bar is ${CRITIC_BAR}.`);

  const ctx = await loadContext(row.job_id, { brief: null });
  const fp = ctx.master.style ?? fingerprintOf(ctx.master.voiceBank.map((p) => p.text));
  const lint = lintLetter(v.text, {
    fingerprint: fp,
    voice: ctx.master.voiceBank.map((p) => ({ id: p.id, text: p.text })),
    passagesUsed: v.passagesUsed,
    company: ctx.job.company,
    role: ctx.job.title,
    specifics: [...(w.evidence?.hooks.map((h) => h.text) ?? []), ...(w.evidence?.mustWins ?? [])],
  });
  if (!lint.pass) throw new AppError(422, 'GATE_LINT', `That letter fails the lint: ${lint.checks.filter((c) => !c.pass).map((c) => c.id).join(', ')}.`);
  let cv = null;
  try {
    cv = JSON.parse(row.cv);
  } catch {
    cv = null;
  }
  const issues = await truthLock(
    ctx,
    ai,
    'audit_choose',
    { letter: v.text, subject: row.subject, outreach: row.message, followUp: w.followUp, shortAnswers: Object.entries(w.shortAnswers).map(([key, answer]) => ({ key, answer })) },
    cv,
    w.evidence,
  );
  const truth = truthResult(issues);
  if (!truth.pass) throw new AppError(422, 'GATE_TRUTH', `The truth lock flags that letter: ${issues.filter((i) => i.severity === 'high').map((i) => i.claim).join('; ')}.`);

  const writer = { ...w, strategy: v.strategy, quality: { critic: v.critic, lint, truth } };
  tx(() => {
    run('UPDATE letter_variants SET chosen = CASE WHEN id = ? THEN 1 ELSE 0 END, lint = CASE WHEN id = ? THEN ? ELSE lint END WHERE application_id = ?', v.id, v.id, JSON.stringify(lint), applicationId);
    run('UPDATE applications SET cover_letter = ?, variant_id = ?, notes = ?, updated_at = ? WHERE id = ?', v.text, v.id, JSON.stringify({ ...notes, writer }), now(), applicationId);
  });
  if (cv) {
    const paths = await renderPacketFiles(applicationId, cv, v.text, /\b(US|USA|United States|Canada)\b/i.test(ctx.master.location) ? 'LETTER' : 'A4');
    run('UPDATE applications SET notes = ? WHERE id = ?', JSON.stringify({ ...notes, writer: { ...writer, ...paths } }), applicationId);
  }
  return { changed: true, variant: { ...v, chosen: true, lint } };
}
