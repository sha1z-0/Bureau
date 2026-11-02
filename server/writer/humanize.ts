import { z } from 'zod/v4';
import type { LintResult } from '../contracts/writer.ts';
import type { WriterAi } from './ai.ts';
import type { WriterContext } from './context.ts';
import { writerSystem } from './evidence.ts';
import { findTells, rulesForPrompt } from './humanizer.ts';
import { targetSentences } from './lint.ts';
import { TAILOR_RULES } from './prompts.ts';

/**
 * Step 7 (humanizer) and the lint's targeted rewrite. Claude returns edits as
 * find/replace pairs; code applies only edits whose `find` sits inside one of
 * the flagged sentences, so nothing outside the offending spans can change.
 */

export const HUMANIZE_SYSTEM = `${TAILOR_RULES}

TASK: you are a line editor removing signs of machine writing from the candidate's text. You get the text and a list of flagged sentences, each with the problems found in it. Rewrite ONLY the flagged sentences, as the candidate would say it (plain words, their rhythm). Keep every fact, number and name exactly; add no new claims. Return edits: "find" is an exact substring copied from one flagged sentence, "replace" is its new wording. Edits outside the flagged sentences are discarded.

The rule set (paraphrased from Wikipedia's "Signs of AI writing" taxonomy, plus stylometry findings):
${rulesForPrompt()}
- burstiness: sentence lengths too uniform. Split one long flagged sentence or merge two short ones so lengths vary.
- lexical_diversity: vocabulary too varied or too repetitive for this writer. Use the plainer, repeated words they use.
- contractions: match the writer's habit (use or drop contractions in the flagged sentences).
- nominalizations: turn "-tion/-ment/-ness" nouns back into verbs.
- specific_opening: the first sentence must name the company, the role or a concrete hook.
- closing_summary: replace the summary with one concrete, low-pressure ask.
- rule_of_three: break the list of three into one or two specific items.
- em_dashes: use a comma, a full stop or brackets instead.`;

export const EditsSchema = z.object({
  edits: z.array(z.object({ find: z.string(), replace: z.string(), reason: z.string() })),
});
export type Edit = z.infer<typeof EditsSchema>['edits'][number];

export interface Target {
  sentence: string;
  problems: string[];
}

/** Flagged sentences: every humanizer tell, plus the sentences behind failing lint checks. */
export function humanizeTargets(text: string, lint?: LintResult | null): Target[] {
  const map = new Map<string, Set<string>>();
  const add = (s: string, p: string) => {
    if (!s.trim()) return;
    map.set(s, (map.get(s) ?? new Set()).add(p));
  };
  for (const t of findTells(text)) add(t.sentence, `${t.rule}: "${t.match.trim()}"`);
  if (lint) {
    const failing = lint.checks.filter((c) => !c.pass).map((c) => c.id);
    for (const s of targetSentences(text, failing)) for (const f of failing) if (!['banned_phrases', 'formatting', 'length', 'voice_adaptation'].includes(f)) add(s, f);
  }
  return [...map].map(([sentence, problems]) => ({ sentence, problems: [...problems] }));
}

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

export function applyEdits(text: string, edits: Edit[], targets: Target[]): { text: string; applied: Edit[]; rejected: { edit: Edit; why: string }[] } {
  let out = text;
  const applied: Edit[] = [];
  const rejected: { edit: Edit; why: string }[] = [];
  for (const e of edits) {
    if (!e.find.trim()) {
      rejected.push({ edit: e, why: 'empty find' });
      continue;
    }
    if (!targets.some((t) => squash(t.sentence).includes(squash(e.find)))) {
      rejected.push({ edit: e, why: 'outside the flagged sentences' });
      continue;
    }
    const idx = out.indexOf(e.find);
    if (idx < 0) {
      rejected.push({ edit: e, why: 'not found in the text' });
      continue;
    }
    out = out.slice(0, idx) + e.replace + out.slice(idx + e.find.length);
    applied.push(e);
  }
  return { text: out, applied, rejected };
}

export async function humanizePass(ctx: WriterContext, text: string, targets: Target[], ai: WriterAi, label: string, note = '') {
  if (!targets.length) return { text, applied: [] as Edit[], rejected: [] as { edit: Edit; why: string }[] };
  const content = `<text>
${text}
</text>

Flagged sentences:
${targets.map((t, i) => `${i + 1}. "${t.sentence}"\n   problems: ${t.problems.join('; ')}`).join('\n')}
${note ? `\n${note}\n` : ''}
Return the edits.`;
  const out = await ai.ask({ task: 'humanize', label, system: writerSystem(ctx, HUMANIZE_SYSTEM), content, schema: EditsSchema, maxTokens: 4000 });
  return applyEdits(text, out.edits, targets);
}
