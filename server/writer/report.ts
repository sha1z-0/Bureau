import { applicationQuality, qualityTotals, type QualityDetail, type RunSummary } from './quality.ts';

/** Plain-text quality report for `npm run writer:report` (the lead's Phase 3 inspection). */

const pad = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s.padEnd(n));
const yes = (b: boolean | null) => (b === null ? '–' : b ? 'pass' : 'FAIL');

export function formatRuns(runs: RunSummary[]): string {
  const t = qualityTotals(runs);
  const lines = [
    `Writer quality: last ${t.runs} run(s): ${t.written} written, ${t.skipped} skipped${t.avgCritic !== null ? `, mean critic ${t.avgCritic}` : ''}`,
    t.skipReasons.length ? `Skip reasons: ${t.skipReasons.map((r) => `${r.reason} ×${r.n}`).join(', ')}` : '',
    '',
    `${pad('When', 17)} ${pad('Job', 48)} ${pad('Status', 8)} ${pad('Letter', 12)} ${pad('Critic', 6)} ${pad('Lint', 5)} ${pad('Truth', 6)} Note`,
  ].filter((l, i) => l || i === 2);
  for (const r of runs) {
    const letter = r.strategy ? `${r.strategy}/${r.lengthArm ?? '?'}${r.explored ? '*' : ''}` : '–';
    const note = r.status === 'skipped' ? (r.skipped ?? '') : r.lintFailing.length ? `lint: ${r.lintFailing.join(', ')}` : r.subject;
    lines.push(
      `${pad(r.updatedAt.slice(0, 16).replace('T', ' '), 17)} ${pad(`${r.title} @ ${r.company}`, 48)} ${pad(r.status, 8)} ${pad(letter, 12)} ${pad(r.critic === null ? '–' : r.critic.toFixed(1), 6)} ${pad(yes(r.lintPass), 5)} ${pad(r.status === 'written' ? (r.truthPass ? 'clean' : 'FAIL') : '–', 6)} ${note}`,
    );
  }
  if (!runs.length) lines.push('(no writer runs yet)');
  lines.push('', '* = chosen by exploration (20%). Detail: npm run writer:report -- --detail <applicationId>');
  return lines.join('\n');
}

export function formatDetail(q: QualityDetail): string {
  const w = q.writer;
  const out = [
    `${q.summary.title} @ ${q.summary.company}  (application ${q.summary.applicationId})`,
    `Status: ${w.status}${w.skipped ? ` (${w.skipped})` : ''}   Campaign: ${w.campaignId ?? '–'}`,
    '',
    'Steps:',
    ...w.steps.map((s) => `  ${s.at.slice(11, 19)} ${pad(s.step, 14)} ${s.detail}`),
  ];
  if (w.evidence) {
    out.push('', 'Evidence map:');
    for (const i of w.evidence.items) out.push(`  [${i.importance}] ${pad(i.requirement, 44)} ${pad(i.framing, 12)} ${i.factIds.join(', ')}`);
    if (w.evidence.hooks.length) out.push(`  Hooks: ${w.evidence.hooks.map((h) => `${h.text} <${h.sourceUrl}>`).join(' | ')}`);
    if (w.evidenceAdjustments.length) out.push(`  Code adjustments: ${w.evidenceAdjustments.join('; ')}`);
  }
  out.push('', 'Variants:');
  for (const v of q.variants) {
    const failing = v.lint?.checks.filter((c) => !c.pass).map((c) => c.id) ?? [];
    out.push(
      `  ${v.chosen ? '>' : ' '} ${pad(v.strategy, 6)} critic ${v.critic?.score ?? '–'}  lint ${v.lint ? (v.lint.pass ? 'pass' : `FAIL (${failing.join(', ')})`) : '–'}  passages ${v.passagesUsed.join(', ') || 'none'}  ${v.styleTags.filter((t) => t.startsWith('len:') || t.startsWith('words:')).join(' ')}`,
    );
    if (v.critic?.demands.length) out.push(`      demands: ${v.critic.demands.join(' / ')}`);
  }
  if (w.quality) {
    out.push('', 'Lint (chosen letter):');
    for (const c of w.quality.lint.checks) out.push(`  ${c.pass ? 'ok  ' : 'FAIL'} ${pad(c.id, 20)} ${String(c.value).padEnd(10)} ${c.target}`);
    out.push('', `Truth lock: ${w.quality.truth.pass ? 'clean' : 'NOT CLEAN'}`);
  }
  for (const i of q.issues) out.push(`  [${i.severity}/${i.origin}] ${i.claim}: ${i.reason}`);
  if (w.cvChanges.length) out.push('', `CV corrections by code: ${w.cvChanges.join('; ')}`);
  if (q.coverLetter) out.push('', 'Letter:', ...q.coverLetter.split('\n').map((l) => `  ${l}`));
  return out.join('\n');
}

export function detailReport(applicationId: string): string | null {
  const q = applicationQuality(applicationId);
  return q ? formatDetail(q) : null;
}
