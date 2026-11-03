import crypto from 'node:crypto';
import { pipelineState, transition } from '../campaign/pipeline.ts';
import type { PipelineState } from '../contracts/campaign.ts';
import type { ResearchBrief } from '../contracts/research.ts';
import type { CriticResult, EvidenceMap, LetterStrategy, LintResult, TruthResult, WriteResult } from '../contracts/writer.ts';
import { logEvent, now, run } from '../db.ts';
import { AppError } from '../errors.ts';
import { fingerprintOf } from '../profile/index.ts';
import { emit } from '../services/bus.ts';
import { REPLAY } from '../ai/claude.ts';
import { defaultWriterAi, type WriterAi } from './ai.ts';
import { lintAnswer, writeShortAnswers } from './answers.ts';
import { LENGTH_ARMS, pickLength, pickStrategies, pickStrategy, type LengthArm } from './bandit.ts';
import { loadContext, type WriterContext } from './context.ts';
import { cachedBrief } from '../research/index.ts';
import { get } from '../db.ts';
import { cachedRoleCv, ROLE_CV_INSTRUCTIONS, roleKey, saveRoleCv } from './roleCv.ts';
import { CRITIC_BAR, critique } from './critic.ts';
import { fitToPage, fixCv, sanitizeCv, writeCv } from './cv.ts';
import type { TailoredCv } from './cvSchema.ts';
import { buildEvidence } from './evidence.ts';
import { humanizePass, humanizeTargets } from './humanize.ts';
import { fixTexts, reviseLetters, subjectProblems, writeLetters, type FixOut, type LetterDraft } from './letters.ts';
import { letterNeed, type LetterNeed } from './letterNeed.ts';
import { lintLetter, lintShort, type LintContext } from './lint.ts';
import { loadPacket, renderPacketFiles, saveApplication, setPacketPaths, type AuditIssueV1, type VariantRecord, type WriterNotes, type WriterStep } from './packet.ts';
import { truthLock } from './lock.ts';
import { truthResult, type CodeIssue } from './truth.ts';
import { seededRng } from './text.ts';

/**
 * writeApplication: decode → research → evidence map → CV → three letters →
 * critic (demands applied once, re-scored) → choose (bandit) → humanize →
 * lint (one targeted rewrite) → short answers, outreach, follow-up → truth
 * lock (code + auditor; one rewrite) → final gates → persist → PDFs.
 *
 * The gates are enforced here, in code, on the exact text that is saved:
 * critic ≥ 8, a lint pass and a clean truth lock, or the job is skipped with
 * the reason. The pipeline moves selected → writing → written | skipped
 * through transition(), never by writing the pipeline table.
 */

/** The bandit's seed when replaying recordings and no rng is given (e2e, API, autopilot). */
export const REPLAY_SEED = 1;

export interface WriteOptions {
  ai?: WriterAi;
  /** Seeded in tests and recordings; Math.random in production; REPLAY_SEED in replay mode. */
  rng?: () => number;
  /** The owner's notes for this draft (studio "rewrite with notes"). */
  instructions?: string;
  /** Inject the research (tests); otherwise researchForJob(jobId). */
  brief?: ResearchBrief | null;
  research?: (jobId: string) => Promise<ResearchBrief>;
  /** Studio / v1 path: allowed for jobs that never entered a campaign pipeline. */
  manual?: boolean;
  /**
   * volume: one letter, no critic, one CV per role (reused), research only if cached, the free
   * code truth check without the paid auditor. quality (default): two drafts, critic (bar 5),
   * one revision, the full truth lock.
   */
  mode?: 'volume' | 'quality';
  /** The campaign's roles: volume mode keys its reused CVs on them. */
  roles?: string[];
  /**
   * always (default): write a cover letter for every job, as before. auto: skip the letter (and the
   * subject, outreach and follow-up written with it) when it is known before writing that the form
   * has no cover-letter field; see letterNeed.ts. The CV and short answers are written either way.
   */
  letter?: 'always' | 'auto';
}

export interface WriteRun {
  result: WriteResult;
  applicationId: string | null;
}


/** The lint result a packet without a letter carries: nothing to lint, and why. */
export function noLetterLint(need: LetterNeed): LintResult {
  return { pass: true, checks: [{ id: 'letter_not_needed', pass: true, value: 'no letter', target: need.reason.slice(0, 300) }] };
}

const RETRYABLE = new Set(['BUDGET', 'AI_RATE', 'AI_OFFLINE', 'AI_ERROR', 'AI_TRUNCATED', 'AI_PARSE']);
const WRITABLE_FROM: PipelineState[] = ['selected', 'writing'];
const REQUEUE_FROM: PipelineState[] = ['written', 'rehearsed', 'needs_you', 'failed', 'skipped'];

class Skip extends Error {
  constructor(public reason: string) {
    super(reason);
  }
}

const inflight = new Map<string, Promise<WriteRun>>();

export function writeApplicationRun(jobId: string, campaignId: string | null, opts: WriteOptions = {}): Promise<WriteRun> {
  const pending = inflight.get(jobId);
  if (pending) return pending;
  const p = run_(jobId, campaignId, opts).finally(() => inflight.delete(jobId));
  inflight.set(jobId, p);
  return p;
}

/** Enter `writing` through the state machine. Returns whether this job is tracked by the pipeline. */
function enterWriting(jobId: string, campaignId: string | null, manual: boolean): boolean {
  const row = pipelineState(jobId);
  if (!row) {
    if (manual) return false;
    throw new AppError(409, 'NOT_SELECTED', `Job ${jobId} is not in the pipeline; the matcher selects jobs before the writer runs.`);
  }
  if (['filling', 'verified', 'submitted'].includes(row.state)) throw new AppError(409, 'IN_FLIGHT', `Job ${jobId} is ${row.state}; it can't be rewritten now.`);
  if (REQUEUE_FROM.includes(row.state)) transition(jobId, 'selected', { campaignId, reason: 'writer: regenerate' });
  else if (!WRITABLE_FROM.includes(row.state)) {
    if (manual) return false;
    throw new AppError(409, 'NOT_SELECTED', `Job ${jobId} is ${row.state}; only selected jobs are written.`);
  }
  transition(jobId, 'writing', { campaignId, reason: 'writer: started' });
  return true;
}

function paperFor(location: string): 'A4' | 'LETTER' {
  return /\b(US|USA|United States|Canada)\b/i.test(location) ? 'LETTER' : 'A4';
}

async function run_(jobId: string, campaignId: string | null, opts: WriteOptions): Promise<WriteRun> {
  const ai = opts.ai ?? defaultWriterAi;
  // Replay mode must be deterministic (the bandit's picks change the prompts), so it gets a fixed seed.
  const rng = opts.rng ?? (REPLAY ? seededRng(REPLAY_SEED) : Math.random);
  const mode = opts.mode ?? 'quality';
  const volume = mode === 'volume';
  const tracked = enterWriting(jobId, campaignId, !!opts.manual);
  const steps: WriterStep[] = [];
  const step = (name: string, detail: string) => steps.push({ step: name, at: now(), detail });

  // Working state, persisted on skip too, so the quality report shows how far each job got.
  let ctx: WriterContext | null = null;
  let evidence: EvidenceMap | null = null;
  let evidenceAdjustments: string[] = [];
  let fastLearning: string | null = null;
  let cv: TailoredCv | null = null;
  let cvChanges: string[] = [];
  let emphasis: string[] = [];
  let keywords: string[] = [];
  let lengthArm: LengthArm | null = null;
  let explored = false;
  let subjects: string[] = [];
  let subjectIndex = 0;
  let outreach = '';
  let followUp = '';
  let shortAnswers: Record<string, string> = {};
  const variants = new Map<LetterStrategy, VariantRecord>();
  let chosen: VariantRecord | null = null;
  let finalLint: LintResult | null = null;
  let finalTruth: TruthResult | null = null;
  let finalCritic: CriticResult | null = null;
  let truthIssues: CodeIssue[] = [];
  // Set when the letter is skipped because the form has no field for one (opt-in, letter: 'auto').
  let noLetter: LetterNeed | null = null;

  const persist = async (status: 'written' | 'skipped', reason: string | null): Promise<string> => {
    const job = ctx?.job;
    const writer: WriterNotes = {
      version: 1,
      campaignId,
      mode,
      status,
      skipped: reason,
      strategy: chosen?.strategy ?? null,
      lengthArm,
      explored,
      evidence,
      evidenceAdjustments,
      fastLearning,
      subjects,
      subjectIndex,
      shortAnswers,
      outreach,
      followUp,
      quality: status === 'written' && (finalCritic || volume || noLetter) && finalLint && finalTruth ? { critic: finalCritic, lint: finalLint, truth: finalTruth } : null,
      cvPdfPath: '',
      letterPdfPath: '',
      cvPages: 0,
      cvChanges,
      steps,
      ...(noLetter ? { letter: { needed: false, reason: noLetter.reason, source: noLetter.source } } : {}),
    };
    const issues: AuditIssueV1[] = truthIssues.map((i) => ({ claim: i.claim, reason: i.reason, severity: i.severity, origin: i.origin }));
    if (status === 'skipped' && reason) issues.unshift({ claim: 'Quality gate', reason: `Skipped: ${reason}`, severity: 'high', origin: 'code' });
    const id = saveApplication({
      jobId,
      campaignId,
      status: status === 'written' ? 'draft' : 'skipped',
      subject: subjects[subjectIndex] ?? '',
      coverLetter: chosen?.text ?? '',
      outreach,
      cv,
      keywords,
      emphasis,
      issues,
      writer,
      variants: [...variants.values()],
      channel: job?.apply_email ? 'email' : 'ats',
      toEmail: job?.apply_email ?? null,
    });
    if (status === 'written' && cv && (chosen || noLetter) && ctx) {
      const paths = await renderPacketFiles(id, cv, chosen?.text ?? null, paperFor(ctx.master.location));
      setPacketPaths(id, paths);
    }
    return id;
  };

  try {
    // 0. Context and the voice bank the letters are built from.
    // Volume mode never pays for a web search: it uses a brief already on file for the company, or the posting alone.
    const company = get<{ company: string }>('SELECT company FROM jobs WHERE id = ?', jobId)?.company ?? '';
    const brief = opts.brief !== undefined ? opts.brief : volume ? cachedBrief(company) : undefined;
    ctx = await loadContext(jobId, { ...(brief !== undefined ? { brief } : {}), research: opts.research });
    step('context', `${ctx.master.facts.length} facts, ${ctx.master.voiceBank.length} voice passages, research ${ctx.brief ? 'loaded' : 'unavailable'}`);
    if (ctx.master.voiceBank.length < 2) throw new Skip('the voice bank needs at least two passages: letters are built by editing your own writing');
    const fingerprint = ctx.master.style ?? fingerprintOf(ctx.master.voiceBank.map((v) => v.text));
    const voice = ctx.master.voiceBank.map((v) => ({ id: v.id, text: v.text }));

    // 1–3. Decode, hooks, evidence map.
    const ev = await buildEvidence(ctx, ai, opts.instructions ?? '');
    evidence = ev.map;
    evidenceAdjustments = ev.adjustments;
    fastLearning = ev.fastLearning;
    const framings = evidence.items.reduce<Record<string, number>>((a, i) => ((a[i.framing] = (a[i.framing] ?? 0) + 1), a), {});
    step('evidence', `${evidence.items.length} requirements (${Object.entries(framings).map(([k, v]) => `${v} ${k}`).join(', ')}), ${evidence.hooks.length} hook(s)`);

    // 4. CV.
    let cvOut;
    let cvReused = '';
    if (volume) {
      const key = roleKey(ctx.job.title, opts.roles ?? []);
      const hit = cachedRoleCv(key, ctx);
      if (hit) {
        cvOut = hit;
        cvReused = key;
      } else {
        cvOut = await writeCv(ctx, evidence, ai, [ROLE_CV_INSTRUCTIONS, opts.instructions ?? ''].filter(Boolean).join('\n'));
        saveRoleCv(key, ctx, cvOut, jobId);
      }
    } else cvOut = await writeCv(ctx, evidence, ai, opts.instructions ?? '');
    const clean = sanitizeCv(cvOut.cv, ctx, evidence);
    const fitted = await fitToPage(clean.cv, ctx.master.yearsExperience, paperFor(ctx.master.location));
    cv = fitted.cv;
    cvChanges = [...clean.changes, ...fitted.trimmed];
    emphasis = cvOut.emphasis;
    keywords = cvOut.keywordsUsed;
    step('cv', `${cvReused ? `reused the ${cvReused} CV, ` : ''}${fitted.pages} page(s)${cvChanges.length ? `; ${cvChanges.length} code correction(s)` : ''}`);

    // 5. Letters, subject lines, outreach and follow-up: skipped only when the form is known to have no letter field.
    if (opts.letter === 'auto') {
      const need = await letterNeed(jobId);
      step('letter_need', `${need.needed ? 'write' : 'skip'}: ${need.reason}`);
      if (!need.needed) noLetter = need;
    }
    let lint: LintResult;
    let passagesUsed: string[] = [];
    let scoredText = '';
    let lintCtxFor: ((passagesUsed: string[]) => LintContext) | null = null;
    if (!noLetter) {
    const lengthPick = pickLength(rng);
    lengthArm = lengthPick.choice;
    const band = { arm: lengthArm, ...LENGTH_ARMS[lengthArm] };
    const strategies = pickStrategies(volume ? 1 : 2, rng);
    const lettersOut = await writeLetters(ctx, evidence, band, ai, { instructions: opts.instructions, fastLearning, strategies });
    subjects = lettersOut.subjects.map((s) => s.trim()).filter(Boolean).slice(0, 5);
    outreach = lettersOut.outreach.trim();
    followUp = lettersOut.followUp.trim();
    if (!lettersOut.variants.length) throw new Skip('the letter step returned no usable variants');
    const lintCtx = (passagesUsed: string[]): LintContext => ({
      fingerprint,
      voice,
      passagesUsed,
      company: ctx!.job.company,
      role: ctx!.job.title,
      specifics: [...evidence!.hooks.map((h) => h.text), ...(ctx!.brief?.products.map((p) => p.text) ?? []), ...evidence!.mustWins],
      // One letter and no second draft to fall back on: it must still edit the candidate's own writing.
      minPassages: volume ? 1 : 2,
    });
    lintCtxFor = lintCtx;
    const record = (d: LetterDraft, critic: CriticResult | null): VariantRecord => {
      const lint = lintLetter(d.text, lintCtx(d.passagesUsed));
      return {
        id: variants.get(d.strategy)?.id ?? crypto.randomUUID(),
        strategy: d.strategy,
        text: d.text,
        // Store the passages the text measurably reuses (verifiable), not just the ones Claude claims.
        passagesUsed: lint.adaptedPassages,
        styleTags: [`strategy:${d.strategy}`, `len:${lengthArm}`, `words:${lint.words}`, ...lint.adaptedPassages.map((p) => `passage:${p}`)],
        critic,
        lint,
        chosen: false,
      };
    };
    for (const d of lettersOut.variants) variants.set(d.strategy, record(d, null));
    step('letters', `${variants.size} variant(s), ${band.min}–${band.max} words (${lengthArm}${lengthPick.explored ? ', explored' : ''})`);

    // 6. Critic, demands applied once, re-score. Volume mode sends its one letter without a critic.
    if (volume) {
      chosen = variants.get(lettersOut.variants[0].strategy)!;
      chosen.chosen = true;
      step('choose', `${chosen.strategy} (volume mode: no critic)`);
    } else {
    const first = await critique(ctx, evidence, lettersOut.variants, subjects, ai, 'critic');
    subjectIndex = first.bestSubject;
    for (const d of lettersOut.variants) variants.get(d.strategy)!.critic = first.results.get(d.strategy) ?? null;
    const toRevise = lettersOut.variants.filter((d) => (first.results.get(d.strategy)?.demands.length ?? 0) > 0);
    if (toRevise.length) {
      const revised = await reviseLetters(ctx, evidence, toRevise.map((d) => ({ draft: d, demands: first.results.get(d.strategy)!.demands })), band, ai);
      if (revised.length) {
        const rescored = await critique(ctx, evidence, revised, subjects, ai, 'critic_rescore');
        subjectIndex = rescored.bestSubject;
        for (const d of revised) variants.set(d.strategy, record(d, rescored.results.get(d.strategy) ?? null));
      }
    }
    step('critic', [...variants.values()].map((v) => `${v.strategy} ${v.critic?.score ?? '–'}`).join(', '));

    const eligible = [...variants.values()].filter((v) => (v.critic?.score ?? 0) >= CRITIC_BAR);
    if (!eligible.length) {
      const best = [...variants.values()].sort((a, b) => (b.critic?.score ?? 0) - (a.critic?.score ?? 0))[0];
      throw new Skip(`critic: best letter scored ${best?.critic?.score ?? 0}/10 (needs ${CRITIC_BAR}); ${best?.critic?.demands.slice(0, 2).join(' / ') || 'no detail'}`);
    }
    // A letter that already passes the free lint beats one that would need a paid rewrite or a skip.
    const lintClean = eligible.filter((v) => v.lint?.pass);
    const pool = lintClean.length ? lintClean : eligible;
    const pick = pickStrategy(pool.map((v) => ({ strategy: v.strategy, score: v.critic!.score })), rng);
    explored = pick.explored;
    chosen = variants.get(pick.choice)!;
    chosen.chosen = true;
    finalCritic = chosen.critic;
    step('choose', `${chosen.strategy} (${chosen.critic!.score})${explored ? ' by exploration' : ''}`);
    }
    scoredText = chosen.text;

    // 7. Humanizer pass on the offending spans.
    let letter = chosen.text;
    const tells = humanizeTargets(letter, null);
    if (tells.length) {
      const h = await humanizePass(ctx, letter, tells, ai, 'humanize');
      letter = h.text;
      step('humanize', `${tells.length} flagged sentence(s), ${h.applied.length} edit(s) applied${h.rejected.length ? `, ${h.rejected.length} rejected` : ''}`);
    } else step('humanize', 'no tells found');

    // 8. Stylometric lint, one targeted rewrite.
    passagesUsed = chosen.passagesUsed;
    lint = lintLetter(letter, lintCtx(passagesUsed));
    if (!lint.pass) {
      const failing = lint.checks.filter((c) => !c.pass);
      const h = await humanizePass(ctx, letter, humanizeTargets(letter, lint), ai, 'lint_fix', `Failing checks: ${failing.map((c) => `${c.id} = ${c.value} (target ${c.target})`).join('; ')}`);
      letter = h.text;
      lint = lintLetter(letter, lintCtx(passagesUsed));
      step('lint', `rewrite for ${failing.map((c) => c.id).join(', ')} → ${lint.pass ? 'pass' : 'still failing'}`);
    } else step('lint', 'pass');
    chosen.text = letter;
    chosen.lint = lint;
    if (!lint.pass) throw new Skip(`lint: ${lint.checks.filter((c) => !c.pass).map((c) => `${c.id} ${c.value} (target ${c.target})`).join('; ')}`);
    } else {
      lint = noLetterLint(noLetter);
      step('letters', 'skipped: the form has no cover-letter field');
    }

    // 11. Short answers.
    const sa = await writeShortAnswers(ctx, evidence, ai);
    shortAnswers = sa.answers;
    step('short_answers', `${Object.keys(sa.answers).length} written${sa.rejected.length ? `, ${sa.rejected.map((r) => `${r.key} rejected (${r.why})`).join('; ')}` : ''}`);

    // 10 & 12. Subject, outreach, follow-up through their short gates.
    if (!noLetter) {
    const okSubjects = subjects.map((s, i) => ({ s, i })).filter((x) => !subjectProblems(x.s).length && lintShort(x.s, { maxChars: 69 }).pass);
    if (!okSubjects.some((x) => x.i === subjectIndex)) subjectIndex = okSubjects[0]?.i ?? -1;
    if (subjectIndex < 0) {
      subjects.push(`${ctx.job.title} application: ${ctx.master.name}`.slice(0, 69));
      subjectIndex = subjects.length - 1;
    }
    }
    const shortGate = async (label: string, text: string, o: Parameters<typeof lintShort>[1]): Promise<string> => {
      if (!text) return '';
      let t = text;
      let l = lintShort(t, o);
      if (!l.pass) {
        const h = await humanizePass(ctx!, t, humanizeTargets(t, l), ai, `${label}_fix`, `Failing checks: ${l.checks.filter((c) => !c.pass).map((c) => `${c.id} = ${c.value} (target ${c.target})`).join('; ')}`);
        t = h.text;
        l = lintShort(t, o);
      }
      step(label, l.pass ? 'pass' : `dropped (${l.checks.filter((c) => !c.pass).map((c) => c.id).join(', ')})`);
      return l.pass ? t : '';
    };
    outreach = await shortGate('outreach', outreach, { minChars: 400, maxChars: 600, company: ctx.job.company, role: ctx.job.title, specifics: evidence.hooks.map((h) => h.text) });
    followUp = await shortGate('follow_up', followUp, { minChars: 250, maxChars: 900 });

    // 9. Truth lock: code + auditor, one rewrite, re-audit.
    const texts = (): FixOut => ({
      letter: chosen?.text ?? '',
      subject: subjects[subjectIndex] ?? '',
      outreach,
      followUp,
      shortAnswers: Object.entries(shortAnswers).map(([key, answer]) => ({ key, answer })),
    });
    const audit = (label: string): Promise<CodeIssue[]> => truthLock(ctx!, ai, label, texts(), cv, evidence, { auditor: !volume });
    truthIssues = await audit('audit');
    let truth = truthResult(truthIssues);
    if (!truth.pass) {
      const high = truthIssues.filter((i) => i.severity === 'high');
      const cvJson = JSON.stringify(cv);
      const t = texts();
      const allText = [t.letter, t.subject, t.outreach, t.followUp, ...t.shortAnswers.map((a) => a.answer)].join('\n');
      const inCv = high.filter((i) => cvJson.includes(i.claim) || /^CV|skill|employer|title|dates|certification|degree|Currently learning/i.test(i.reason));
      const inText = high.filter((i) => allText.includes(i.claim) || !inCv.includes(i));
      if (inCv.length) {
        const fixed = sanitizeCv(await fixCv(ctx, cv!, inCv, ai), ctx, evidence);
        const refit = await fitToPage(fixed.cv, ctx.master.yearsExperience, paperFor(ctx.master.location));
        cv = refit.cv;
        cvChanges.push(...fixed.changes, ...refit.trimmed);
      }
      if (inText.length) {
        const fixed = await fixTexts(ctx, t, inText, ai);
        if (chosen) chosen.text = fixed.letter.trim();
        if (fixed.subject.trim() && !subjectProblems(fixed.subject).length) subjects[subjectIndex] = fixed.subject.trim();
        outreach = lintShort(fixed.outreach, { minChars: 400, maxChars: 600 }).pass ? fixed.outreach.trim() : '';
        followUp = lintShort(fixed.followUp, { minChars: 250, maxChars: 900 }).pass ? fixed.followUp.trim() : '';
        const next: Record<string, string> = {};
        for (const a of fixed.shortAnswers) if (shortAnswers[a.key] !== undefined && lintAnswer(a.key, a.answer, ctx).pass) next[a.key] = a.answer.trim();
        shortAnswers = next;
        // The rewritten letter must still pass the lint.
        if (chosen && lintCtxFor) {
          lint = lintLetter(chosen.text, lintCtxFor(passagesUsed));
          chosen.lint = lint;
          if (!lint.pass) throw new Skip(`lint after truth rewrite: ${lint.checks.filter((c) => !c.pass).map((c) => `${c.id} ${c.value}`).join('; ')}`);
        }
      }
      truthIssues = await audit('audit_recheck');
      truth = truthResult(truthIssues);
      step('truth', `${high.length} high issue(s) → rewrite → ${truth.pass ? 'clean' : 'still failing'}`);
      if (!truth.pass) throw new Skip(`truth lock: ${truthIssues.filter((i) => i.severity === 'high').map((i) => `${i.claim} (${i.reason})`).slice(0, 3).join('; ')}`);
    } else step('truth', `clean (${truthIssues.length} low/medium note(s))`);
    finalTruth = truth;
    finalLint = lint;

    // Final critic gate on the exact text being saved.
    if (!volume && chosen && chosen.text !== scoredText) {
      const final = await critique(ctx, evidence, [{ strategy: chosen.strategy, text: chosen.text }], subjects, ai, 'critic_final');
      finalCritic = final.results.get(chosen.strategy)!;
      chosen.critic = finalCritic;
      step('critic_final', `${finalCritic.score}`);
    }
    if (!volume && chosen && (!finalCritic || finalCritic.score < CRITIC_BAR)) throw new Skip(`critic: final letter scored ${finalCritic?.score ?? 0}/10 (needs ${CRITIC_BAR})`);

    assertGates(finalCritic, finalLint, finalTruth, mode, !noLetter);
    const applicationId = await persist('written', null);
    const verdict = finalCritic ? `critic ${finalCritic.score}` : noLetter ? 'CV and answers only' : 'volume mode';
    const what = chosen ? `${chosen.strategy} letter` : 'no letter (the form has no field for one)';
    if (tracked) transition(jobId, 'written', { campaignId, reason: `writer: ${what}, ${verdict}` });
    run("UPDATE jobs SET stage = CASE WHEN stage = 'found' THEN 'drafted' ELSE stage END, updated_at = ? WHERE id = ?", now(), jobId);
    logEvent('writer', `Wrote the application for ${ctx.job.title} at ${ctx.job.company}: ${what}, ${verdict}`, jobId);
    emit({ type: 'activity', message: `Application written for ${ctx.job.title} at ${ctx.job.company}`, jobId });
    emit({ type: 'application', id: applicationId, status: 'draft' });
    return { result: loadPacket(applicationId)!, applicationId };
  } catch (err) {
    if (err instanceof Skip) {
      step('skipped', err.reason);
      const applicationId = ctx ? await persist('skipped', err.reason) : null;
      if (tracked) transition(jobId, 'skipped', { campaignId, reason: `writer: ${err.reason}`.slice(0, 500) });
      logEvent('writer', `Skipped ${ctx?.job.title ?? jobId} at ${ctx?.job.company ?? ''}: ${err.reason}`, jobId);
      emit({ type: 'activity', message: `Writer skipped ${ctx?.job.title ?? 'a job'}: ${err.reason}`, level: 'warn', jobId });
      if (applicationId) emit({ type: 'application', id: applicationId, status: 'skipped' });
      return { result: { skipped: err.reason }, applicationId };
    }
    if (tracked) {
      const code = err instanceof AppError ? err.code : '';
      const message = (err as Error).message.slice(0, 500);
      try {
        if (RETRYABLE.has(code)) transition(jobId, 'selected', { campaignId, reason: `writer: ${code}`, error: message, countAttempt: true });
        else transition(jobId, 'failed', { campaignId, reason: 'writer: error', error: message, countAttempt: true });
      } catch {
        /* the original error matters more */
      }
    }
    throw err;
  }
}

/** The last line of defence: nothing is saved as written unless every gate passed on the saved text. */
export function assertGates(critic: CriticResult | null, lint: LintResult | null, truth: TruthResult | null, mode: 'volume' | 'quality' = 'quality', hasLetter = true) {
  if (mode === 'quality' && hasLetter && (!critic || critic.score < CRITIC_BAR)) throw new Skip(`gate: critic ${critic?.score ?? 'missing'} < ${CRITIC_BAR}`);
  if (!lint?.pass) throw new Skip('gate: lint did not pass');
  if (!truth?.pass) throw new Skip('gate: truth lock not clean');
}

