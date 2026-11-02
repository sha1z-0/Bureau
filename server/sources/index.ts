import { getSetting } from '../db.ts';
import { arbeitnow, himalayas, jobicy, remoteok, remotive, themuse, weworkremotely } from './aggregators.ts';
import { ashby, greenhouse, lever } from './ats.ts';
import { MORE_ATS } from './atsMore.ts';
import { hackernews } from './community.ts';
import { gamedev, nicheFeeds, reddit, simplify, workingnomads } from './feeds.ts';
import { jobspy } from './jobspy.ts';
import { mustakbil, rozee } from './local.ts';
import { fourdayweek, pythonjobs, ycombinator } from './niche.ts';
import { DEFAULT_BOARDS } from './boards.ts';
import type { Boards, Connector } from './types.ts';

/**
 * Every connector the scout can run. The v1 sixteen come first (same ids, so
 * saved enable/disable settings keep working), then the v2 additions.
 */
export const CONNECTORS: Connector[] = [
  greenhouse,
  lever,
  ashby,
  remotive,
  remoteok,
  weworkremotely,
  himalayas,
  workingnomads,
  nicheFeeds,
  gamedev,
  jobicy,
  arbeitnow,
  themuse,
  hackernews,
  reddit,
  simplify,
  // v2: more ATS families (boards come from the company registry)
  ...MORE_ATS,
  // v2: aggregators, niche and local boards
  jobspy,
  fourdayweek,
  pythonjobs,
  ycombinator,
  rozee,
  mustakbil,
];

export function connectorById(id: string): Connector | undefined {
  return CONNECTORS.find((c) => c.id === id);
}

export interface SourceSettings {
  enabled: Record<string, boolean>;
  boards: Boards;
  extraKeywords: string[];
  maxAgeDays: number;
}

export function sourceSettings(): SourceSettings {
  const saved = getSetting<Partial<SourceSettings>>('sources', {});
  return {
    enabled: Object.fromEntries(CONNECTORS.map((c) => [c.id, saved.enabled?.[c.id] ?? c.defaultEnabled])),
    boards: saved.boards ?? DEFAULT_BOARDS,
    extraKeywords: saved.extraKeywords ?? [],
    maxAgeDays: saved.maxAgeDays ?? 30,
  };
}
