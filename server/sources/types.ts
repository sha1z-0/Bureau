export const CATEGORIES = ['security', 'web', 'mobile', 'game', 'data_ai', 'devops_cloud', 'software'] as const;
export type Category = (typeof CATEGORIES)[number];

export interface RawJob {
  source: string;
  externalId: string;
  title: string;
  company: string;
  location: string;
  remote: boolean;
  url: string;
  descriptionHtml?: string;
  descriptionText?: string;
  postedAt?: string | null;
  salaryMin?: number | null;
  salaryMax?: number | null;
  salaryCurrency?: string | null;
  tags?: string[];
  applyEmail?: string | null;
}

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
