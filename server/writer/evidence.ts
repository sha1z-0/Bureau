import { z } from 'zod/v4';
import type { SystemBlocks } from '../ai/claude.ts';
import { Importance } from '../contracts/match.ts';
import { Framing, type EvidenceMap } from '../contracts/writer.ts';
import type { WriterAi } from './ai.ts';
import { briefUrls, jobBlock, profileBlock, voiceBlock, type WriterContext } from './context.ts';
import { EVIDENCE_SYSTEM } from './prompts.ts';
import { hasTerm } from './text.ts';

/**
 * Steps 1–3: decode the posting, pick research hooks, and map every
 * requirement to the best true evidence with a framing. Claude proposes; code
 * disposes: fact ids that don't exist are dropped, a direct or transferable
 * claim with no real fact becomes `learning` (if the skill is on the list) or
 * `omit`, and a hook whose URL the research never read is dropped.
 */

export const DecodeSchema = z.object({
  priorities: z.array(z.string()),
  mustWins: z.array(z.string()),
  tone: z.string(),
  seniority: z.string(),
  hooks: z.array(z.object({ text: z.string(), sourceUrl: z.string() })),
  items: z.array(
    z.object({
      requirement: z.string(),
      importance: Importance,
      factIds: z.array(z.string()),
      evidence: z.string(),
      framing: Framing,
      phrasing: z.string(),
    }),
  ),
  biggestGap: z.string().nullable(),
  fastLearning: z.string().nullable(),
});
export type Decode = z.infer<typeof DecodeSchema>;

/** The shared system prefix: candidate facts plus voice bank (cached), then the task's own rules. */
export function writerSystem(ctx: WriterContext, task: string): SystemBlocks {
  return [
    { type: 'text', text: `${profileBlock(ctx.master)}\n\n${voiceBlock(ctx.master)}`, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: task },
  ];
}

export interface EvidenceOutcome {
  map: EvidenceMap;
  fastLearning: string | null;
  /** What code changed in Claude's proposal, for the quality report. */
  adjustments: string[];
}

export function sanitizeEvidence(ctx: WriterContext, d: Decode): EvidenceOutcome {
  const adjustments: string[] = [];
  const factIds = new Set(ctx.master.facts.map((f) => f.id));
  const learning = ctx.learning;
  const urls = briefUrls(ctx.brief);
  urls.add(ctx.job.url);

  const hooks = d.hooks.filter((h) => {
    const ok = urls.has(h.sourceUrl);
    if (!ok) adjustments.push(`Dropped hook with an unread source: ${h.text.slice(0, 60)}`);
    return ok;
  });
  if (hooks.length > 2) adjustments.push(`Kept the first 2 of ${hooks.length} hooks`);

  const learningFor = (requirement: string) => learning.find((l) => hasTerm(requirement, l.skill) || hasTerm(l.skill, requirement));

  const items = d.items.map((it) => {
    const real = it.factIds.filter((id) => factIds.has(id));
    const learnIds = it.factIds.filter((id) => learning.some((l) => l.id === id));
    if (it.framing === 'omit') return { ...it, factIds: [] };
    if (it.framing === 'learning') {
      const l = learnIds.length ? learning.find((x) => x.id === learnIds[0]) : learningFor(it.requirement);
      if (!l) {
        adjustments.push(`"${it.requirement}" framed as learning but not on the learning list: omitted`);
        return { ...it, framing: 'omit' as const, factIds: [] };
      }
      return { ...it, factIds: [l.id] };
    }
    if (real.length) {
      if (real.length !== it.factIds.length) adjustments.push(`"${it.requirement}": dropped ${it.factIds.length - real.length} unknown fact id(s)`);
      return { ...it, factIds: real };
    }
    const l = learningFor(it.requirement);
    if (l) {
      adjustments.push(`"${it.requirement}" had no real fact: reframed as learning`);
      return { ...it, framing: 'learning' as const, factIds: [l.id], phrasing: `Learning ${l.skill} now${l.notes ? ` (${l.notes})` : ''}` };
    }
    adjustments.push(`"${it.requirement}" had no real fact: omitted`);
    return { ...it, framing: 'omit' as const, factIds: [] };
  });

  return {
    map: {
      jobId: ctx.job.id,
      priorities: d.priorities.slice(0, 8),
      mustWins: d.mustWins.slice(0, 3),
      tone: d.tone,
      seniority: d.seniority,
      hooks: hooks.slice(0, 2),
      items,
      biggestGap: d.biggestGap,
    },
    fastLearning: d.fastLearning && (factIds.has(d.fastLearning) || ctx.master.voiceBank.some((v) => v.id === d.fastLearning)) ? d.fastLearning : null,
    adjustments,
  };
}

export async function buildEvidence(ctx: WriterContext, ai: WriterAi, instructions = ''): Promise<EvidenceOutcome> {
  const content = `${jobBlock(ctx)}
${instructions ? `\nThe candidate's own instructions for this application:\n${instructions}\n` : ''}
Decode this posting and build the evidence map.`;
  const decoded = await ai.ask({ task: 'evidence', label: 'evidence', system: writerSystem(ctx, EVIDENCE_SYSTEM), content, schema: DecodeSchema, maxTokens: 8000 });
  return sanitizeEvidence(ctx, decoded);
}

/** The evidence map as prompt text for the later steps. */
export function evidenceForPrompt(map: EvidenceMap): string {
  const lines = [
    '<evidence_map>',
    `Priorities: ${map.priorities.join('; ')}`,
    `Must-wins: ${map.mustWins.join('; ')}`,
    `Tone: ${map.tone} | Seniority: ${map.seniority}`,
    `Hooks: ${map.hooks.map((h) => `${h.text} [${h.sourceUrl}]`).join(' | ') || 'none'}`,
    ...map.items.map((i) => `- [${i.importance}] ${i.requirement} → ${i.framing}${i.factIds.length ? ` (${i.factIds.join(', ')})` : ''}: ${i.phrasing}`),
    `Biggest gap: ${map.biggestGap ?? 'none'}`,
    '</evidence_map>',
  ];
  return lines.join('\n');
}
