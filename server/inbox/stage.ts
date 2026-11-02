import { ApplicationStage, type InboxClass } from '../contracts/inbox.ts';
import { get, logEvent, now, run } from '../db.ts';
import { AppError } from '../errors.ts';
import { emit } from '../services/bus.ts';

/**
 * Application stages (applied → screening → interview → offer / rejected) and
 * the `outcomes` rows the writer's bandit learns from. Replies only ever move
 * an application forward; the owner can set any stage by hand.
 */

export const STAGE_RANK: Record<ApplicationStage, number> = { applied: 0, screening: 1, interview: 2, offer: 3, rejected: 4 };

export function targetStage(cls: InboxClass): ApplicationStage | null {
  switch (cls) {
    case 'recruiter_question':
    case 'assessment':
      return 'screening';
    case 'interview_invite':
      return 'interview';
    case 'offer':
      return 'offer';
    case 'rejection':
      return 'rejected';
    case 'confirmation_received':
      return 'applied';
    default:
      return null;
  }
}

/** The v1 jobs.stage column the Pipeline page reads (it has no "screening"). */
const JOB_STAGE: Partial<Record<ApplicationStage, string>> = { interview: 'interview', offer: 'offer', rejected: 'rejected' };

function currentStage(appId: string): { stage: ApplicationStage; jobId: string } {
  const row = get<{ stage: string | null; job_id: string }>('SELECT stage, job_id FROM applications WHERE id = ?', appId);
  if (!row) throw new AppError(404, 'NOT_FOUND', 'No such application');
  const parsed = ApplicationStage.safeParse(row.stage ?? 'applied');
  return { stage: parsed.success ? parsed.data : 'applied', jobId: row.job_id };
}

function write(appId: string, jobId: string, to: ApplicationStage) {
  run('UPDATE applications SET stage = ?, updated_at = ? WHERE id = ?', to, now(), appId);
  const js = JOB_STAGE[to];
  if (js) run('UPDATE jobs SET stage = ?, updated_at = ? WHERE id = ?', js, now(), jobId);
}

export interface StageChange {
  from: ApplicationStage;
  to: ApplicationStage;
  changed: boolean;
  reason: string;
}

/**
 * Move an application because of a reply. Forward only. A rejection never
 * overrides an offer (that needs the owner), and once rejected only the owner
 * moves it again.
 */
export function advanceStage(appId: string, cls: InboxClass, confidence: number): StageChange {
  const { stage: from, jobId } = currentStage(appId);
  const to = targetStage(cls);
  const same = { from, to: from, changed: false };
  if (!to) return { ...same, reason: 'no stage for this class' };
  const needed = to === 'rejected' ? 0.75 : 0.6;
  if (confidence < needed) return { ...same, reason: `confidence ${confidence.toFixed(2)} below ${needed}` };
  if (from === 'rejected') return { ...same, reason: 'already rejected; only the owner moves it now' };
  if (to === 'rejected' && from === 'offer') return { ...same, reason: 'a rejection after an offer needs the owner' };
  if (STAGE_RANK[to] <= STAGE_RANK[from]) return { ...same, reason: 'not a step forward' };
  write(appId, jobId, to);
  logEvent('inbox', `Application stage ${from} → ${to} (${cls.replace('_', ' ')})`, jobId);
  return { from, to, changed: true, reason: cls };
}

/** The owner sets a stage by hand (any direction). */
export function setStageManually(appId: string, to: ApplicationStage): StageChange {
  const { stage: from, jobId } = currentStage(appId);
  if (from !== to) {
    write(appId, jobId, to);
    if (to === 'applied' || to === 'screening') run("UPDATE jobs SET stage = 'applied', updated_at = ? WHERE id = ?", now(), jobId);
    logEvent('inbox', `Application stage set to ${to} by the owner`, jobId);
  }
  return { from, to, changed: from !== to, reason: 'owner' };
}

/** Classes that are a human reply (a confirmation or verification is not). */
export const REPLY_CLASSES: readonly InboxClass[] = ['rejection', 'interview_invite', 'assessment', 'recruiter_question', 'offer'];
/** For the bandit: the furthest a reply went. */
const REPLY_RANK: Partial<Record<InboxClass, number>> = { rejection: 1, recruiter_question: 2, assessment: 3, interview_invite: 4, offer: 5 };

/**
 * Upsert the `outcomes` row: replied, the most advanced reply class so far and
 * days from sending to the FIRST reply. A04's bandit reads this table.
 */
export function recordOutcome(appId: string, cls: InboxClass, receivedAt: string): boolean {
  if (!REPLY_CLASSES.includes(cls)) return false;
  const app = get<{ sent_at: string | null; created_at: string; job_id: string }>('SELECT sent_at, created_at, job_id FROM applications WHERE id = ?', appId);
  if (!app) return false;
  const start = Date.parse(app.sent_at ?? app.created_at);
  const days = Number.isFinite(start) ? Math.max(0, Math.round(((Date.parse(receivedAt) - start) / 86_400_000) * 10) / 10) : null;
  const cur = get<{ replied: number; reply_class: string | null; days_to_reply: number | null }>('SELECT replied, reply_class, days_to_reply FROM outcomes WHERE application_id = ?', appId);
  const keepClass = cur?.reply_class && (REPLY_RANK[cur.reply_class as InboxClass] ?? 0) > (REPLY_RANK[cls] ?? 0) ? cur.reply_class : cls;
  const firstDays = cur?.replied && cur.days_to_reply != null ? Math.min(cur.days_to_reply, days ?? Infinity) : days;
  run(
    `INSERT INTO outcomes (application_id, replied, reply_class, days_to_reply, updated_at) VALUES (?, 1, ?, ?, ?)
     ON CONFLICT(application_id) DO UPDATE SET replied = 1, reply_class = excluded.reply_class, days_to_reply = excluded.days_to_reply, updated_at = excluded.updated_at`,
    appId,
    keepClass,
    firstDays === Infinity ? null : firstDays,
    now(),
  );
  emit({ type: 'application.outcome', applicationId: appId, jobId: app.job_id, outcome: cls });
  return true;
}

/**
 * Silence is an outcome too: applications sent `afterDays` ago with no reply
 * get a `replied = 0` row, so the bandit can count misses. A later reply flips it.
 */
export function recordSilence(afterDays = 21, nowMs = Date.now()): number {
  const cutoff = new Date(nowMs - afterDays * 86_400_000).toISOString();
  const res = run(
    `INSERT INTO outcomes (application_id, replied, reply_class, days_to_reply, updated_at)
     SELECT a.id, 0, NULL, NULL, ? FROM applications a
      WHERE a.sent_at IS NOT NULL AND a.sent_at <= ? AND a.status IN ('sent', 'submitted')
        AND NOT EXISTS (SELECT 1 FROM outcomes o WHERE o.application_id = a.id)`,
    new Date(nowMs).toISOString(),
    cutoff,
  );
  return Number(res.changes);
}
