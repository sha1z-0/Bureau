export const CATEGORIES = ['security', 'web', 'mobile', 'game', 'data_ai', 'devops_cloud', 'software'] as const;
export type Category = (typeof CATEGORIES)[number];

/** The connector output shape lives in the shared contracts. */
export type { RawJob } from '../contracts/job.ts';
import type { AtsFamily, RawJob } from '../contracts/job.ts';

/** v1 board lists kept in settings (Sources → Company boards). The registry adds every other family. */
export interface Boards {
  greenhouse: string[];
  lever: string[];
  ashby: string[];
}

/** One company board a per-company ATS connector should poll this run. */
export interface CompanyTarget {
  /** Registry row id, or null for a v1 settings board not yet in the registry. */
  companyId: string | null;
  name: string | null;
  token: string;
  careersUrl?: string | null;
  domain?: string | null;
}

/** What a connector says about one board it polled (feeds the registry's open-role counts and signals). */
export interface BoardReport {
  ok: boolean;
  /** Open postings on the board (before any relevance filtering). */
  count: number;
  /** HTTP status when it failed (404 marks a board dead). */
  status?: number;
  error?: string;
  /** Company name as the ATS reports it. */
  name?: string;
}

export interface SourceContext {
  keywords: string[];
  categories: Category[];
  boards: Boards;
  maxAgeDays: number;
  log: (message: string) => void;
  // ── v2 (all optional so v1 callers keep working) ──
  /** Registry companies on this ATS to poll this run, highest priority first. */
  targets?: (ats: AtsFamily) => CompanyTarget[];
  /** Per-board result callback (registry bookkeeping). */
  reportBoard?: (ats: AtsFamily, token: string, report: BoardReport) => void;
  /** Feed URLs seen anywhere (apply links, careers pages) to registry discovery. */
  discover?: (urls: string[], via: string) => void;
  /** True when this posting URL is already stored, so expensive detail fetches can be skipped. */
  isKnown?: (url: string) => boolean;
  /** Campaign roles and locations, for search-term rotation (JobSpy, local boards). */
  roles?: string[];
  locations?: string[];
  remoteOnly?: boolean;
  /** Max per-posting detail requests per board for ATSs whose list has no description (default 40). */
  detailBudget?: number;
  /** Detail requests left for this connector's whole run, shared across its boards. */
  detailTotal?: { left: number };
  /** Max list pages per Workday tenant (20 postings each, default 5). */
  workdayPages?: number;
}

export interface Connector {
  id: string;
  label: string;
  kind: 'aggregator' | 'ats' | 'community' | 'feed';
  homepage: string;
  description: string;
  defaultEnabled: boolean;
  /** For per-company ATS connectors: the family it polls. */
  ats?: AtsFamily;
  /** Hard ceiling for one run; the scout marks the source failing when it is exceeded. */
  timeoutMs?: number;
  /** Reports why the source can't run on this machine (e.g. no Python for JobSpy), or null when it can. */
  availability?: () => Promise<string | null>;
  run: (ctx: SourceContext) => Promise<RawJob[]>;
}
