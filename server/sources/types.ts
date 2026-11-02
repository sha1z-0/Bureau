export const CATEGORIES = ['security', 'web', 'mobile', 'game', 'data_ai', 'devops_cloud', 'software'] as const;
export type Category = (typeof CATEGORIES)[number];

/** The connector output shape lives in the shared contracts. */
export type { RawJob } from '../contracts/job.ts';
import type { RawJob } from '../contracts/job.ts';

export interface Boards {
  greenhouse: string[];
  lever: string[];
  ashby: string[];
}

export interface SourceContext {
  keywords: string[];
  categories: Category[];
  boards: Boards;
  maxAgeDays: number;
  log: (message: string) => void;
}

export interface Connector {
  id: string;
  label: string;
  kind: 'aggregator' | 'ats' | 'community' | 'feed';
  homepage: string;
  description: string;
  defaultEnabled: boolean;
  run: (ctx: SourceContext) => Promise<RawJob[]>;
}
