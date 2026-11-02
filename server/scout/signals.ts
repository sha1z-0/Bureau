import { all } from '../db.ts';
import { addSignal, companiesWithFreshSignals, hasFreshSignal, recordBoard, toCompany, type Company } from './registry.ts';

/**
 * Hiring signals: a company whose open-role count jumps by 30% or more between
 * polls, or that deep scan reports raising money, is probably about to hire
 * before the roles are widely posted. Such companies get their whole board
 * polled every cycle (registry.targetsForAts puts them first) and their roles
 * in the campaign's categories get +1 priority (legitimacy.priorityFor).
 *
 * The bookkeeping itself lives with the registry rows; this module is the
 * signals-facing view of it.
 */

export { addSignal, companiesWithFreshSignals, hasFreshSignal, recordBoard };

/** Companies with a signal in the last two weeks, newest signal first. */
export function freshSignals(limit = 100): { company: Company; latest: Company['signals'][number] }[] {
  return all<Parameters<typeof toCompany>[0]>("SELECT * FROM companies WHERE signals != '[]'")
    .map(toCompany)
    .filter(hasFreshSignal)
    .map((company) => ({ company, latest: company.signals[company.signals.length - 1] }))
    .sort((a, b) => Date.parse(b.latest.at) - Date.parse(a.latest.at))
    .slice(0, limit);
}
