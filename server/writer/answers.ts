import { z } from 'zod/v4';
import type { Answered } from '../contracts/profile.ts';
import type { EvidenceMap } from '../contracts/writer.ts';
import { matchOption } from '../profile/index.ts';
import { defaultWriterAi, type WriterAi } from './ai.ts';
import { jobBlock, loadContext, loadJob, type ContextOptions, type WriterContext } from './context.ts';
import { buildEvidence, evidenceForPrompt, writerSystem } from './evidence.ts';
import { lintShort } from './lint.ts';
import { latestApplication, readNotes } from './packet.ts';
import { ANSWERS_SYSTEM } from './prompts.ts';
import { codeTruth, truthResult } from './truth.ts';
import type { LintResult, TruthResult } from '../contracts/writer.ts';

/**
 * Step 11: form short-answers. The three common long-form questions are
 * pre-written with every packet; anything else the form engine asks goes
 * through `answerQuestion`, which writes from the same evidence map and voice,
 * then runs the short lint and the code truth lock (one rewrite if either
 * fails, else null so the form engine records it as unknown).
 */

export const PREWRITTEN = ['why us', 'why this role', 'tell us about a project'] as const;
export type PrewrittenKey = (typeof PREWRITTEN)[number];

const PREWRITTEN_QUESTIONS: Record<PrewrittenKey, string> = {
  'why us': 'Why do you want to work here?',
  'why this role': 'Why are you interested in this role?',
  'tell us about a project': 'Tell us about a project you are proud of.',
};

/** Map a form question onto a pre-written key, if it is one of the three. */
export function prewrittenKey(question: string, company = ''): PrewrittenKey | null {
  const q = question.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const co = company.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').trim();
  if (/\b(project|something you (built|made|shipped))\b/.test(q) && /\b(tell|describe|share|walk|talk|proud|favorite|favourite)\b/.test(q)) return 'tell us about a project';
  if (/\bwhy (this|the) (role|position|job|opportunity)\b|\bwhy are you (interested in|applying (for|to)) (this|the) (role|position|job)\b|\binterest(s|ed)? you (about|in) (this|the) (role|position)\b/.test(q)) return 'why this role';
  if (/\bwhy (do you want to )?(work|join)(ing)? (at |for |with )?(us|our|here)\b|\bwhy (us|our company|this company)\b|\bwhat (draws|attracts) you to (us|our)\b/.test(q)) return 'why us';
  if (co && new RegExp(`\\bwhy (do you want to )?(work (at|for|with) |join )?${co.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(q)) return 'why us';
  return null;
}

const ShortAnswersSchema = z.object({ answers: z.array(z.object({ key: z.string(), answer: z.string() })) });
const OneAnswerSchema = z.object({ answer: z.string(), option: z.string().nullable() });

export function lintAnswer(key: string, text: string, ctx: WriterContext, maxChars = 1200): LintResult {
  const opening = key === 'why us' || key === 'why this role';
  return lintShort(text, { maxChars, minChars: 80, ...(opening ? { company: ctx.job.company, role: ctx.job.title } : {}) });
}

export async function writeShortAnswers(ctx: WriterContext, evidence: EvidenceMap, ai: WriterAi): Promise<{ answers: Record<string, string>; rejected: { key: string; why: string }[] }> {
  const content = `${jobBlock(ctx)}

${evidenceForPrompt(evidence)}

Questions (answer each; return key exactly as given):
${PREWRITTEN.map((k) => `- key "${k}": ${PREWRITTEN_QUESTIONS[k]}`).join('\n')}

Each answer: 2–5 sentences, at most 1,000 characters.`;
  const out = await ai.ask({ task: 'answer_q', label: 'short_answers', system: writerSystem(ctx, ANSWERS_SYSTEM), content, schema: ShortAnswersSchema, maxTokens: 4000 });
  const answers: Record<string, string> = {};
  const rejected: { key: string; why: string }[] = [];
  for (const k of PREWRITTEN) {
    const a = out.answers.find((x) => x.key.trim().toLowerCase() === k)?.answer.trim();
    if (!a) {
      rejected.push({ key: k, why: 'not written' });
      continue;
    }
    const lint = lintAnswer(k, a, ctx);
    if (!lint.pass) {
      rejected.push({ key: k, why: `lint: ${lint.checks.filter((c) => !c.pass).map((c) => c.id).join(', ')}` });
      continue;
    }
    answers[k] = a;
  }
  return { answers, rejected };
}

export interface AnswerOptions {
  maxChars?: number;
  options?: string[];
  ai?: WriterAi;
  context?: ContextOptions;
}

export interface AnswerTrace {
  answered: Answered | null;
  lint: LintResult | null;
  truth: TruthResult | null;
  attempts: number;
}

/** Answer any long-form question for a job. Returns null when no answer passes the gates. */
export async function answerQuestionTraced(jobId: string, question: string, opts: AnswerOptions = {}): Promise<AnswerTrace> {
  const q = question.trim().slice(0, 1000);
  const maxChars = Math.max(80, Math.min(opts.maxChars ?? 1500, 5000));
  const app = latestApplication(jobId);
  const notes = app ? readNotes(app.notes).writer : null;

  // 1. A pre-written answer from the packet, if it fits.
  const key = opts.options?.length ? null : prewrittenKey(q, loadJob(jobId).company);
  if (key && notes?.status === 'written' && notes.shortAnswers[key] && notes.shortAnswers[key].length <= maxChars) {
    return { answered: { value: notes.shortAnswers[key], source: 'writer', confidence: 0.9, key: `writer:${key}` }, lint: null, truth: null, attempts: 0 };
  }

  // 2. Write one from the same evidence map and voice.
  const ai = opts.ai ?? defaultWriterAi;
  const ctx = await loadContext(jobId, opts.context ?? { brief: null });
  const evidence = notes?.evidence ?? (await buildEvidence(ctx, ai)).map;
  let feedback = '';
  let last: AnswerTrace = { answered: null, lint: null, truth: null, attempts: 0 };
  for (let attempt = 1; attempt <= 2; attempt++) {
    const content = `${jobBlock(ctx)}

${evidenceForPrompt(evidence)}

<form_question>${q.replace(/</g, '‹')}</form_question>
${opts.options?.length ? `Options (choose exactly one, copied as written):\n${opts.options.map((o) => `- ${o.replace(/</g, '‹')}`).join('\n')}` : `Length limit: ${maxChars} characters.`}
${feedback}`;
    const out = await ai.ask({ task: 'answer_q', label: attempt === 1 ? 'answer' : 'answer_retry', system: writerSystem(ctx, ANSWERS_SYSTEM), content, schema: OneAnswerSchema, maxTokens: 2000 });
    if (opts.options?.length) {
      const picked = out.option ? matchOption(out.option, opts.options) : null;
      const exact = picked && opts.options.find((o) => o.trim() === picked.trim());
      return { answered: exact ? { value: exact, source: 'writer', confidence: 0.8, key: 'writer:option' } : null, lint: null, truth: null, attempts: attempt };
    }
    const text = out.answer.trim();
    const lint = lintShort(text, { maxChars, minChars: Math.min(40, maxChars) });
    const truth = truthResult(codeTruth({ texts: [{ label: 'Answer', text }] }, ctx.source));
    last = { answered: null, lint, truth, attempts: attempt };
    if (lint.pass && truth.pass) return { answered: { value: text, source: 'writer', confidence: 0.85, key: `writer:q:${q.toLowerCase().slice(0, 80)}` }, lint, truth, attempts: attempt };
    feedback = `\nYour previous answer failed these checks; fix them and keep everything else:\n${[
      ...lint.checks.filter((c) => !c.pass).map((c) => `- ${c.id}: ${c.value} (target ${c.target})`),
      ...truth.issues.filter((i) => i.severity === 'high').map((i) => `- unsupported: ${i.claim} (${i.reason})`),
    ].join('\n')}\nPrevious answer:\n${text}`;
  }
  return last;
}
