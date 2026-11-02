import { STRETCH_ALLOWANCE } from '../contracts/match.ts';
import { SCORE_LABEL, SCORE_TOOLTIP } from './rubric.ts';
import type { StoredMatch } from './store.ts';

/**
 * Plain-language explanation of a match: what the number means ("chance of
 * passing the screen") and how this one was made. Built from stored data only,
 * so it costs nothing to show.
 */

export interface MatchExplanation {
  label: string;
  tooltip: string;
  score: number;
  grade: string;
  headline: string;
  lines: string[];
  text: string;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function explainMatch(m: StoredMatch): MatchExplanation {
  const lines: string[] = [];
  const e = m.explain;
  const headline = `${SCORE_LABEL}: ${m.screenPassScore}/100 (${m.grade}).`;

  if (e.filter) {
    lines.push(`Skipped before assessment: ${e.filter.reason}.`);
  } else {
    const by = (imp: 'critical' | 'important' | 'nice') => m.requirements.filter((r) => r.importance === imp);
    const covered = (rs: typeof m.requirements) => rs.filter((r) => r.match !== 'missing').length;
    const crit = by('critical');
    const imp = by('important');
    const nice = by('nice');
    const parts: string[] = [];
    if (crit.length) parts.push(`${covered(crit)} of ${crit.length} must-haves covered`);
    if (imp.length) parts.push(`${covered(imp)} of ${imp.length} expected skills covered`);
    if (nice.length) parts.push(`${covered(nice)} of ${nice.length} bonus items`);
    if (parts.length) lines.push(`Requirements: ${parts.join(', ')} (met or partly met). Bonus items barely move the score.`);
    const learning = m.requirements.filter((r) => r.proofKind === 'learning').map((r) => r.text);
    if (learning.length) lines.push(`Counted as partial because you are learning them: ${learning.join(', ')}.`);
    const transferable = m.requirements.filter((r) => r.proofKind === 'transferable').map((r) => r.text);
    if (transferable.length) lines.push(`Transferable experience (partial credit): ${transferable.join(', ')}.`);

    const b = e.breakdown;
    if (b) {
      const s = b.stretch;
      const unmet = s.unmetImportant + s.unmetCritical;
      const missingNames = m.requirements.filter((r) => r.match === 'missing' && !r.blocker && r.importance !== 'nice').map((r) => r.text);
      if (unmet) {
        lines.push(
          `Stretch: ${plural(unmet, 'expected requirement')} missing (${missingNames.join(', ')}); the ${s.level} stretch level allows ${STRETCH_ALLOWANCE[s.level]}${
            s.penalty ? `, so ${s.penalty} points come off for the ${s.excess} beyond it.` : ', so there is no penalty.'
          }`,
        );
      } else {
        lines.push(`Stretch: nothing expected is missing.`);
      }
      for (const c of b.caps) lines.push(`Capped at ${c.cap}: ${c.reason}.`);
      for (const a of b.adjustments.filter((x) => x.points > 0)) lines.push(`+${a.points}: ${a.reason}.`);
      for (const a of b.adjustments.filter((x) => x.points < 0 && !x.reason.includes('stretch allowance'))) lines.push(`${a.points}: ${a.reason}.`);
      lines.push(
        `How it was made: requirements ${Math.round(b.requirements)} (55%), fit dimensions ${Math.round(b.dimensions)} (30%), similarity pre-rank ${Math.round(b.preRank)} (15%).`,
      );
    }
    if (m.inflatedPosting) lines.push(`Inflated posting: ${e.inflationNote || 'the listed experience is far above what the level needs'}. Screeners rarely enforce it.`);
    if (m.stretch.blockers.length) lines.push(`True blocker: ${m.stretch.blockers.join('; ')}. No amount of framing gets past this one.`);
    if (m.verdict) lines.push(`Verdict: ${m.verdict}`);
  }
  if (m.reason && m.decision === 'skipped' && !e.filter) lines.push(`Skipped: ${m.reason}.`);
  if (m.decision === 'selected') lines.push(`Selected for the campaign queue${m.reason ? ` (${m.reason})` : ''}.`);

  return {
    label: SCORE_LABEL,
    tooltip: SCORE_TOOLTIP,
    score: m.screenPassScore,
    grade: m.grade,
    headline,
    lines,
    text: [headline, ...lines].join('\n'),
  };
}
