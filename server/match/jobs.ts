import { all } from '../db.ts';
import type { Legitimacy } from '../contracts/job.ts';
import type { Category } from '../sources/types.ts';

/** The job columns the matcher reads, in one shape. */
export interface MatchJob {
  id: string;
  title: string;
  company: string;
  companyId: string | null;
  location: string;
  remote: boolean;
  category: Category;
  descriptionText: string;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  postedAt: string | null;
  foundAt: string;
  prefilterScore: number;
  legitimacy: Legitimacy | null;
  priority: number;
  status: string;
  url: string;
  applyUrl: string | null;
  applyEmail: string | null;
}

interface Row {
  id: string;
  title: string;
  company: string;
  company_id: string | null;
  location: string | null;
  remote: number;
  category: Category;
  description_text: string | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  posted_at: string | null;
  found_at: string;
  prefilter_score: number | null;
  legitimacy: Legitimacy | null;
  priority: number | null;
  status: string;
  url: string;
  apply_url_canonical: string | null;
  apply_email: string | null;
}

const COLS = `id, title, company, company_id, location, remote, category, description_text, salary_min, salary_max, salary_currency,
  posted_at, found_at, prefilter_score, legitimacy, priority, status, url, apply_url_canonical, apply_email`;

export function toMatchJob(r: Row): MatchJob {
  return {
    id: r.id,
    title: r.title,
    company: r.company,
    companyId: r.company_id ?? null,
    location: r.location ?? '',
    remote: !!r.remote,
    category: r.category,
    descriptionText: r.description_text ?? '',
    salaryMin: r.salary_min ?? null,
    salaryMax: r.salary_max ?? null,
    salaryCurrency: r.salary_currency ?? null,
    postedAt: r.posted_at ?? null,
    foundAt: r.found_at,
    prefilterScore: Number(r.prefilter_score ?? 0),
    legitimacy: r.legitimacy ?? null,
    priority: Number(r.priority ?? 0),
    status: r.status,
    url: r.url,
    applyUrl: r.apply_url_canonical ?? null,
    applyEmail: r.apply_email ?? null,
  };
}

/** Load jobs by id, keeping the order of `ids` and dropping ids that don't exist. */
export function loadJobs(ids: string[]): MatchJob[] {
  const unique = [...new Set(ids)];
  const out = new Map<string, MatchJob>();
  for (let i = 0; i < unique.length; i += 400) {
    const chunk = unique.slice(i, i + 400);
    for (const r of all<Row>(`SELECT ${COLS} FROM jobs WHERE id IN (${chunk.map(() => '?').join(',')})`, ...chunk)) out.set(r.id, toMatchJob(r));
  }
  return unique.map((id) => out.get(id)).filter((j): j is MatchJob => !!j);
}
