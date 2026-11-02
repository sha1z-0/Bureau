import { getSetting } from '../db.ts';
import { arbeitnow, himalayas, jobicy, remoteok, remotive, themuse, weworkremotely } from './aggregators.ts';
import { ashby, greenhouse, lever } from './ats.ts';
import { hackernews } from './community.ts';
import { gamedev, nicheFeeds, reddit, simplify, workingnomads } from './feeds.ts';
import { DEFAULT_BOARDS } from './boards.ts';
import type { Boards, Connector } from './types.ts';

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
];

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
