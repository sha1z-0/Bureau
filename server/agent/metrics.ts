import { all, get } from '../db.ts';
import '../forms/schema.ts';
import './schema.ts';

/**
 * Learning metrics for the UI: agent runs vs recipe runs (and adapter runs) per
 * day, cost per agent run, recipe coverage by ATS, the learning queue and the
 * shadow-verification pipeline. Shape matches web/src/api.ts `AgentMetrics`
 * (daily, costPerRun, totals) plus extra keys.
 */

export interface DailyRow {
  day: string;
  agentRuns: number;
  recipeRuns: number;
  adapterRuns: number;
  genericRuns: number;
  agentCostUsd: number;
}

function dayKeys(days: number, until = new Date()): string[] {
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i--) out.push(new Date(until.getTime() - i * 86_400_000).toISOString().slice(0, 10));
  return out;
}

export function learningMetrics(opts: { days?: number } = {}) {
  const days = Math.max(1, Math.min(365, Math.round(opts.days ?? 30)));
  const keys = dayKeys(days);
  const since = `${keys[0]}T00:00:00.000Z`;
  const daily = new Map<string, DailyRow>(keys.map((d) => [d, { day: d, agentRuns: 0, recipeRuns: 0, adapterRuns: 0, genericRuns: 0, agentCostUsd: 0 }]));

  // The agent's own runs: Claude-driven ("agent") or a recipe it replayed ("recipe").
  for (const r of all<{ day: string; mode: string; n: number; cost: number }>("SELECT substr(started_at, 1, 10) AS day, mode, COUNT(*) AS n, COALESCE(SUM(cost_usd), 0) AS cost FROM agent_runs WHERE started_at >= ? AND status <> 'running' GROUP BY day, mode", since)) {
    const d = daily.get(r.day);
    if (!d) continue;
    if (r.mode === 'recipe') d.recipeRuns += r.n;
    else {
      d.agentRuns += r.n;
      d.agentCostUsd = Math.round((d.agentCostUsd + r.cost) * 1e6) / 1e6;
    }
  }
  // The form engine's runs (A05): recipe, adapter, generic. Agent-finished runs are counted above.
  for (const r of all<{ day: string; via: string | null; n: number }>("SELECT substr(started_at, 1, 10) AS day, via, COUNT(*) AS n FROM form_runs WHERE started_at >= ? AND via IN ('recipe','adapter','generic') GROUP BY day, via", since)) {
    const d = daily.get(r.day);
    if (!d) continue;
    if (r.via === 'recipe') d.recipeRuns += r.n;
    else if (r.via === 'adapter') d.adapterRuns += r.n;
    else d.genericRuns += r.n;
  }
  const rows = [...daily.values()];
  const agentRow = get<{ n: number; cost: number }>("SELECT COUNT(*) AS n, COALESCE(SUM(cost_usd), 0) AS cost FROM agent_runs WHERE mode = 'agent' AND status <> 'running' AND started_at >= ?", since);
  const agentRuns = Number(agentRow?.n ?? 0);
  const costPerRun = agentRuns ? Math.round((Number(agentRow?.cost ?? 0) / agentRuns) * 1e6) / 1e6 : null;

  const promoted = Number(get<{ n: number }>("SELECT COUNT(DISTINCT l.recipe_id) AS n FROM agent_learning l JOIN form_recipes r ON r.id = l.recipe_id WHERE r.status = 'active'")?.n ?? 0);
  const totals = {
    agentRuns: rows.reduce((n, r) => n + r.agentRuns, 0),
    recipeRuns: rows.reduce((n, r) => n + r.recipeRuns, 0),
    adapterRuns: rows.reduce((n, r) => n + r.adapterRuns, 0),
    genericRuns: rows.reduce((n, r) => n + r.genericRuns, 0),
    promoted,
    agentCostUsd: Math.round(Number(agentRow?.cost ?? 0) * 1e6) / 1e6,
    compileCostUsd: Math.round(Number(get<{ c: number }>("SELECT COALESCE(SUM(cost_usd), 0) AS c FROM ai_usage WHERE task = 'recipe_compile' AND ts >= ?", since)?.c ?? 0) * 1e6) / 1e6,
  };

  // Coverage by ATS: recipes by status, and whether the family has an active recipe of any scope.
  const cov = new Map<string, { ats: string; active: number; candidate: number; shadow: number; demoted: number; atsScope: boolean; learned: number }>();
  for (const r of all<{ ats: string; status: string; scope: string; n: number }>('SELECT ats, status, scope, COUNT(*) AS n FROM form_recipes GROUP BY ats, status, scope')) {
    const c = cov.get(r.ats) ?? { ats: r.ats, active: 0, candidate: 0, shadow: 0, demoted: 0, atsScope: false, learned: 0 };
    if (r.status === 'active' || r.status === 'candidate' || r.status === 'shadow' || r.status === 'demoted') c[r.status] += r.n;
    if (r.status === 'active' && r.scope === 'ats') c.atsScope = true;
    cov.set(r.ats, c);
  }
  for (const r of all<{ ats: string; n: number }>('SELECT r.ats, COUNT(DISTINCT r.id) AS n FROM form_recipes r JOIN agent_learning l ON l.recipe_id = r.id GROUP BY r.ats')) {
    const c = cov.get(r.ats);
    if (c) c.learned = r.n;
  }
  const seen = all<{ ats: string; n: number }>("SELECT COALESCE(ats, 'other') AS ats, COUNT(*) AS n FROM form_runs WHERE started_at >= ? GROUP BY ats", since);
  const coverage = [...new Set([...cov.keys(), ...seen.map((s) => s.ats)])].sort().map((ats) => ({
    ...(cov.get(ats) ?? { ats, active: 0, candidate: 0, shadow: 0, demoted: 0, atsScope: false, learned: 0 }),
    runs: Number(seen.find((s) => s.ats === ats)?.n ?? 0),
    covered: (cov.get(ats)?.active ?? 0) > 0,
  }));

  const queue = all<{ status: string; external: number; n: number }>("SELECT status, CASE WHEN origin LIKE 'external:%' THEN 1 ELSE 0 END AS external, COUNT(*) AS n FROM agent_learning GROUP BY status, external");
  const unqueued = Number(get<{ n: number }>('SELECT COUNT(*) AS n FROM agent_traces t LEFT JOIN agent_learning l ON l.trace_id = t.id WHERE l.trace_id IS NULL')?.n ?? 0);
  const shadow = get<{ runs: number; matches: number; mismatches: number; external: number }>(
    "SELECT COUNT(*) AS runs, COALESCE(SUM(CASE WHEN source = 'internal' AND ok = 1 THEN 1 ELSE 0 END), 0) AS matches, COALESCE(SUM(CASE WHEN source = 'internal' AND ok = 0 THEN 1 ELSE 0 END), 0) AS mismatches, COALESCE(SUM(CASE WHEN source <> 'internal' THEN 1 ELSE 0 END), 0) AS external FROM recipe_shadow_runs",
  );
  const outcomes = all<{ status: string; n: number }>("SELECT status, COUNT(*) AS n FROM agent_runs WHERE started_at >= ? AND status <> 'running' GROUP BY status", since);
  const injections = Number(get<{ n: number }>('SELECT COALESCE(SUM(injection_attempts), 0) AS n FROM agent_runs WHERE started_at >= ?', since)?.n ?? 0);

  return {
    days,
    daily: rows,
    costPerRun,
    totals,
    coverage,
    outcomes: Object.fromEntries(outcomes.map((o) => [o.status, o.n])),
    learning: {
      unqueued,
      internal: Object.fromEntries(queue.filter((q) => !q.external).map((q) => [q.status, q.n])),
      external: Object.fromEntries(queue.filter((q) => q.external).map((q) => [q.status, q.n])),
    },
    shadow: { runs: Number(shadow?.runs ?? 0), matches: Number(shadow?.matches ?? 0), mismatches: Number(shadow?.mismatches ?? 0), external: Number(shadow?.external ?? 0) },
    injectionAttempts: injections,
  };
}
