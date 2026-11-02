import { all } from '../db.ts';
import { MODEL_CHOICES, modelFor, type Task } from './claude.ts';

/**
 * What the hunt will cost. Before there's history, typical token counts per
 * call are assumed (thinking tokens bill as output). Once a task has run a few
 * times on its current model, the measured average replaces the assumption.
 */

interface Shape {
  input: number;
  cacheRead: number;
  output: number;
}

// Per call. Scoring batches 6 roles a call; the rubric and profile ride the prompt cache.
const ASSUMED: Partial<Record<Task, Shape>> = {
  score: { input: 18_000, cacheRead: 5_000, output: 6_000 },
  tailor: { input: 7_000, cacheRead: 5_000, output: 8_000 },
  audit: { input: 6_000, cacheRead: 0, output: 700 },
  apply: { input: 4_000, cacheRead: 5_000, output: 2_000 },
  scan: { input: 60_000, cacheRead: 0, output: 6_000 },
  capture: { input: 8_000, cacheRead: 0, output: 2_500 },
  // v2
  profile_sync: { input: 12_000, cacheRead: 0, output: 3_000 },
  research: { input: 30_000, cacheRead: 0, output: 3_000 },
  match: { input: 14_000, cacheRead: 6_000, output: 5_000 },
  evidence: { input: 6_000, cacheRead: 6_000, output: 3_000 },
  write_cv: { input: 5_000, cacheRead: 6_000, output: 5_000 },
  write_letter: { input: 6_000, cacheRead: 6_000, output: 4_000 },
  critic: { input: 5_000, cacheRead: 0, output: 1_500 },
  humanize: { input: 2_500, cacheRead: 0, output: 1_200 },
  form_map: { input: 3_000, cacheRead: 2_000, output: 600 },
  agent_step: { input: 6_000, cacheRead: 3_000, output: 300 },
  recipe_compile: { input: 8_000, cacheRead: 0, output: 2_000 },
  inbox_classify: { input: 2_500, cacheRead: 1_000, output: 300 },
  learning_plan: { input: 6_000, cacheRead: 0, output: 4_000 },
  gap_report: { input: 10_000, cacheRead: 0, output: 2_500 },
  answer_q: { input: 3_000, cacheRead: 6_000, output: 600 },
};

/** Estimated (or measured) cost of one call of any task on its current model. */
export function taskCost(task: Task): { usd: number; measured: boolean } {
  return perCall(task);
}

const SCORE_BATCH = 6;

function priced(task: Task, shape: Shape): number {
  const p = MODEL_CHOICES.find((m) => m.id === modelFor(task)) ?? MODEL_CHOICES[0];
  return (shape.input * p.input + shape.cacheRead * p.cacheRead + shape.output * p.output) / 1_000_000;
}

function perCall(task: Task): { usd: number; measured: boolean } {
  const model = modelFor(task);
  const rows = all<{ calls: number; avg: number }>(
    "SELECT COUNT(*) AS calls, AVG(cost_usd) AS avg FROM ai_usage WHERE task = ? AND model = ? AND ts >= date('now', '-30 day')",
    task,
    model,
  );
  const r = rows[0];
  if (r && r.calls >= 3) return { usd: r.avg, measured: true };
  return { usd: priced(task, ASSUMED[task] ?? { input: 5_000, cacheRead: 0, output: 1_000 }), measured: false };
}

export interface UnitCosts {
  perJobScored: number;
  perApplication: number;
  perDeepScan: number;
  measured: boolean;
  models: { score: string; tailor: string; apply: string };
}

export function unitCosts(): UnitCosts {
  const score = perCall('score');
  const tailor = perCall('tailor');
  const audit = perCall('audit');
  const apply = perCall('apply');
  const scan = perCall('scan');
  const capture = perCall('capture');
  return {
    perJobScored: score.usd / SCORE_BATCH,
    // A draft, its independent audit, and the form answers. About one in four needs a second draft.
    perApplication: tailor.usd * 1.25 + audit.usd * 1.25 + apply.usd,
    // Web searches bill at $10 per 1,000 on top of tokens.
    perDeepScan: scan.usd + capture.usd + 12 * 0.01,
    measured: score.measured && tailor.measured,
    models: { score: modelFor('score'), tailor: modelFor('tailor'), apply: modelFor('apply') },
  };
}
